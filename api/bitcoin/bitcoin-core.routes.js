"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../../logger"));
const bitcoin_client_1 = __importDefault(require("./bitcoin-client"));
const config_1 = __importDefault(require("../../config"));
const BLOCKHASH_REGEX = /^[a-f0-9]{64}$/i;
const TXID_REGEX = /^[a-f0-9]{64}$/i;
const RAW_TX_REGEX = /^[a-f0-9]{2,}$/i;
/**
 * Define a set of routes used by the accelerator server
 * Those routes are not designed to be public
 */
class BitcoinBackendRoutes {
    static tag = 'BitcoinBackendRoutes';
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-mempool-entry', this.disableCache, this.$getMempoolEntry)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'decode-raw-transaction', this.disableCache, this.$decodeRawTransaction)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-raw-transaction', this.disableCache, this.$getRawTransaction)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'send-raw-transaction', this.disableCache, this.$sendRawTransaction)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'test-mempool-accept', this.disableCache, this.$testMempoolAccept)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-mempool-ancestors', this.disableCache, this.$getMempoolAncestors)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-block', this.disableCache, this.$getBlock)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-block-hash', this.disableCache, this.$getBlockHash)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/bitcoin-core/' + 'get-block-count', this.disableCache, this.$getBlockCount);
    }
    /**
     * Disable caching for bitcoin core routes
     *
     * @param req
     * @param res
     * @param next
     */
    disableCache(req, res, next) {
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-control', 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('expires', -1);
        next();
    }
    /**
     * Exeption handler to return proper details to the accelerator server
     *
     * @param e
     * @param fnName
     * @param res
     */
    static handleException(e, fnName, res) {
        if (typeof (e.code) === 'number') {
            res.status(400).send(JSON.stringify(e, ['code']));
        }
        else {
            const err = `unknown exception in ${fnName}`;
            logger_1.default.err(err, BitcoinBackendRoutes.tag);
            res.status(500).send(err);
        }
    }
    async $getMempoolEntry(req, res) {
        const txid = req.query.txid;
        try {
            if (typeof (txid) !== 'string' || txid.length !== 64 || !TXID_REGEX.test(txid)) {
                res.status(400).send(`invalid param txid. must be 64 hexadecimal characters`);
                return;
            }
            const mempoolEntry = await bitcoin_client_1.default.getMempoolEntry(txid);
            if (!mempoolEntry) {
                res.status(404).send();
                return;
            }
            res.status(200).send(mempoolEntry);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'getMempoolEntry', res);
        }
    }
    async $decodeRawTransaction(req, res) {
        const rawTx = req.body.rawTx;
        try {
            if (typeof (rawTx) !== 'string' || !RAW_TX_REGEX.test(rawTx)) {
                res.status(400).send(`invalid param rawTx. must be a string of hexadecimal characters`);
                return;
            }
            const decodedTx = await bitcoin_client_1.default.decodeRawTransaction(rawTx);
            if (!decodedTx) {
                res.status(400).send(`unable to decode rawTx`);
                return;
            }
            res.status(200).send(decodedTx);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'decodeRawTransaction', res);
        }
    }
    async $getRawTransaction(req, res) {
        const txid = req.query.txid;
        const verbose = req.query.verbose;
        try {
            if (typeof (txid) !== 'string' || txid.length !== 64 || !TXID_REGEX.test(txid)) {
                res.status(400).send(`invalid param txid. must be 64 hexadecimal characters`);
                return;
            }
            if (typeof (verbose) !== 'string') {
                res.status(400).send(`invalid param verbose. must be a string representing an integer`);
                return;
            }
            const verboseNumber = parseInt(verbose, 10);
            if (typeof (verboseNumber) !== 'number') {
                res.status(400).send(`invalid param verbose. must be a valid integer`);
                return;
            }
            const decodedTx = await bitcoin_client_1.default.getRawTransaction(txid, verboseNumber);
            if (!decodedTx) {
                res.status(400).send(`unable to get raw transaction`);
                return;
            }
            res.status(200).send(decodedTx);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'decodeRawTransaction', res);
        }
    }
    async $sendRawTransaction(req, res) {
        const rawTx = req.body.rawTx;
        try {
            if (typeof (rawTx) !== 'string' || !RAW_TX_REGEX.test(rawTx)) {
                res.status(400).send(`invalid param rawTx. must be a string of hexadecimal characters`);
                return;
            }
            const txHex = await bitcoin_client_1.default.sendRawTransaction(rawTx);
            if (!txHex) {
                res.status(400).send(`unable to send rawTx`);
                return;
            }
            res.status(200).send(txHex);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'sendRawTransaction', res);
        }
    }
    async $testMempoolAccept(req, res) {
        const rawTxs = req.body.rawTxs;
        try {
            if (typeof (rawTxs) !== 'object' || !Array.isArray(rawTxs) || rawTxs.some((tx) => typeof (tx) !== 'string' || !RAW_TX_REGEX.test(tx))) {
                res.status(400).send(`invalid param rawTxs. must be an array of strings of hexadecimal characters`);
                return;
            }
            const txHex = await bitcoin_client_1.default.testMempoolAccept(rawTxs);
            if (typeof (txHex) !== 'object' || txHex.length === 0) {
                res.status(400).send(`testmempoolaccept failed for raw txs, got an empty result`);
                return;
            }
            res.status(200).send(txHex);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'testMempoolAccept', res);
        }
    }
    async $getMempoolAncestors(req, res) {
        const txid = req.query.txid;
        const verbose = req.query.verbose;
        try {
            if (typeof (txid) !== 'string' || txid.length !== 64 || !TXID_REGEX.test(txid)) {
                res.status(400).send(`invalid param txid. must be 64 hexadecimal characters`);
                return;
            }
            if (typeof (verbose) !== 'string' || (verbose !== 'true' && verbose !== 'false')) {
                res.status(400).send(`invalid param verbose. must be a string ('true' | 'false')`);
                return;
            }
            const ancestors = await bitcoin_client_1.default.getMempoolAncestors(txid, verbose === 'true' ? true : false);
            if (!ancestors) {
                res.status(400).send(`unable to get mempool ancestors`);
                return;
            }
            res.status(200).send(ancestors);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'getMempoolAncestors', res);
        }
    }
    async $getBlock(req, res) {
        const blockHash = req.query.hash;
        const verbosity = req.query.verbosity;
        try {
            if (typeof (blockHash) !== 'string' || blockHash.length !== 64 || !BLOCKHASH_REGEX.test(blockHash)) {
                res.status(400).send(`invalid param blockHash. must be 64 hexadecimal characters`);
                return;
            }
            if (typeof (verbosity) !== 'string') {
                res.status(400).send(`invalid param verbosity. must be a string representing an integer`);
                return;
            }
            const verbosityNumber = parseInt(verbosity, 10);
            if (typeof (verbosityNumber) !== 'number') {
                res.status(400).send(`invalid param verbosity. must be a valid integer`);
                return;
            }
            const block = await bitcoin_client_1.default.getBlock(blockHash, verbosityNumber);
            if (!block) {
                res.status(400).send(`unable to get block`);
                return;
            }
            res.status(200).send(block);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'getBlock', res);
        }
    }
    async $getBlockHash(req, res) {
        const blockHeight = req.query.height;
        try {
            if (typeof (blockHeight) !== 'string') {
                res.status(400).send(`invalid param blockHeight, must be a string representing an integer`);
                return;
            }
            const blockHeightNumber = parseInt(blockHeight, 10);
            if (typeof (blockHeightNumber) !== 'number') {
                res.status(400).send(`invalid param blockHeight. must be a valid integer`);
                return;
            }
            const block = await bitcoin_client_1.default.getBlockHash(blockHeightNumber);
            if (!block) {
                res.status(400).send(`unable to get block hash`);
                return;
            }
            res.status(200).send(block);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'getBlockHash', res);
        }
    }
    async $getBlockCount(req, res) {
        try {
            const count = await bitcoin_client_1.default.getBlockCount();
            if (!count) {
                res.status(400).send(`unable to get block count`);
                return;
            }
            res.status(200).send(`${count}`);
        }
        catch (e) {
            BitcoinBackendRoutes.handleException(e, 'getBlockCount', res);
        }
    }
}
exports.default = new BitcoinBackendRoutes;
