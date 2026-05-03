"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../logger"));
const bitcoin_api_factory_1 = __importDefault(require("../bitcoin/bitcoin-api-factory"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = require("fs");
const POLL_FREQUENCY = 5 * 60 * 1000; // 5 minutes
class WalletApi {
    treasuries = [];
    wallets = {};
    syncing = false;
    lastSync = 0;
    isSaving = false;
    cacheSchemaVersion = 1;
    static TMP_FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/tmp-wallets-cache.json';
    static FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/wallets-cache.json';
    constructor() {
        this.wallets = config_1.default.WALLETS.ENABLED ? config_1.default.WALLETS.WALLETS.reduce((acc, wallet) => {
            acc[wallet] = { name: wallet, addresses: {}, lastPoll: 0 };
            return acc;
        }, {}) : {};
        // Load cache on startup
        if (config_1.default.WALLETS.ENABLED) {
            void this.$loadCache();
        }
    }
    /** @asyncSafe */
    async $loadCache() {
        try {
            const cacheData = await fs_1.promises.readFile(WalletApi.FILE_NAME, 'utf8');
            if (!cacheData) {
                return;
            }
            const data = JSON.parse(cacheData);
            if (data.cacheSchemaVersion !== this.cacheSchemaVersion) {
                logger_1.default.notice('Wallets cache contains an outdated schema version. Clearing it.');
                return this.$wipeCache();
            }
            this.wallets = data.wallets;
            this.treasuries = data.treasuries || [];
            // Reset lastSync time to force transaction history refresh
            for (const wallet of Object.values(this.wallets)) {
                wallet.lastPoll = 0;
                for (const address of Object.values(wallet.addresses)) {
                    address.lastSync = 0;
                }
            }
            logger_1.default.info('Restored wallets data from disk cache');
        }
        catch (e) {
            logger_1.default.warn('Failed to parse wallets cache. Skipping. Reason: ' + (e instanceof Error ? e.message : e));
        }
    }
    async $saveCache() {
        if (this.isSaving || !config_1.default.WALLETS.ENABLED) {
            return;
        }
        try {
            this.isSaving = true;
            logger_1.default.debug('Writing wallets data to disk cache...');
            const cacheData = {
                cacheSchemaVersion: this.cacheSchemaVersion,
                wallets: this.wallets,
                treasuries: this.treasuries,
            };
            await fs_1.promises.writeFile(WalletApi.TMP_FILE_NAME, JSON.stringify(cacheData), { flag: 'w' });
            await fs_1.promises.rename(WalletApi.TMP_FILE_NAME, WalletApi.FILE_NAME);
            logger_1.default.debug('Wallets data saved to disk cache');
        }
        catch (e) {
            logger_1.default.warn('Error writing to wallets cache file: ' + (e instanceof Error ? e.message : e));
        }
        finally {
            this.isSaving = false;
        }
    }
    async $wipeCache() {
        try {
            await fs_1.promises.unlink(WalletApi.FILE_NAME);
        }
        catch (e) {
            if (e?.code !== 'ENOENT') {
                logger_1.default.err(`Cannot wipe wallets cache file ${WalletApi.FILE_NAME}. Exception ${JSON.stringify(e)}`);
            }
        }
    }
    getWallet(wallet) {
        if (wallet in this.wallets) {
            return this.wallets?.[wallet]?.addresses || {};
        }
        else {
            return null;
        }
    }
    getWallets() {
        return Object.keys(this.wallets);
    }
    getTreasuries() {
        return this.treasuries?.filter(treasury => !!this.wallets[treasury.wallet]) || [];
    }
    // resync wallet addresses from the services backend
    /** @asyncSafe */
    async $syncWallets() {
        if (!config_1.default.WALLETS.ENABLED || this.syncing) {
            return;
        }
        this.syncing = true;
        if (config_1.default.WALLETS.AUTO && (Date.now() - this.lastSync) > POLL_FREQUENCY) {
            try {
                // update list of active wallets
                this.lastSync = Date.now();
                const response = await axios_1.default.get(config_1.default.MEMPOOL_SERVICES.API + `/wallets`);
                const walletList = response.data;
                if (walletList) {
                    // create a quick lookup dictionary of active wallets
                    const newWallets = Object.fromEntries(walletList.map(wallet => [wallet, true]));
                    for (const wallet of walletList) {
                        // don't overwrite existing wallets
                        if (!this.wallets[wallet]) {
                            this.wallets[wallet] = { name: wallet, addresses: {}, lastPoll: 0 };
                        }
                    }
                    // remove wallets that are no longer active
                    for (const wallet of Object.keys(this.wallets)) {
                        if (!newWallets[wallet]) {
                            delete this.wallets[wallet];
                        }
                    }
                }
                // update list of treasuries
                const treasuriesResponse = await axios_1.default.get(config_1.default.MEMPOOL_SERVICES.API + `/treasuries`);
                this.treasuries = treasuriesResponse.data || [];
            }
            catch (e) {
                logger_1.default.err(`Error updating active wallets: ${(e instanceof Error ? e.message : e)}`);
            }
            try {
                // update list of active treasuries
                this.lastSync = Date.now();
                const response = await axios_1.default.get(config_1.default.MEMPOOL_SERVICES.API + `/treasuries`);
                const treasuries = response.data;
                if (treasuries) {
                    this.treasuries = treasuries;
                }
            }
            catch (e) {
                logger_1.default.err(`Error updating active treasuries: ${(e instanceof Error ? e.message : e)}`);
            }
            // insert dummy address data to represent off-chain balance history
            for (const treasury of this.treasuries) {
                if (treasury.balances?.length) {
                    if (this.wallets[treasury.wallet]) {
                        this.wallets[treasury.wallet].addresses['private'] = convertBalancesToWalletAddress(treasury.wallet, treasury.balances);
                    }
                }
            }
        }
        for (const walletKey of Object.keys(this.wallets)) {
            const wallet = this.wallets[walletKey];
            if (wallet.lastPoll < (Date.now() - POLL_FREQUENCY)) {
                try {
                    const response = await axios_1.default.get(config_1.default.MEMPOOL_SERVICES.API + `/wallets/${wallet.name}`);
                    const addresses = response.data;
                    const addressList = Object.values(addresses);
                    // sync all current addresses
                    for (const address of addressList) {
                        await this.$syncWalletAddress(wallet, address);
                    }
                    // remove old addresses
                    for (const address of Object.keys(wallet.addresses)) {
                        if (address !== 'private' && !addresses[address]) {
                            delete wallet.addresses[address];
                        }
                    }
                    wallet.lastPoll = Date.now();
                    logger_1.default.debug(`Synced ${Object.keys(wallet.addresses).length} addresses for wallet ${wallet.name}`);
                    // Update cache
                    await this.$saveCache();
                }
                catch (e) {
                    logger_1.default.err(`Error syncing wallet ${wallet.name}: ${(e instanceof Error ? e.message : e)}`);
                }
            }
        }
        this.syncing = false;
    }
    // resync address transactions from esplora
    async $syncWalletAddress(wallet, address) {
        if (address.address === 'private') {
            // skip pseudo-address for private balances
            return;
        }
        // fetch full transaction data if the address is new or hasn't been synced in the last hour
        const refreshTransactions = !wallet.addresses[address.address] || (Date.now() - wallet.addresses[address.address].lastSync) > 60 * 60 * 1000;
        if (refreshTransactions) {
            try {
                const summary = await bitcoin_api_factory_1.default.$getAddressTransactionSummary(address.address);
                const addressInfo = await bitcoin_api_factory_1.default.$getAddress(address.address);
                const walletAddress = {
                    address: address.address,
                    transactions: summary,
                    stats: addressInfo.chain_stats,
                    lastSync: Date.now(),
                };
                wallet.addresses[address.address] = walletAddress;
            }
            catch (e) {
                logger_1.default.err(`Error syncing wallet address ${address.address}: ${(e instanceof Error ? e.message : e)}`);
            }
        }
    }
    // check a new block for transactions that affect wallet address balances, and add relevant transactions to wallets
    processBlock(block, blockTxs) {
        const walletTransactions = {};
        for (const walletKey of Object.keys(this.wallets)) {
            const wallet = this.wallets[walletKey];
            walletTransactions[walletKey] = [];
            for (const tx of blockTxs) {
                const funded = {};
                const spent = {};
                const fundedCount = {};
                const spentCount = {};
                let anyMatch = false;
                for (const vin of tx.vin) {
                    const address = vin.prevout?.scriptpubkey_address;
                    if (address && wallet.addresses[address]) {
                        anyMatch = true;
                        spent[address] = (spent[address] ?? 0) + (vin.prevout?.value ?? 0);
                        spentCount[address] = (spentCount[address] ?? 0) + 1;
                    }
                }
                for (const vout of tx.vout) {
                    const address = vout.scriptpubkey_address;
                    if (address && wallet.addresses[address]) {
                        anyMatch = true;
                        funded[address] = (funded[address] ?? 0) + (vout.value ?? 0);
                        fundedCount[address] = (fundedCount[address] ?? 0) + 1;
                    }
                }
                for (const address of Object.keys({ ...funded, ...spent })) {
                    // update address stats
                    wallet.addresses[address].stats.tx_count++;
                    wallet.addresses[address].stats.funded_txo_count += fundedCount[address] || 0;
                    wallet.addresses[address].stats.spent_txo_count += spentCount[address] || 0;
                    wallet.addresses[address].stats.funded_txo_sum += funded[address] || 0;
                    wallet.addresses[address].stats.spent_txo_sum += spent[address] || 0;
                    // add tx to summary
                    const txSummary = {
                        txid: tx.txid,
                        value: (funded[address] ?? 0) - (spent[address] ?? 0),
                        height: block.height,
                        time: block.timestamp,
                    };
                    wallet.addresses[address].transactions?.push(txSummary);
                }
                if (anyMatch) {
                    walletTransactions[walletKey].push(tx);
                }
            }
        }
        return walletTransactions;
    }
}
function convertBalancesToWalletAddress(wallet, balances) {
    // represent the off-chain balance as a series of transactions modifying a single notional UTXO
    const sortedBalances = balances.sort((a, b) => a.time - b.time);
    const walletAddress = {
        address: 'private',
        stats: {
            funded_txo_count: 0,
            funded_txo_sum: sortedBalances[sortedBalances.length - 1].balance,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 0,
        },
        transactions: [],
        lastSync: sortedBalances[sortedBalances.length - 1].time,
    };
    let lastBalance = 0;
    for (const [index, entry] of sortedBalances.entries()) {
        const diff = entry.balance - lastBalance;
        walletAddress.transactions.push({
            txid: `${wallet}-private-${index}`,
            value: diff,
            height: index,
            time: entry.time,
        });
        lastBalance = entry.balance;
    }
    return walletAddress;
}
exports.default = new WalletApi();
