"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bitcoinjs = __importStar(require("bitcoinjs-lib"));
const config_1 = __importDefault(require("../../config"));
const websocket_handler_1 = __importDefault(require("../websocket-handler"));
const mempool_1 = __importDefault(require("../mempool"));
const fee_api_1 = __importDefault(require("../fee-api"));
const mempool_blocks_1 = __importDefault(require("../mempool-blocks"));
const bitcoin_api_factory_1 = __importDefault(require("./bitcoin-api-factory"));
const common_1 = require("../common");
const backend_info_1 = __importDefault(require("../backend-info"));
const transaction_utils_1 = __importDefault(require("../transaction-utils"));
const loading_indicators_1 = __importDefault(require("../loading-indicators"));
const logger_1 = __importDefault(require("../../logger"));
const blocks_1 = __importDefault(require("../blocks"));
const bitcoin_client_1 = __importDefault(require("./bitcoin-client"));
const difficulty_adjustment_1 = __importDefault(require("../difficulty-adjustment"));
const TransactionRepository_1 = __importDefault(require("../../repositories/TransactionRepository"));
const rbf_cache_1 = __importDefault(require("../rbf-cache"));
const cpfp_1 = require("../cpfp");
const api_1 = require("../../utils/api");
const pools_updater_1 = __importDefault(require("../../tasks/pools-updater"));
const chain_tips_1 = __importDefault(require("../chain-tips"));
const TXID_REGEX = /^[a-f0-9]{64}$/i;
const BLOCK_HASH_REGEX = /^[a-f0-9]{64}$/i;
const ADDRESS_REGEX = /^[a-z0-9]{2,120}$/i;
const SCRIPT_HASH_REGEX = /^([a-f0-9]{2})+$/i;
class BitcoinRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'transaction-times', this.getTransactionTimes)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'cpfp/:txId', this.$getCpfpInfo)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'difficulty-adjustment', this.getDifficultyChange)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'fees/recommended', this.getRecommendedFees)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'fees/precise', this.getPreciseRecommendedFees)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'fees/mempool-blocks', this.getMempoolBlocks)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'backend-info', this.getBackendInfo)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'init-data', this.getInitData)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'validate-address/:address', this.validateAddress)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/rbf', this.getRbfHistory)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/cached', this.getCachedTx)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'replacements', this.getRbfReplacements)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'fullrbf/replacements', this.getFullRbfReplacements)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/push', this.$postTransactionForm)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks', this.getBlocks.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks/:height', this.getBlocks.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash', this.getBlock)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/summary', this.getStrippedBlockTransactions)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/tx/:txid/summary', this.getStrippedBlockTransaction)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/audit-summary', this.getBlockAuditSummary)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/tx/:txid/audit', this.$getBlockTxAuditSummary)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks/tip/height', this.getBlockTipHeight)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'psbt/addparents', this.postPsbtCompletion)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks-bulk/:from', this.getBlocksByBulk.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks-bulk/:from/:to', this.getBlocksByBulk.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'chain-tips', this.getChainTips.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'stale-tips', this.getStaleTips.bind(this))
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'prevouts', this.$getPrevouts)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'cpfp', this.getCpfpLocalTxs)
            // Temporarily add txs/package endpoint for all backends until esplora supports it
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'txs/package', this.$submitPackage)
            // Internal routes
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/blocks/definition/list', this.getBlockDefinitionHashes)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/blocks/definition/current', this.getCurrentBlockDefinitionHash)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'internal/blocks/:definitionHash', this.getBlocksByDefinitionHash);
        if (config_1.default.MEMPOOL.BACKEND !== 'esplora') {
            app
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mempool', this.getMempool)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mempool/txids', this.getMempoolTxIds)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mempool/recent', this.getRecentMempoolTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId', this.getTransaction)
                .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx', this.$postTransaction)
                .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'txs/test', this.$testTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/hex', this.getRawTransaction)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/status', this.getTransactionStatus)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/outspends', this.getTransactionOutspends)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'tx/:txId/merkle-proof', this.getTransactionMerkleProof)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'txs/outspends', this.$getBatchedOutspends)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/header', this.getBlockHeader)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'blocks/tip/hash', this.getBlockTipHash)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/raw', this.getRawBlock)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/txids', this.getTxIdsForBlock)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/txs', this.getBlockTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block/:hash/txs/:index', this.getBlockTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'block-height/:height', this.getBlockHeight)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'address/:address', this.getAddress)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'address/:address/txs', this.getAddressTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'address/:address/txs/summary', this.getAddressTransactionSummary)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'address/:address/utxo', this.getAddressUtxo)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'scripthash/:scripthash', this.getScriptHash)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'scripthash/:scripthash/txs', this.getScriptHashTransactions)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'scripthash/:scripthash/txs/summary', this.getScriptHashTransactionSummary)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'scripthash/:scripthash/utxo', this.getScriptHashUtxo)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'address-prefix/:prefix', this.getAddressPrefix);
        }
    }
    getInitData(req, res) {
        try {
            const result = websocket_handler_1.default.getSerializedInitData();
            res.set('Content-Type', 'application/json');
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get init data');
        }
    }
    getRecommendedFees(req, res) {
        if (!mempool_1.default.isInSync()) {
            res.statusCode = 503;
            res.send('Service Unavailable');
            return;
        }
        const result = fee_api_1.default.getRecommendedFee();
        res.json(result);
    }
    getPreciseRecommendedFees(req, res) {
        if (!mempool_1.default.isInSync()) {
            res.statusCode = 503;
            res.send('Service Unavailable');
            return;
        }
        const result = fee_api_1.default.getPreciseRecommendedFee();
        res.json(result);
    }
    getMempoolBlocks(req, res) {
        try {
            const result = mempool_blocks_1.default.getMempoolBlocks();
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get mempool blocks');
        }
    }
    getTransactionTimes(req, res) {
        if (!req.query.txId || typeof req.query.txId !== 'object') {
            (0, api_1.handleError)(req, res, 500, 'invalid txId format');
            return;
        }
        const txIds = [];
        for (const txid of Object.values(req.query.txId)) {
            if (typeof txid === 'string' && TXID_REGEX.test(txid)) {
                txIds.push(txid);
            }
        }
        const times = mempool_1.default.getFirstSeenForTransactions(txIds);
        res.json(times);
    }
    async $getBatchedOutspends(req, res) {
        const txids_csv = req.query.txids;
        if (!txids_csv || typeof txids_csv !== 'string') {
            (0, api_1.handleError)(req, res, 500, 'Invalid txids format');
            return;
        }
        const txids = txids_csv.split(',');
        if (txids.length > 50) {
            (0, api_1.handleError)(req, res, 400, 'Too many txids requested');
            return;
        }
        if (txids.some((txid) => !TXID_REGEX.test(txid))) {
            (0, api_1.handleError)(req, res, 400, 'Invalid txids format');
            return;
        }
        try {
            const batchedOutspends = await bitcoin_api_factory_1.default.$getBatchedOutspends(txids);
            res.json(batchedOutspends);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get batched outspends');
        }
    }
    async $getCpfpInfo(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        const tx = mempool_1.default.getMempool()[req.params.txId];
        if (tx) {
            if (tx?.cpfpChecked) {
                const response = {
                    ancestors: tx.ancestors || [],
                    bestDescendant: tx.bestDescendant || null,
                    descendants: tx.descendants,
                    effectiveFeePerVsize: tx.effectiveFeePerVsize,
                    sigops: tx.sigops,
                    fee: tx.fee,
                    adjustedVsize: tx.adjustedVsize,
                    acceleration: tx.acceleration,
                    acceleratedBy: tx.acceleratedBy || undefined,
                    acceleratedAt: tx.acceleratedAt || undefined,
                    feeDelta: tx.feeDelta || undefined,
                };
                if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL && tx.clusterId != null) {
                    const cluster = mempool_1.default.clusterMempool?.getClusterForApi(req.params.txId);
                    if (cluster) {
                        response.cluster = cluster;
                    }
                }
                res.json(response);
                return;
            }
            const cpfpInfo = (0, cpfp_1.calculateMempoolTxCpfp)(tx, mempool_1.default.getMempool());
            res.json(cpfpInfo);
            return;
        }
        else {
            let cpfpInfo;
            if (config_1.default.DATABASE.ENABLED) {
                try {
                    cpfpInfo = await TransactionRepository_1.default.$getCpfpInfo(req.params.txId);
                }
                catch (e) {
                    (0, api_1.handleError)(req, res, 500, 'Failed to get CPFP info');
                    return;
                }
            }
            if (cpfpInfo) {
                res.json(cpfpInfo);
                return;
            }
            else {
                res.json({
                    ancestors: []
                });
                return;
            }
        }
    }
    getBackendInfo(req, res) {
        res.json(backend_info_1.default.getBackendInfo());
    }
    async getTransaction(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const transaction = await transaction_utils_1.default.$getTransactionExtended(req.params.txId, true, false, false, true);
            res.json(transaction);
        }
        catch (e) {
            let statusCode = 500;
            if (e instanceof Error && e instanceof Error && e.message && e.message.indexOf('No such mempool or blockchain transaction') > -1) {
                statusCode = 404;
                (0, api_1.handleError)(req, res, statusCode, 'No such mempool or blockchain transaction');
                return;
            }
            (0, api_1.handleError)(req, res, statusCode, 'Failed to get transaction');
        }
    }
    async getRawTransaction(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const transaction = await bitcoin_api_factory_1.default.$getRawTransaction(req.params.txId, true);
            res.setHeader('content-type', 'text/plain');
            res.send(transaction.hex);
        }
        catch (e) {
            let statusCode = 500;
            if (e instanceof Error && e.message && e.message.indexOf('No such mempool or blockchain transaction') > -1) {
                statusCode = 404;
                (0, api_1.handleError)(req, res, statusCode, 'No such mempool or blockchain transaction');
                return;
            }
            (0, api_1.handleError)(req, res, statusCode, 'Failed to get raw transaction');
        }
    }
    /**
     * Takes the PSBT as text/plain body, parses it, and adds the full
     * parent transaction to each input that doesn't already have it.
     * This is used for BTCPayServer / Trezor users which need access to
     * the full parent transaction even with segwit inputs.
     * It will respond with a text/plain PSBT in the same format (hex|base64).
     */
    async postPsbtCompletion(req, res) {
        res.setHeader('content-type', 'text/plain');
        const notFoundError = `Couldn't get transaction hex for parent of input`;
        try {
            let psbt;
            let format;
            let isModified = false;
            try {
                psbt = bitcoinjs.Psbt.fromBase64(req.body);
                format = 'base64';
            }
            catch (e1) {
                try {
                    psbt = bitcoinjs.Psbt.fromHex(req.body);
                    format = 'hex';
                }
                catch (e2) {
                    throw new Error(`Unable to parse PSBT`);
                }
            }
            for (const [index, input] of psbt.data.inputs.entries()) {
                if (!input.nonWitnessUtxo) {
                    // Buffer.from ensures it won't be modified in place by reverse()
                    const txid = Buffer.from(psbt.txInputs[index].hash)
                        .reverse()
                        .toString('hex');
                    let transactionHex;
                    // If missing transaction, return 404 status error
                    try {
                        transactionHex = await bitcoin_api_factory_1.default.$getTransactionHex(txid);
                        if (!transactionHex) {
                            throw new Error('');
                        }
                    }
                    catch (err) {
                        throw new Error(`${notFoundError} #${index} @ ${txid}`);
                    }
                    psbt.updateInput(index, {
                        nonWitnessUtxo: Buffer.from(transactionHex, 'hex'),
                    });
                    if (!isModified) {
                        isModified = true;
                    }
                }
            }
            if (isModified) {
                res.send(format === 'hex' ? psbt.toHex() : psbt.toBase64());
            }
            else {
                // Not modified
                // 422 Unprocessable Entity
                // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/422
                (0, api_1.handleError)(req, res, 422, `Psbt had no missing nonWitnessUtxos.`);
            }
        }
        catch (e) {
            if (e instanceof Error && new RegExp(notFoundError).test(e.message)) {
                (0, api_1.handleError)(req, res, 404, notFoundError);
            }
            else {
                (0, api_1.handleError)(req, res, 500, 'Failed to process PSBT');
            }
        }
    }
    async getTransactionStatus(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const transaction = await transaction_utils_1.default.$getTransactionExtended(req.params.txId, true);
            res.json(transaction.status);
        }
        catch (e) {
            let statusCode = 500;
            if (e instanceof Error && e.message && e.message.indexOf('No such mempool or blockchain transaction') > -1) {
                statusCode = 404;
                (0, api_1.handleError)(req, res, statusCode, 'No such mempool or blockchain transaction');
                return;
            }
            (0, api_1.handleError)(req, res, statusCode, 'Failed to get transaction status');
        }
    }
    async getStrippedBlockTransactions(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const transactions = await blocks_1.default.$getStrippedBlockTransactions(req.params.hash);
            res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24 * 30).toUTCString());
            res.json(transactions);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block summary');
        }
    }
    async getStrippedBlockTransaction(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        if (!TXID_REGEX.test(req.params.txid)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const transaction = await blocks_1.default.$getSingleTxFromSummary(req.params.hash, req.params.txid);
            if (!transaction) {
                (0, api_1.handleError)(req, res, 404, `Transaction not found in summary`);
                return;
            }
            res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24 * 30).toUTCString());
            res.json(transaction);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get transaction from summary');
        }
    }
    async getBlock(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const block = await blocks_1.default.$getBlock(req.params.hash);
            const blockAge = new Date().getTime() / 1000 - block.timestamp;
            const day = 24 * 3600;
            let cacheDuration;
            if (blockAge > 365 * day) {
                cacheDuration = 30 * day;
            }
            else if (blockAge > 30 * day) {
                cacheDuration = 10 * day;
            }
            else {
                cacheDuration = 600;
            }
            res.setHeader('Expires', new Date(Date.now() + 1000 * cacheDuration).toUTCString());
            res.json(block);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, e?.response?.status === 404 ? 404 : 500, 'Failed to get block');
        }
    }
    async getBlockHeader(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const blockHeader = await bitcoin_api_factory_1.default.$getBlockHeader(req.params.hash);
            res.setHeader('content-type', 'text/plain');
            res.send(blockHeader);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block header');
        }
    }
    async getBlockAuditSummary(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const auditSummary = await blocks_1.default.$getBlockAuditSummary(req.params.hash);
            if (auditSummary) {
                res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24 * 30).toUTCString());
                res.json(auditSummary);
            }
            else {
                (0, api_1.handleError)(req, res, 404, `Audit not available`);
                return;
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block audit summary');
        }
    }
    async $getBlockTxAuditSummary(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        if (!TXID_REGEX.test(req.params.txid)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const auditSummary = await blocks_1.default.$getBlockTxAuditSummary(req.params.hash, req.params.txid);
            if (auditSummary) {
                res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24 * 30).toUTCString());
                res.json(auditSummary);
            }
            else {
                (0, api_1.handleError)(req, res, 404, `Transaction audit not available`);
                return;
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get transaction audit summary');
        }
    }
    async getBlocks(req, res) {
        try {
            if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) { // Bitcoin
                const height = req.params.height === undefined ? undefined : parseInt(req.params.height, 10);
                res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
                res.json(await blocks_1.default.$getBlocks(height, 15));
            }
            else { // Liquid
                return await this.getLegacyBlocks(req, res);
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get blocks');
        }
    }
    async getBlocksByBulk(req, res) {
        try {
            if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) === false) { // Liquid - Not implemented
                (0, api_1.handleError)(req, res, 404, `This API is only available for Bitcoin networks`);
                return;
            }
            if (config_1.default.MEMPOOL.MAX_BLOCKS_BULK_QUERY <= 0) {
                (0, api_1.handleError)(req, res, 404, `This API is disabled. Set config.MEMPOOL.MAX_BLOCKS_BULK_QUERY to a positive number to enable it.`);
                return;
            }
            if (!common_1.Common.indexingEnabled()) {
                (0, api_1.handleError)(req, res, 404, `Indexing is required for this API`);
                return;
            }
            const from = parseInt(req.params.from, 10);
            if (!req.params.from || from < 0) {
                (0, api_1.handleError)(req, res, 400, `Parameter 'from' must be a block height (integer)`);
                return;
            }
            const to = req.params.to === undefined ? await bitcoin_api_factory_1.default.$getBlockHeightTip() : parseInt(req.params.to, 10);
            if (to < 0) {
                (0, api_1.handleError)(req, res, 400, `Parameter 'to' must be a block height (integer)`);
                return;
            }
            if (from > to) {
                (0, api_1.handleError)(req, res, 400, `Parameter 'to' must be a higher block height than 'from'`);
                return;
            }
            if ((to - from + 1) > config_1.default.MEMPOOL.MAX_BLOCKS_BULK_QUERY) {
                (0, api_1.handleError)(req, res, 400, `You can only query ${config_1.default.MEMPOOL.MAX_BLOCKS_BULK_QUERY} blocks at once.`);
                return;
            }
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(await blocks_1.default.$getBlocksBetweenHeight(from, to));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get blocks');
        }
    }
    async getChainTips(req, res) {
        try {
            if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) { // Bitcoin
                res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
                const tips = await chain_tips_1.default.getChainTips();
                if (tips.length > 0) {
                    res.json(tips);
                }
                else {
                    (0, api_1.handleError)(req, res, 503, `Temporarily unavailable`);
                    return;
                }
            }
            else { // Liquid
                (0, api_1.handleError)(req, res, 404, `This API is only available for Bitcoin networks`);
                return;
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get chain tips');
        }
    }
    async getStaleTips(req, res) {
        try {
            if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) { // Bitcoin
                res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
                const tips = await chain_tips_1.default.getStaleTips();
                if (tips.length > 0) {
                    res.json(tips);
                }
                else {
                    (0, api_1.handleError)(req, res, 503, `Temporarily unavailable`);
                    return;
                }
            }
            else { // Liquid
                (0, api_1.handleError)(req, res, 404, `This API is only available for Bitcoin networks`);
                return;
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get stale tips');
        }
    }
    async getLegacyBlocks(req, res) {
        try {
            const returnBlocks = [];
            const tip = blocks_1.default.getCurrentBlockHeight();
            const fromHeight = Math.min(parseInt(req.params.height, 10) || tip, tip);
            // Check if block height exist in local cache to skip the hash lookup
            const blockByHeight = blocks_1.default.getBlocks().find((b) => b.height === fromHeight);
            let startFromHash = null;
            if (blockByHeight) {
                startFromHash = blockByHeight.id;
            }
            else {
                startFromHash = await bitcoin_api_factory_1.default.$getBlockHash(fromHeight);
            }
            let nextHash = startFromHash;
            for (let i = 0; i < 15 && nextHash; i++) {
                const localBlock = blocks_1.default.getBlocks().find((b) => b.id === nextHash);
                if (localBlock) {
                    returnBlocks.push(localBlock);
                    nextHash = localBlock.previousblockhash;
                }
                else {
                    const block = await bitcoin_api_factory_1.default.$getBlock(nextHash);
                    returnBlocks.push(block);
                    nextHash = block.previousblockhash;
                }
            }
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(returnBlocks);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get blocks');
        }
    }
    async getBlockTransactions(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            loading_indicators_1.default.setProgress('blocktxs-' + req.params.hash, 0);
            const txIds = await bitcoin_api_factory_1.default.$getTxIdsForBlock(req.params.hash);
            const transactions = [];
            const startingIndex = Math.max(0, parseInt(req.params.index || '0', 10));
            const endIndex = Math.min(startingIndex + 10, txIds.length);
            for (let i = startingIndex; i < endIndex; i++) {
                try {
                    const transaction = await transaction_utils_1.default.$getTransactionExtended(txIds[i], true, true);
                    transactions.push(transaction);
                    loading_indicators_1.default.setProgress('blocktxs-' + req.params.hash, (i - startingIndex + 1) / (endIndex - startingIndex) * 100);
                }
                catch (e) {
                    logger_1.default.debug('getBlockTransactions error: ' + (e instanceof Error ? e.message : e));
                }
            }
            res.json(transactions);
        }
        catch (e) {
            loading_indicators_1.default.setProgress('blocktxs-' + req.params.hash, 100);
            (0, api_1.handleError)(req, res, 500, 'Failed to get block transactions');
        }
    }
    async getBlockHeight(req, res) {
        try {
            const blockHash = await bitcoin_api_factory_1.default.$getBlockHash(parseInt(req.params.height, 10));
            res.send(blockHash);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block at height');
        }
    }
    async getAddress(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!ADDRESS_REGEX.test(req.params.address)) {
            (0, api_1.handleError)(req, res, 501, `Invalid address`);
            return;
        }
        try {
            const addressData = await bitcoin_api_factory_1.default.$getAddress(req.params.address);
            res.json(addressData);
        }
        catch (e) {
            if (e instanceof Error && e.message === 'Invalid Bitcoin address') {
                res.status(400).send(e.message);
                return;
            }
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get address');
        }
    }
    async getAddressTransactions(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!ADDRESS_REGEX.test(req.params.address)) {
            (0, api_1.handleError)(req, res, 501, `Invalid address`);
            return;
        }
        try {
            let lastTxId = '';
            if (req.query.after_txid && typeof req.query.after_txid === 'string') {
                lastTxId = req.query.after_txid;
            }
            const transactions = await bitcoin_api_factory_1.default.$getAddressTransactions(req.params.address, lastTxId);
            res.json(transactions);
        }
        catch (e) {
            if (e instanceof Error && e.message === 'Invalid Bitcoin address') {
                res.status(400).send(e.message);
                return;
            }
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get address transactions');
        }
    }
    async getAddressUtxo(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!ADDRESS_REGEX.test(req.params.address)) {
            (0, api_1.handleError)(req, res, 501, `Invalid address`);
            return;
        }
        try {
            const addressData = await bitcoin_api_factory_1.default.$getAddressUtxos(req.params.address);
            res.json(addressData);
        }
        catch (e) {
            if (e instanceof Error && e.message === 'Invalid Bitcoin address') {
                res.status(400).send(e.message);
                return;
            }
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get address');
        }
    }
    async getAddressTransactionSummary(req, res) {
        if (config_1.default.MEMPOOL.BACKEND !== 'esplora') {
            (0, api_1.handleError)(req, res, 405, 'Address summary lookups require mempool/electrs backend.');
            return;
        }
    }
    async getScriptHash(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!SCRIPT_HASH_REGEX.test(req.params.scripthash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid scripthash`);
            return;
        }
        try {
            // electrum expects scripthashes in little-endian
            const electrumScripthash = req.params.scripthash.match(/../g)?.reverse().join('') ?? '';
            const addressData = await bitcoin_api_factory_1.default.$getScriptHash(electrumScripthash);
            res.json(addressData);
        }
        catch (e) {
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get script hash');
        }
    }
    async getScriptHashTransactions(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!SCRIPT_HASH_REGEX.test(req.params.scripthash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid scripthash`);
            return;
        }
        try {
            // electrum expects scripthashes in little-endian
            const electrumScripthash = req.params.scripthash.match(/../g)?.reverse().join('') ?? '';
            let lastTxId = '';
            if (req.query.after_txid && typeof req.query.after_txid === 'string') {
                lastTxId = req.query.after_txid;
            }
            const transactions = await bitcoin_api_factory_1.default.$getScriptHashTransactions(electrumScripthash, lastTxId);
            res.json(transactions);
        }
        catch (e) {
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get script hash transactions');
        }
    }
    async getScriptHashUtxo(req, res) {
        if (config_1.default.MEMPOOL.BACKEND === 'none') {
            (0, api_1.handleError)(req, res, 405, 'Address lookups cannot be used with bitcoind as backend.');
            return;
        }
        if (!SCRIPT_HASH_REGEX.test(req.params.scripthash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid scripthash`);
            return;
        }
        try {
            // electrum expects scripthashes in little-endian
            const electrumScripthash = req.params.scripthash.match(/../g)?.reverse().join('') ?? '';
            const addressData = await bitcoin_api_factory_1.default.$getScriptHashUtxos(electrumScripthash);
            res.json(addressData);
        }
        catch (e) {
            if (e instanceof Error && e.message && (e.message.indexOf('too long') > 0 || e.message.indexOf('confirmed status') > 0)) {
                (0, api_1.handleError)(req, res, 413, e.message);
                return;
            }
            (0, api_1.handleError)(req, res, 500, 'Failed to get script hash');
        }
    }
    async getScriptHashTransactionSummary(req, res) {
        if (config_1.default.MEMPOOL.BACKEND !== 'esplora') {
            (0, api_1.handleError)(req, res, 405, 'Scripthash summary lookups require mempool/electrs backend.');
            return;
        }
    }
    async getAddressPrefix(req, res) {
        try {
            const addressPrefix = await bitcoin_api_factory_1.default.$getAddressPrefix(req.params.prefix);
            res.send(addressPrefix);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get address prefix');
        }
    }
    async getRecentMempoolTransactions(req, res) {
        const latestTransactions = Object.entries(mempool_1.default.getMempool())
            .sort((a, b) => (b[1].firstSeen || 0) - (a[1].firstSeen || 0))
            .slice(0, 10).map((tx) => common_1.Common.stripTransaction(tx[1]));
        res.json(latestTransactions);
    }
    async getMempool(req, res) {
        const info = mempool_1.default.getMempoolInfo();
        res.json({
            count: info.size,
            vsize: info.bytes,
            total_fee: info.total_fee * 1e8,
            fee_histogram: []
        });
    }
    async getMempoolTxIds(req, res) {
        try {
            const rawMempool = await bitcoin_api_factory_1.default.$getRawMempool();
            res.send(rawMempool);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, e instanceof Error ? e.message : e);
        }
    }
    async getBlockDefinitionHashes(req, res) {
        try {
            const result = await blocks_1.default.$getBlockDefinitionHashes();
            if (!result) {
                (0, api_1.handleError)(req, res, 503, `Service Temporarily Unavailable`);
                return;
            }
            res.setHeader('content-type', 'application/json');
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, e instanceof Error ? e.message : e);
        }
    }
    async getCurrentBlockDefinitionHash(req, res) {
        try {
            const currentSha = await pools_updater_1.default.getShaFromDb();
            if (!currentSha) {
                (0, api_1.handleError)(req, res, 503, `Service Temporarily Unavailable`);
                return;
            }
            res.setHeader('content-type', 'text/plain');
            res.send(currentSha);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, e instanceof Error ? e.message : e);
        }
    }
    async getBlocksByDefinitionHash(req, res) {
        try {
            if (typeof (req.params.definitionHash) !== 'string') {
                res.status(400).send('Parameter "hash" must be a valid string');
                return;
            }
            const blocksHash = await blocks_1.default.$getBlocksByDefinitionHash(req.params.definitionHash);
            if (!blocksHash) {
                (0, api_1.handleError)(req, res, 503, `Service Temporarily Unavailable`);
                return;
            }
            res.setHeader('content-type', 'application/json');
            res.send(blocksHash);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, e instanceof Error ? e.message : e);
        }
    }
    getBlockTipHeight(req, res) {
        try {
            const result = blocks_1.default.getCurrentBlockHeight();
            if (!result) {
                (0, api_1.handleError)(req, res, 503, `Service Temporarily Unavailable`);
                return;
            }
            res.setHeader('content-type', 'text/plain');
            res.send(result.toString());
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get height at tip');
        }
    }
    async getBlockTipHash(req, res) {
        try {
            const result = await bitcoin_api_factory_1.default.$getBlockHashTip();
            res.setHeader('content-type', 'text/plain');
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get hash at tip');
        }
    }
    async getRawBlock(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const result = await bitcoin_api_factory_1.default.$getRawBlock(req.params.hash);
            res.setHeader('content-type', 'application/octet-stream');
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get raw block');
        }
    }
    async getTxIdsForBlock(req, res) {
        if (!BLOCK_HASH_REGEX.test(req.params.hash)) {
            (0, api_1.handleError)(req, res, 501, `Invalid block hash`);
            return;
        }
        try {
            const result = await bitcoin_api_factory_1.default.$getTxIdsForBlock(req.params.hash);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get txids for block');
        }
    }
    async validateAddress(req, res) {
        if (!ADDRESS_REGEX.test(req.params.address)) {
            (0, api_1.handleError)(req, res, 501, `Invalid address`);
            return;
        }
        try {
            const result = await bitcoin_client_1.default.validateAddress(req.params.address);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to validate address');
        }
    }
    async getRbfHistory(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const replacements = rbf_cache_1.default.getRbfTree(req.params.txId) || null;
            const replaces = rbf_cache_1.default.getReplaces(req.params.txId) || null;
            res.json({
                replacements,
                replaces
            });
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get rbf history');
        }
    }
    async getRbfReplacements(req, res) {
        try {
            const result = rbf_cache_1.default.getRbfTrees(false);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get rbf trees');
        }
    }
    async getFullRbfReplacements(req, res) {
        try {
            const result = rbf_cache_1.default.getRbfTrees(true);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get full rbf replacements');
        }
    }
    async getCachedTx(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const result = rbf_cache_1.default.getTx(req.params.txId);
            if (result) {
                res.json(result);
            }
            else {
                res.status(204).send();
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get cached tx');
        }
    }
    async getTransactionOutspends(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const result = await bitcoin_api_factory_1.default.$getOutspends(req.params.txId);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get transaction outspends');
        }
    }
    async getTransactionMerkleProof(req, res) {
        if (!TXID_REGEX.test(req.params.txId)) {
            (0, api_1.handleError)(req, res, 501, `Invalid transaction ID`);
            return;
        }
        try {
            const result = await bitcoin_api_factory_1.default.$getTransactionMerkleProof(req.params.txId);
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, e instanceof Error ? e.message : 'Failed to get transaction merkle proof');
        }
    }
    getDifficultyChange(req, res) {
        try {
            const da = difficulty_adjustment_1.default.getDifficultyAdjustment();
            if (da) {
                res.json(da);
            }
            else {
                (0, api_1.handleError)(req, res, 503, `Service Temporarily Unavailable`);
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get difficulty change');
        }
    }
    async $postTransaction(req, res) {
        res.setHeader('content-type', 'text/plain');
        try {
            const rawTx = common_1.Common.getTransactionFromRequest(req, false);
            const txIdResult = await bitcoin_api_factory_1.default.$sendRawTransaction(rawTx);
            res.send(txIdResult);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 400, (e.message && e.code) ? 'sendrawtransaction RPC error: ' + JSON.stringify({ code: e.code })
                : 'Failed to send raw transaction');
        }
    }
    async $postTransactionForm(req, res) {
        res.setHeader('content-type', 'text/plain');
        try {
            const txHex = common_1.Common.getTransactionFromRequest(req, true);
            const txIdResult = await bitcoin_client_1.default.sendRawTransaction(txHex);
            res.send(txIdResult);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 400, (e.message && e.code) ? 'sendrawtransaction RPC error: ' + JSON.stringify({ code: e.code })
                : 'Failed to send raw transaction');
        }
    }
    async $testTransactions(req, res) {
        try {
            const rawTxs = common_1.Common.getTransactionsFromRequest(req);
            const maxfeerate = parseFloat(req.query.maxfeerate);
            const result = await bitcoin_api_factory_1.default.$testMempoolAccept(rawTxs, maxfeerate);
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 400, (e.message && e.code) ? 'testmempoolaccept RPC error: ' + JSON.stringify({ code: e.code })
                : 'Failed to test transactions');
        }
    }
    async $submitPackage(req, res) {
        try {
            const rawTxs = common_1.Common.getTransactionsFromRequest(req);
            const maxfeerate = parseFloat(req.query.maxfeerate);
            const maxburnamount = parseFloat(req.query.maxburnamount);
            const result = await bitcoin_client_1.default.submitPackage(rawTxs, maxfeerate ?? undefined, maxburnamount ?? undefined);
            res.send(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 400, (e.message && e.code) ? 'submitpackage RPC error: ' + JSON.stringify({ code: e.code })
                : 'Failed to submit package');
        }
    }
    async $getPrevouts(req, res) {
        try {
            const outpoints = req.body;
            if (!Array.isArray(outpoints) || outpoints.some((item) => !/^[a-fA-F0-9]{64}$/.test(item.txid) || typeof item.vout !== 'number')) {
                (0, api_1.handleError)(req, res, 400, 'Invalid outpoints format');
                return;
            }
            if (outpoints.length > 100) {
                (0, api_1.handleError)(req, res, 400, 'Too many outpoints requested');
                return;
            }
            const result = Array(outpoints.length).fill(null);
            const memPool = mempool_1.default.getMempool();
            for (let i = 0; i < outpoints.length; i++) {
                const outpoint = outpoints[i];
                let prevout = null;
                let unconfirmed = null;
                const mempoolTx = memPool[outpoint.txid];
                if (mempoolTx) {
                    if (outpoint.vout < mempoolTx.vout.length) {
                        prevout = mempoolTx.vout[outpoint.vout];
                        unconfirmed = true;
                    }
                }
                else {
                    try {
                        const rawPrevout = await bitcoin_client_1.default.getTxOut(outpoint.txid, outpoint.vout, false);
                        if (rawPrevout) {
                            prevout = {
                                value: Math.round(rawPrevout.value * 100000000),
                                scriptpubkey: rawPrevout.scriptPubKey.hex,
                                scriptpubkey_asm: rawPrevout.scriptPubKey.asm ? transaction_utils_1.default.convertScriptSigAsm(rawPrevout.scriptPubKey.hex) : '',
                                scriptpubkey_type: transaction_utils_1.default.translateScriptPubKeyType(rawPrevout.scriptPubKey.type),
                                scriptpubkey_address: rawPrevout.scriptPubKey && rawPrevout.scriptPubKey.address ? rawPrevout.scriptPubKey.address : '',
                            };
                            unconfirmed = false;
                        }
                    }
                    catch (e) {
                        // Ignore bitcoin client errors, just leave prevout as null
                    }
                }
                if (prevout) {
                    result[i] = { prevout, unconfirmed };
                }
            }
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get prevouts');
        }
    }
    getCpfpLocalTxs(req, res) {
        try {
            const transactions = req.body;
            if (!Array.isArray(transactions) || transactions.some(tx => !tx || typeof tx !== 'object' ||
                !/^[a-fA-F0-9]{64}$/.test(tx.txid) ||
                typeof tx.weight !== 'number' ||
                typeof tx.sigops !== 'number' ||
                typeof tx.fee !== 'number' ||
                !Array.isArray(tx.vin) ||
                !Array.isArray(tx.vout))) {
                (0, api_1.handleError)(req, res, 400, 'Invalid transactions format');
                return;
            }
            if (transactions.length > 1) {
                (0, api_1.handleError)(req, res, 400, 'More than one transaction is not supported yet');
                return;
            }
            const cpfpInfo = (0, cpfp_1.calculateMempoolTxCpfp)(transactions[0], mempool_1.default.getMempool(), true);
            res.json([cpfpInfo]);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to calculate CPFP info');
        }
    }
}
exports.default = new BitcoinRoutes();
