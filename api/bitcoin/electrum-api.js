"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const electrum_client_1 = __importDefault(require("@mempool/electrum-client"));
const bitcoin_api_1 = __importDefault(require("./bitcoin-api"));
const logger_1 = __importDefault(require("../../logger"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const loading_indicators_1 = __importDefault(require("../loading-indicators"));
const memory_cache_1 = __importDefault(require("../memory-cache"));
class BitcoindElectrsApi extends bitcoin_api_1.default {
    electrumClient;
    constructor(bitcoinClient) {
        super(bitcoinClient);
        const electrumConfig = { client: 'mempool-v2', version: '1.4' };
        const electrumPersistencePolicy = { retryPeriod: 1000, maxRetry: Number.MAX_SAFE_INTEGER, callback: null };
        const electrumCallbacks = {
            onConnect: (client, versionInfo) => { logger_1.default.info(`Connected to Electrum Server at ${config_1.default.ELECTRUM.HOST}:${config_1.default.ELECTRUM.PORT} (${JSON.stringify(versionInfo)})`); },
            onClose: (client) => { logger_1.default.info(`Disconnected from Electrum Server at ${config_1.default.ELECTRUM.HOST}:${config_1.default.ELECTRUM.PORT}`); },
            onError: (err) => { logger_1.default.err(`Electrum error: ${JSON.stringify(err)}`); },
            onLog: (str) => { logger_1.default.debug(str); },
        };
        this.electrumClient = new electrum_client_1.default(config_1.default.ELECTRUM.PORT, config_1.default.ELECTRUM.HOST, config_1.default.ELECTRUM.TLS_ENABLED ? 'tls' : 'tcp', null, electrumCallbacks);
        this.electrumClient.initElectrum(electrumConfig, electrumPersistencePolicy)
            .then(() => { })
            .catch((err) => {
            logger_1.default.err(`Error connecting to Electrum Server at ${config_1.default.ELECTRUM.HOST}:${config_1.default.ELECTRUM.PORT}`);
        });
    }
    /** @asyncUnsafe */
    async $getAddress(address) {
        const addressInfo = await this.bitcoindClient.validateAddress(address);
        if (!addressInfo || !addressInfo.isvalid) {
            throw new Error('Invalid Bitcoin address');
        }
        try {
            const balance = await this.$getScriptHashBalance(addressInfo.scriptPubKey);
            const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);
            const unconfirmed = history.filter((h) => h.fee).length;
            return {
                'address': addressInfo.address,
                'chain_stats': {
                    'funded_txo_count': 0,
                    'funded_txo_sum': balance.confirmed ? balance.confirmed : 0,
                    'spent_txo_count': 0,
                    'spent_txo_sum': balance.confirmed < 0 ? balance.confirmed : 0,
                    'tx_count': history.length - unconfirmed,
                },
                'mempool_stats': {
                    'funded_txo_count': 0,
                    'funded_txo_sum': balance.unconfirmed > 0 ? balance.unconfirmed : 0,
                    'spent_txo_count': 0,
                    'spent_txo_sum': balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
                    'tx_count': unconfirmed,
                },
                'electrum': true,
            };
        }
        catch (e) {
            throw new Error(typeof e === 'string' ? e : e && e.message || e);
        }
    }
    /** @asyncUnsafe */
    async $getAddressTransactions(address, lastSeenTxId) {
        const addressInfo = await this.bitcoindClient.validateAddress(address);
        if (!addressInfo || !addressInfo.isvalid) {
            throw new Error('Invalid Bitcoin address');
        }
        try {
            loading_indicators_1.default.setProgress('address-' + address, 0);
            const transactions = [];
            const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);
            history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));
            let startingIndex = 0;
            if (lastSeenTxId) {
                const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
                if (pos) {
                    startingIndex = pos + 1;
                }
            }
            const endIndex = Math.min(startingIndex + 10, history.length);
            for (let i = startingIndex; i < endIndex; i++) {
                const tx = await this.$getRawTransaction(history[i].tx_hash, false, true);
                transactions.push(tx);
                loading_indicators_1.default.setProgress('address-' + address, (i + 1) / endIndex * 100);
            }
            return transactions;
        }
        catch (e) {
            loading_indicators_1.default.setProgress('address-' + address, 100);
            throw new Error(typeof e === 'string' ? e : e && e.message || e);
        }
    }
    async $getScriptHash(scripthash) {
        try {
            const balance = await this.electrumClient.blockchainScripthash_getBalance(scripthash);
            let history = memory_cache_1.default.get('Scripthash_getHistory', scripthash);
            if (!history) {
                history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
                memory_cache_1.default.set('Scripthash_getHistory', scripthash, history, 2);
            }
            const unconfirmed = history ? history.filter((h) => h.fee).length : 0;
            return {
                'scripthash': scripthash,
                'chain_stats': {
                    'funded_txo_count': 0,
                    'funded_txo_sum': balance.confirmed ? balance.confirmed : 0,
                    'spent_txo_count': 0,
                    'spent_txo_sum': balance.confirmed < 0 ? balance.confirmed : 0,
                    'tx_count': (history?.length || 0) - unconfirmed,
                },
                'mempool_stats': {
                    'funded_txo_count': 0,
                    'funded_txo_sum': balance.unconfirmed > 0 ? balance.unconfirmed : 0,
                    'spent_txo_count': 0,
                    'spent_txo_sum': balance.unconfirmed < 0 ? -balance.unconfirmed : 0,
                    'tx_count': unconfirmed,
                },
                'electrum': true,
            };
        }
        catch (e) {
            throw new Error(typeof e === 'string' ? e : e && e.message || e);
        }
    }
    /** @asyncUnsafe */
    async $getAddressUtxos(address) {
        const addressInfo = await this.bitcoindClient.validateAddress(address);
        if (!addressInfo || !addressInfo.isvalid) {
            throw new Error('Invalid Bitcoin address');
        }
        const scripthash = this.encodeScriptHash(addressInfo.scriptPubKey);
        return this.$getScriptHashUtxos(scripthash);
    }
    async $getScriptHashTransactions(scripthash, lastSeenTxId) {
        try {
            loading_indicators_1.default.setProgress('address-' + scripthash, 0);
            const transactions = [];
            let history = memory_cache_1.default.get('Scripthash_getHistory', scripthash);
            if (!history) {
                history = await this.electrumClient.blockchainScripthash_getHistory(scripthash);
                memory_cache_1.default.set('Scripthash_getHistory', scripthash, history, 2);
            }
            if (!history) {
                throw new Error('failed to get scripthash history');
            }
            history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));
            let startingIndex = 0;
            if (lastSeenTxId) {
                const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
                if (pos) {
                    startingIndex = pos + 1;
                }
            }
            const endIndex = Math.min(startingIndex + 10, history.length);
            for (let i = startingIndex; i < endIndex; i++) {
                const tx = await this.$getRawTransaction(history[i].tx_hash, false, true);
                transactions.push(tx);
                loading_indicators_1.default.setProgress('address-' + scripthash, (i + 1) / endIndex * 100);
            }
            return transactions;
        }
        catch (e) {
            loading_indicators_1.default.setProgress('address-' + scripthash, 100);
            throw new Error(typeof e === 'string' ? e : e && e.message || e);
        }
    }
    /** @asyncUnsafe */
    async $getScriptHashUtxos(scripthash) {
        const utxos = await this.$getScriptHashUnspent(scripthash);
        const result = [];
        for (const utxo of utxos) {
            if (utxo.height === 0) {
                //Unconfirmed
                result.push({
                    txid: utxo.tx_hash,
                    vout: utxo.tx_pos,
                    status: {
                        confirmed: false
                    },
                    value: utxo.value
                });
            }
            else {
                //Confirmed
                const blockHash = await this.$getBlockHash(utxo.height);
                const block = await this.$getBlock(blockHash);
                result.push({
                    txid: utxo.tx_hash,
                    vout: utxo.tx_pos,
                    status: {
                        confirmed: true,
                        block_height: utxo.height,
                        block_hash: blockHash,
                        block_time: block.timestamp
                    },
                    value: utxo.value
                });
            }
        }
        return result;
    }
    $getScriptHashUnspent(scriptHash) {
        return this.electrumClient.blockchainScripthash_listunspent(scriptHash);
    }
    /** @asyncUnsafe */
    async $getTransactionMerkleProof(txId) {
        const tx = await this.$getRawTransaction(txId);
        return this.electrumClient.blockchainTransaction_getMerkle(txId, tx.status.block_height);
    }
    $getScriptHashBalance(scriptHash) {
        return this.electrumClient.blockchainScripthash_getBalance(this.encodeScriptHash(scriptHash));
    }
    $getScriptHashHistory(scriptHash) {
        const fromCache = memory_cache_1.default.get('Scripthash_getHistory', scriptHash);
        if (fromCache) {
            return Promise.resolve(fromCache);
        }
        return this.electrumClient.blockchainScripthash_getHistory(this.encodeScriptHash(scriptHash))
            .then((history) => {
            memory_cache_1.default.set('Scripthash_getHistory', scriptHash, history, 2);
            return history;
        });
    }
    encodeScriptHash(scriptPubKey) {
        const addrScripthash = crypto_js_1.default.enc.Hex.stringify(crypto_js_1.default.SHA256(crypto_js_1.default.enc.Hex.parse(scriptPubKey)));
        return addrScripthash.match(/.{2}/g).reverse().join('');
    }
}
exports.default = BitcoindElectrsApi;
