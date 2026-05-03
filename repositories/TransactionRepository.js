"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const mempool_interfaces_1 = require("../mempool.interfaces");
const CpfpRepository_1 = __importDefault(require("./CpfpRepository"));
class TransactionRepository {
    async $setCluster(txid, clusterRoot) {
        try {
            await database_1.default.query(`
          INSERT INTO compact_transactions
          (
            txid,
            cluster
          )
          VALUE (UNHEX(?), UNHEX(?))
          ON DUPLICATE KEY UPDATE
            cluster = UNHEX(?)
        ;`, [txid, clusterRoot, clusterRoot]);
        }
        catch (e) {
            logger_1.default.err(`Cannot save transaction cpfp cluster into db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    buildBatchSetQuery(txs) {
        let query = `
          INSERT IGNORE INTO compact_transactions
          (
            txid,
            cluster
          )
          VALUES
      `;
        query += txs.map(tx => {
            return (' (UNHEX(?), UNHEX(?))');
        }) + ';';
        const values = txs.map(tx => [tx.txid, tx.cluster]).flat();
        return {
            query,
            params: values,
        };
    }
    async $batchSetCluster(txs) {
        try {
            const query = this.buildBatchSetQuery(txs);
            await database_1.default.query(query.query, query.params);
        }
        catch (e) {
            logger_1.default.err(`Cannot save cpfp transactions into db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $getCpfpInfo(txid) {
        try {
            const [txRows] = await database_1.default.query(`
          SELECT HEX(txid) as id, HEX(cluster) as root
          FROM compact_transactions
          WHERE txid = UNHEX(?)
        `, [txid]);
            if (txRows.length && txRows[0].root != null) {
                const txid = txRows[0].id.toLowerCase();
                const clusterId = txRows[0].root.toLowerCase();
                const cluster = await CpfpRepository_1.default.$getCluster(clusterId);
                if (cluster) {
                    if (cluster.templateAlgorithm === mempool_interfaces_1.TemplateAlgorithm.clusterMempool && cluster.clusterData) {
                        return this.convertCpfpCM(txid, cluster);
                    }
                    return this.convertCpfp(txid, cluster);
                }
            }
        }
        catch (e) {
            logger_1.default.err('Cannot get transaction cpfp info from db. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $removeTransaction(txid) {
        try {
            await database_1.default.query(`
          DELETE FROM compact_transactions
          WHERE txid = UNHEX(?)
        `, [txid]);
        }
        catch (e) {
            logger_1.default.warn('Cannot delete transaction cpfp info from db. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    convertCpfp(txid, cluster) {
        const descendants = [];
        const ancestors = [];
        let matched = false;
        for (const tx of (cluster?.txs || [])) {
            if (tx.txid === txid) {
                matched = true;
            }
            else if (!matched) {
                descendants.push(tx);
            }
            else {
                ancestors.push(tx);
            }
        }
        return {
            descendants,
            ancestors,
            effectiveFeePerVsize: cluster.effectiveFeePerVsize,
        };
    }
    convertCpfpCM(txid, cluster) {
        const clusterData = cluster.clusterData;
        if (!clusterData) {
            return { ancestors: [], descendants: [], effectiveFeePerVsize: 0 };
        }
        // Find which chunk this tx belongs to
        let txFlatIdx = -1;
        let txChunkIndex = -1;
        for (let i = 0; i < clusterData.txs.length; i++) {
            if (clusterData.txs[i].txid === txid) {
                txFlatIdx = i;
                break;
            }
        }
        // Find the chunk containing this tx
        for (let chunkIdx = 0; chunkIdx < clusterData.chunks.length; chunkIdx++) {
            if (clusterData.chunks[chunkIdx].txs.includes(txFlatIdx)) {
                txChunkIndex = chunkIdx;
                break;
            }
        }
        // Derive ancestors/descendants from in-chunk depgraph parents
        // For CM, ancestors are the tx's depgraph parents within the cluster,
        // descendants are txs that depend on this tx
        const ancestors = [];
        const descendants = [];
        if (txFlatIdx >= 0) {
            // Build child map
            const childMap = new Map();
            for (let i = 0; i < clusterData.txs.length; i++) {
                for (const parentIdx of clusterData.txs[i].parents) {
                    let children = childMap.get(parentIdx);
                    if (!children) {
                        children = [];
                        childMap.set(parentIdx, children);
                    }
                    children.push(i);
                }
            }
            const ancestorSet = new Set();
            const stack = [...clusterData.txs[txFlatIdx].parents];
            while (stack.length) {
                const idx = stack.pop();
                if (idx === undefined || ancestorSet.has(idx)) {
                    continue;
                }
                ancestorSet.add(idx);
                stack.push(...clusterData.txs[idx].parents);
            }
            const descendantSet = new Set();
            const dStack = [...(childMap.get(txFlatIdx) || [])];
            while (dStack.length) {
                const idx = dStack.pop();
                if (idx === undefined || descendantSet.has(idx)) {
                    continue;
                }
                descendantSet.add(idx);
                dStack.push(...(childMap.get(idx) || []));
            }
            for (const idx of ancestorSet) {
                const tx = clusterData.txs[idx];
                ancestors.push({ txid: tx.txid, weight: tx.weight, fee: tx.fee });
            }
            for (const idx of descendantSet) {
                const tx = clusterData.txs[idx];
                descendants.push({ txid: tx.txid, weight: tx.weight, fee: tx.fee });
            }
        }
        const effectiveFeePerVsize = txChunkIndex >= 0 ? clusterData.chunks[txChunkIndex].feerate : 0;
        return {
            ancestors,
            descendants,
            effectiveFeePerVsize,
            cluster: {
                ...clusterData,
                chunkIndex: txChunkIndex,
            },
        };
    }
}
exports.default = new TransactionRepository();
