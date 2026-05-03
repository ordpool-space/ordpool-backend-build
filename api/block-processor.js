"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTemplateAlgorithm = exports.saveCpfpDataToCpfpSummary = void 0;
const config_1 = __importDefault(require("../config"));
const mempool_interfaces_1 = require("../mempool.interfaces");
const cpfp_1 = require("./cpfp");
const mempool_blocks_1 = __importDefault(require("./mempool-blocks"));
const mempool_1 = __importDefault(require("./mempool"));
const audit_1 = __importDefault(require("./audit"));
const blocks_1 = __importDefault(require("./blocks"));
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
const cluster_mempool_1 = require("../cluster-mempool/cluster-mempool");
const common_1 = require("./common");
const acceleration_1 = __importDefault(require("./services/acceleration"));
const CM_ACTIVATION_HEIGHT = {
    'mainnet': 940000,
    'testnet': 4860000,
    'testnet4': 125000,
    'signet': 294000,
    'regtest': 0,
};
class BlockProcessor {
    /** @asyncUnsafe */
    async $processNewBlock(block, transactions, pool, accelerations) {
        const poolAccelerations = Object.values(accelerations)
            .filter(a => a.pools.includes(pool.uniqueId))
            .map(a => ({ txid: a.txid, max_bid: a.feeDelta }));
        const { templateAlgorithm, cpfpSummary } = detectTemplateAlgorithm(block.height, transactions, poolAccelerations);
        const blockExtended = await blocks_1.default.$getBlockExtended(block, cpfpSummary.transactions, pool);
        const blockSummary = blocks_1.default.summarizeBlockTransactions(block.id, block.height, cpfpSummary.transactions);
        let auditResult;
        if (config_1.default.MEMPOOL.AUDIT && mempool_1.default.isInSync()) {
            auditResult = await this.$runAudit(blockExtended, transactions, templateAlgorithm, pool, accelerations);
            if (blockExtended.extras) {
                blockExtended.extras.matchRate = auditResult.matchRate;
                blockExtended.extras.expectedFees = auditResult.expectedFees;
                blockExtended.extras.expectedWeight = auditResult.expectedWeight;
                blockExtended.extras.similarity = auditResult.similarity;
            }
        }
        else if (blockExtended.extras) {
            const mBlocks = mempool_blocks_1.default.getMempoolBlocksWithTransactions();
            if (mBlocks?.length && mBlocks[0].transactions) {
                blockExtended.extras.similarity = common_1.Common.getSimilarity(mBlocks[0], transactions);
            }
        }
        return {
            templateAlgorithm,
            cpfpSummary,
            blockExtended,
            blockSummary,
            auditResult,
        };
    }
    async $runAudit(block, transactions, templateAlgorithm, pool, accelerations) {
        const auditMempool = mempool_1.default.getMempool();
        const isAccelerated = acceleration_1.default.isAcceleratedBlock(block, Object.values(accelerations));
        const candidateTxs = mempool_1.default.getMempoolCandidates();
        const candidates = (mempool_1.default.limitGBT && candidateTxs)
            ? { txs: candidateTxs, added: [], removed: [] }
            : undefined;
        const transactionIds = (mempool_1.default.limitGBT)
            ? Object.keys(candidates?.txs || {})
            : Object.keys(auditMempool);
        let projectedBlocks;
        if (templateAlgorithm === mempool_interfaces_1.TemplateAlgorithm.clusterMempool) {
            const clusterMempool = mempool_1.default.clusterMempool ?? new cluster_mempool_1.ClusterMempool(auditMempool, accelerations, true, 75000);
            const cmBlocks = clusterMempool.getBlocks(config_1.default.MEMPOOL.MEMPOOL_BLOCKS_AMOUNT) ?? [];
            projectedBlocks = mempool_blocks_1.default.processClusterMempoolBlocks(cmBlocks, auditMempool, accelerations, false, pool.uniqueId);
        }
        else if (config_1.default.MEMPOOL.RUST_GBT) {
            const added = mempool_1.default.limitGBT ? (candidates?.added || []) : [];
            const removed = mempool_1.default.limitGBT ? (candidates?.removed || []) : [];
            projectedBlocks = await mempool_blocks_1.default.$rustUpdateBlockTemplates(transactionIds, auditMempool, added, removed, candidates, isAccelerated, pool.uniqueId, true);
        }
        else {
            projectedBlocks = await mempool_blocks_1.default.$makeBlockTemplates(transactionIds, auditMempool, candidates, false, isAccelerated, pool.uniqueId);
        }
        const auditResult = audit_1.default.auditBlock(block.height, transactions, projectedBlocks, auditMempool);
        const stripped = projectedBlocks[0]?.transactions ? projectedBlocks[0].transactions : [];
        let totalFees = 0;
        let totalWeight = 0;
        for (const tx of stripped) {
            totalFees += tx.fee;
            totalWeight += (tx.vsize * 4);
        }
        return {
            ...auditResult,
            expectedFees: totalFees,
            expectedWeight: totalWeight,
            projectedBlocks,
        };
    }
}
function saveCpfpDataToTransactions(transactions, cpfpData) {
    for (const tx of transactions) {
        if (cpfpData.txs[tx.txid]) {
            Object.assign(tx, cpfpData.txs[tx.txid]);
        }
    }
}
function saveCpfpDataToCpfpSummary(transactions, cpfpData) {
    saveCpfpDataToTransactions(transactions, cpfpData);
    return {
        transactions,
        clusters: cpfpData.clusters,
        version: cpfpData.version,
    };
}
exports.saveCpfpDataToCpfpSummary = saveCpfpDataToCpfpSummary;
/**
 *
 * @param height
 * @param blockTransactions
 * @param poolAccelerations
 * @param fast
 *
 * saves effective fee rates from detected algorithm to blockTransactions
 */
function detectTemplateAlgorithm(height, blockTransactions, poolAccelerations, fast = false) {
    const legacyCpfpData = fast ? (0, cpfp_1.calculateFastBlockCpfp)(height, blockTransactions) : (0, cpfp_1.calculateGoodBlockCpfp)(height, blockTransactions, poolAccelerations);
    if (!config_1.default.MEMPOOL.CLUSTER_MEMPOOL_INDEXING) {
        return {
            templateAlgorithm: mempool_interfaces_1.TemplateAlgorithm.legacy,
            cpfpSummary: saveCpfpDataToCpfpSummary(blockTransactions, legacyCpfpData),
        };
    }
    const network = config_1.default.MEMPOOL.NETWORK || 'mainnet';
    const activationHeight = CM_ACTIVATION_HEIGHT[network] ?? Infinity;
    if (height < activationHeight) {
        return {
            templateAlgorithm: mempool_interfaces_1.TemplateAlgorithm.legacy,
            cpfpSummary: saveCpfpDataToCpfpSummary(blockTransactions, legacyCpfpData),
        };
    }
    const clusterCpfpData = (0, cpfp_1.calculateClusterMempoolBlockCpfp)(height, blockTransactions, poolAccelerations);
    const clusterTxs = blockTransactions.map(tx => ({ txid: tx.txid, rate: clusterCpfpData.txs[tx.txid].effectiveFeePerVsize ?? tx.effectiveFeePerVsize }));
    const legacyTxs = blockTransactions.map(tx => ({ txid: tx.txid, rate: legacyCpfpData.txs[tx.txid].effectiveFeePerVsize ?? tx.effectiveFeePerVsize }));
    const clusterPrioritization = transaction_utils_1.default.identifyPrioritizedTransactions(clusterTxs, 'rate');
    const legacyPrioritization = transaction_utils_1.default.identifyPrioritizedTransactions(legacyTxs, 'rate');
    const clusterCount = clusterPrioritization.prioritized.length + clusterPrioritization.deprioritized.length;
    const legacyCount = legacyPrioritization.prioritized.length + legacyPrioritization.deprioritized.length;
    if (clusterCount < legacyCount) {
        saveCpfpDataToTransactions(blockTransactions, clusterCpfpData);
        return {
            templateAlgorithm: mempool_interfaces_1.TemplateAlgorithm.clusterMempool,
            cpfpSummary: saveCpfpDataToCpfpSummary(blockTransactions, clusterCpfpData),
        };
    }
    else {
        return {
            templateAlgorithm: mempool_interfaces_1.TemplateAlgorithm.legacy,
            cpfpSummary: saveCpfpDataToCpfpSummary(blockTransactions, legacyCpfpData),
        };
    }
}
exports.detectTemplateAlgorithm = detectTemplateAlgorithm;
exports.default = new BlockProcessor();
