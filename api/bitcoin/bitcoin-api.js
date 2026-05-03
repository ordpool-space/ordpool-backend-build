"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const blocks_1 = __importDefault(require("../blocks"));
const mempool_1 = __importDefault(require("../mempool"));
const transaction_utils_1 = __importDefault(require("../transaction-utils"));
const common_1 = require("../common");
class BitcoinApi {
    rawMempoolCache = null;
    bitcoindClient;
    constructor(bitcoinClient) {
        this.bitcoindClient = bitcoinClient;
    }
    static convertBlock(block) {
        return {
            id: block.hash,
            height: block.height,
            version: block.version,
            timestamp: block.time,
            bits: parseInt(block.bits, 16),
            nonce: block.nonce,
            difficulty: block.difficulty,
            merkle_root: block.merkleroot,
            tx_count: block.nTx,
            size: block.size,
            weight: block.weight,
            previousblockhash: block.previousblockhash,
            mediantime: block.mediantime,
            stale: block.confirmations === -1,
        };
    }
    $getRawTransaction(txId, skipConversion = false, addPrevout = false, lazyPrevouts = false) {
        // If the transaction is in the mempool we already converted and fetched the fee. Only prevouts are missing
        const txInMempool = mempool_1.default.getMempool()[txId];
        if (txInMempool && addPrevout) {
            return this.$addPrevouts(txInMempool);
        }
        return this.bitcoindClient.getRawTransaction(txId, true)
            .then((transaction) => {
            if (skipConversion) {
                transaction.vout.forEach((vout) => {
                    vout.value = Math.round(vout.value * 100000000);
                });
                return transaction;
            }
            return this.$convertTransaction(transaction, addPrevout, lazyPrevouts);
        })
            .catch((e) => {
            if (e.message.startsWith('The genesis block coinbase')) {
                return this.$returnCoinbaseTransaction();
            }
            throw e;
        });
    }
    async $getRawTransactions(txids) {
        const txs = [];
        for (const txid of txids) {
            try {
                const tx = await this.$getRawTransaction(txid, false, true);
                txs.push(tx);
            }
            catch (err) {
                // skip failures
            }
        }
        return txs;
    }
    $getMempoolTransactions(txids) {
        throw new Error('Method getMempoolTransactions not supported by the Bitcoin RPC API.');
    }
    $getAllMempoolTransactions(lastTxid, max_txs) {
        throw new Error('Method getAllMempoolTransactions not supported by the Bitcoin RPC API.');
    }
    async $getTransactionHex(txId) {
        const txInMempool = mempool_1.default.getMempool()[txId];
        if (txInMempool && txInMempool.hex) {
            return txInMempool.hex;
        }
        return this.bitcoindClient.getRawTransaction(txId, true)
            .then((transaction) => {
            return transaction.hex;
        });
    }
    $getTransactionMerkleProof(txId) {
        throw new Error('Method getTransactionMerkleProof not supported by the Bitcoin RPC API.');
    }
    $getBlockHeightTip() {
        return this.bitcoindClient.getBlockCount();
    }
    $getBlockHashTip() {
        return this.bitcoindClient.getBestBlockHash();
    }
    $getTxIdsForBlock(hash, fallbackToCore = false) {
        return this.bitcoindClient.getBlock(hash, 1)
            .then((rpcBlock) => rpcBlock.tx);
    }
    /** @asyncUnsafe */
    async $getTxsForBlock(hash, fallbackToCore = false) {
        const verboseBlock = await this.bitcoindClient.getBlock(hash, 2);
        const transactions = [];
        for (const tx of verboseBlock.tx) {
            const converted = await this.$convertTransaction(tx, true, false, verboseBlock.confirmations === -1);
            converted.status = {
                confirmed: true,
                block_height: verboseBlock.height,
                block_hash: hash,
                block_time: verboseBlock.time,
            };
            transactions.push(converted);
        }
        return transactions;
    }
    $getRawBlock(hash) {
        return this.bitcoindClient.getBlock(hash, 0)
            .then((raw) => Buffer.from(raw, 'hex'));
    }
    $getBlockHash(height) {
        return this.bitcoindClient.getBlockHash(height);
    }
    $getBlockHeader(hash) {
        return this.bitcoindClient.getBlockHeader(hash, false);
    }
    async $getBlock(hash) {
        const foundBlock = blocks_1.default.getBlocks().find((block) => block.id === hash);
        if (foundBlock) {
            return foundBlock;
        }
        return this.bitcoindClient.getBlock(hash)
            .then((block) => BitcoinApi.convertBlock(block));
    }
    $getAddress(address) {
        throw new Error('Method getAddress not supported by the Bitcoin RPC API.');
    }
    $getAddressTransactions(address, lastSeenTxId) {
        throw new Error('Method getAddressTransactions not supported by the Bitcoin RPC API.');
    }
    $getAddressUtxos(address) {
        throw new Error('Method getAddressUtxos not supported by the Bitcoin RPC API.');
    }
    $getScriptHash(scripthash) {
        throw new Error('Method getScriptHash not supported by the Bitcoin RPC API.');
    }
    $getScriptHashTransactions(scripthash, lastSeenTxId) {
        throw new Error('Method getScriptHashTransactions not supported by the Bitcoin RPC API.');
    }
    $getScriptHashUtxos(scripthash) {
        throw new Error('Method getScriptHashUtxos not supported by the Bitcoin RPC API.');
    }
    $getRawMempool() {
        return this.bitcoindClient.getRawMemPool();
    }
    $getAddressPrefix(prefix) {
        const found = {};
        const mp = mempool_1.default.getMempool();
        for (const tx in mp) {
            for (const vout of mp[tx].vout) {
                if (vout.scriptpubkey_address?.indexOf(prefix) === 0) {
                    found[vout.scriptpubkey_address] = '';
                    if (Object.keys(found).length >= 10) {
                        return Object.keys(found);
                    }
                }
            }
            for (const vin of mp[tx].vin) {
                if (vin.prevout?.scriptpubkey_address?.indexOf(prefix) === 0) {
                    found[vin.prevout?.scriptpubkey_address] = '';
                    if (Object.keys(found).length >= 10) {
                        return Object.keys(found);
                    }
                }
            }
        }
        return Object.keys(found);
    }
    $sendRawTransaction(rawTransaction) {
        return this.bitcoindClient.sendRawTransaction(rawTransaction);
    }
    async $testMempoolAccept(rawTransactions, maxfeerate) {
        if (rawTransactions.length) {
            return this.bitcoindClient.testMempoolAccept(rawTransactions, maxfeerate ?? undefined);
        }
        else {
            return [];
        }
    }
    $submitPackage(rawTransactions, maxfeerate, maxburnamount) {
        return this.bitcoindClient.submitPackage(rawTransactions, maxfeerate ?? undefined, maxburnamount ?? undefined);
    }
    /** @asyncUnsafe */
    async $getOutspend(txId, vout) {
        const txOut = await this.bitcoindClient.getTxOut(txId, vout, false);
        return {
            spent: txOut === null,
            status: {
                confirmed: true,
            }
        };
    }
    /** @asyncUnsafe */
    async $getOutspends(txId) {
        const outSpends = [];
        const tx = await this.$getRawTransaction(txId, true, false);
        for (let i = 0; i < tx.vout.length; i++) {
            if (tx.status && tx.status.block_height === 0) {
                outSpends.push({
                    spent: false
                });
            }
            else {
                const txOut = await this.bitcoindClient.getTxOut(txId, i);
                outSpends.push({
                    spent: txOut === null,
                });
            }
        }
        return outSpends;
    }
    /** @asyncUnsafe */
    async $getBatchedOutspends(txId) {
        const outspends = [];
        for (const tx of txId) {
            const outspend = await this.$getOutspends(tx);
            outspends.push(outspend);
        }
        return outspends;
    }
    async $getBatchedOutspendsInternal(txId) {
        return this.$getBatchedOutspends(txId);
    }
    /** @asyncUnsafe */
    async $getOutSpendsByOutpoint(outpoints) {
        const outspends = [];
        for (const outpoint of outpoints) {
            const outspend = await this.$getOutspend(outpoint.txid, outpoint.vout);
            outspends.push(outspend);
        }
        return outspends;
    }
    /** @asyncUnsafe */
    async $getCoinbaseTx(blockhash) {
        const txids = await this.$getTxIdsForBlock(blockhash);
        return this.$getRawTransaction(txids[0]);
    }
    async $getAddressTransactionSummary(address) {
        throw new Error('Method getAddressTransactionSummary not supported by the Bitcoin RPC API.');
    }
    $getEstimatedHashrate(blockHeight) {
        // 120 is the default block span in Core
        return this.bitcoindClient.getNetworkHashPs(120, blockHeight);
    }
    /** @asyncUnsafe */
    async $convertTransaction(transaction, addPrevout, lazyPrevouts = false, allowMissingPrevouts = false) {
        let esploraTransaction = {
            txid: transaction.txid,
            version: transaction.version,
            locktime: transaction.locktime,
            size: transaction.size,
            weight: transaction.weight,
            fee: 0,
            vin: [],
            vout: [],
            status: { confirmed: false },
        };
        esploraTransaction.vout = transaction.vout.map((vout) => {
            return {
                value: Math.round(vout.value * 100000000),
                scriptpubkey: vout.scriptPubKey.hex,
                scriptpubkey_address: vout.scriptPubKey && vout.scriptPubKey.address ? vout.scriptPubKey.address
                    : vout.scriptPubKey.addresses ? vout.scriptPubKey.addresses[0] : '',
                scriptpubkey_asm: vout.scriptPubKey.asm ? transaction_utils_1.default.convertScriptSigAsm(vout.scriptPubKey.hex) : '',
                scriptpubkey_type: this.translateScriptPubKeyType(vout.scriptPubKey.type),
            };
        });
        esploraTransaction.vin = transaction.vin.map((vin) => {
            return {
                is_coinbase: !!vin.coinbase,
                prevout: null,
                scriptsig: vin.scriptSig && vin.scriptSig.hex || vin.coinbase || '',
                scriptsig_asm: vin.scriptSig ? transaction_utils_1.default.convertScriptSigAsm(vin.scriptSig.hex) : (vin.coinbase ? transaction_utils_1.default.convertScriptSigAsm(vin.coinbase) : ''),
                sequence: vin.sequence,
                txid: vin.txid || '',
                vout: vin.vout || 0,
                witness: vin.txinwitness || [],
                inner_redeemscript_asm: '',
                inner_witnessscript_asm: '',
            };
        });
        if (transaction.confirmations) {
            esploraTransaction.status = {
                confirmed: true,
                block_height: blocks_1.default.getCurrentBlockHeight() - transaction.confirmations + 1,
                block_hash: transaction.blockhash,
                block_time: transaction.blocktime,
            };
        }
        if (addPrevout) {
            try {
                esploraTransaction = await this.$calculateFeeFromInputs(esploraTransaction, false, lazyPrevouts);
            }
            catch (e) {
                if (!allowMissingPrevouts) {
                    throw e;
                }
            }
        }
        else if (!transaction.confirmations) {
            esploraTransaction = await this.$appendMempoolFeeData(esploraTransaction);
        }
        return esploraTransaction;
    }
    translateScriptPubKeyType(outputType) {
        const map = {
            'pubkey': 'p2pk',
            'pubkeyhash': 'p2pkh',
            'scripthash': 'p2sh',
            'witness_v0_keyhash': 'v0_p2wpkh',
            'witness_v0_scripthash': 'v0_p2wsh',
            'witness_v1_taproot': 'v1_p2tr',
            'nonstandard': 'nonstandard',
            'multisig': 'multisig',
            'anchor': 'anchor',
            'nulldata': 'op_return'
        };
        if (map[outputType]) {
            return map[outputType];
        }
        else {
            return 'unknown';
        }
    }
    /** @asyncUnsafe */
    async $appendMempoolFeeData(transaction) {
        if (transaction.fee) {
            return transaction;
        }
        let mempoolEntry;
        if (!mempool_1.default.isInSync() && !this.rawMempoolCache) {
            this.rawMempoolCache = await this.$getRawMempoolVerbose();
        }
        if (this.rawMempoolCache && this.rawMempoolCache[transaction.txid]) {
            mempoolEntry = this.rawMempoolCache[transaction.txid];
        }
        else {
            mempoolEntry = await this.$getMempoolEntry(transaction.txid);
        }
        transaction.fee = Math.round(mempoolEntry.fees.base * 100000000);
        return transaction;
    }
    /** @asyncUnsafe */
    async $addPrevouts(transaction) {
        let addedPrevouts = false;
        for (const vin of transaction.vin) {
            if (vin.prevout) {
                continue;
            }
            const innerTx = await this.$getRawTransaction(vin.txid, false, false);
            vin.prevout = innerTx.vout[vin.vout];
            transaction_utils_1.default.addInnerScriptsToVin(vin);
            addedPrevouts = true;
        }
        if (addedPrevouts) {
            // re-calculate transaction flags now that we have full prevout data
            transaction.flags = undefined; // clear existing flags to force full classification
            transaction.flags = common_1.Common.getTransactionFlags(transaction, transaction.status?.block_height ?? blocks_1.default.getCurrentBlockHeight());
        }
        return transaction;
    }
    $returnCoinbaseTransaction() {
        return this.bitcoindClient.getBlockHash(0).then((hash) => this.bitcoindClient.getBlock(hash, 2)
            .then((block) => {
            return this.$convertTransaction(Object.assign(block.tx[0], {
                confirmations: blocks_1.default.getCurrentBlockHeight() + 1,
                blocktime: block.time
            }), false);
        }));
    }
    $getMempoolEntry(txid) {
        return this.bitcoindClient.getMempoolEntry(txid);
    }
    $getRawMempoolVerbose() {
        return this.bitcoindClient.getRawMemPool(true);
    }
    /** @asyncUnsafe */
    async $calculateFeeFromInputs(transaction, addPrevout, lazyPrevouts) {
        if (transaction.vin[0].is_coinbase) {
            transaction.fee = 0;
            return transaction;
        }
        let totalIn = 0;
        for (let i = 0; i < transaction.vin.length; i++) {
            if (lazyPrevouts && i > 12) {
                transaction.vin[i].lazy = true;
                continue;
            }
            const innerTx = await this.$getRawTransaction(transaction.vin[i].txid, false, false);
            transaction.vin[i].prevout = innerTx.vout[transaction.vin[i].vout];
            transaction_utils_1.default.addInnerScriptsToVin(transaction.vin[i]);
            totalIn += innerTx.vout[transaction.vin[i].vout].value;
        }
        if (lazyPrevouts && transaction.vin.length > 12) {
            transaction.fee = -1;
        }
        else {
            const totalOut = transaction.vout.reduce((p, output) => p + output.value, 0);
            transaction.fee = parseFloat((totalIn - totalOut).toFixed(8));
        }
        return transaction;
    }
    startHealthChecks() { }
    ;
    getHealthStatus() {
        return [];
    }
}
exports.default = BitcoinApi;
