"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const mempool_interfaces_1 = require("../mempool.interfaces");
const TransactionRepository_1 = __importDefault(require("../repositories/TransactionRepository"));
class CpfpRepository {
    async $batchSaveClusters(clusters) {
        try {
            const clusterValues = [];
            const txs = [];
            for (const cluster of clusters) {
                if (cluster.txs?.length) {
                    const isCM = cluster.templateAlgorithm === mempool_interfaces_1.TemplateAlgorithm.clusterMempool;
                    if (isCM && cluster.clusterData) {
                        clusterValues.push([
                            cluster.root,
                            cluster.height,
                            Buffer.from(this.packCM(cluster.clusterData)),
                            0,
                            mempool_interfaces_1.TemplateAlgorithm.clusterMempool,
                        ]);
                        for (const tx of cluster.clusterData.txs) {
                            txs.push({ txid: tx.txid, cluster: cluster.root });
                        }
                    }
                    else {
                        const roundedEffectiveFee = Math.round(cluster.effectiveFeePerVsize * 100) / 100;
                        const equalFee = cluster.txs.length > 1 && cluster.txs.reduce((acc, tx) => {
                            return (acc && Math.round(((tx.fee || 0) / (tx.weight / 4)) * 100) / 100 === roundedEffectiveFee);
                        }, true);
                        if (!equalFee) {
                            clusterValues.push([
                                cluster.root,
                                cluster.height,
                                Buffer.from(this.pack(cluster.txs)),
                                cluster.effectiveFeePerVsize,
                                mempool_interfaces_1.TemplateAlgorithm.legacy,
                            ]);
                            for (const tx of cluster.txs) {
                                txs.push({ txid: tx.txid, cluster: cluster.root });
                            }
                        }
                    }
                }
            }
            if (!clusterValues.length) {
                return false;
            }
            const queries = [];
            const maxChunk = 100;
            let chunkIndex = 0;
            // insert clusters in batches of up to 100 rows
            while (chunkIndex < clusterValues.length) {
                const chunk = clusterValues.slice(chunkIndex, chunkIndex + maxChunk);
                let query = `
            INSERT IGNORE INTO compact_cpfp_clusters(root, height, txs, fee_rate, template_algo)
            VALUES
        `;
                query += chunk.map(chunk => {
                    return (' (UNHEX(?), ?, ?, ?, ?)');
                }) + ';';
                const values = chunk.flat();
                queries.push({
                    query,
                    params: values,
                });
                chunkIndex += maxChunk;
            }
            chunkIndex = 0;
            // insert transactions in batches of up to 100 rows
            while (chunkIndex < txs.length) {
                const chunk = txs.slice(chunkIndex, chunkIndex + maxChunk);
                queries.push(TransactionRepository_1.default.buildBatchSetQuery(chunk));
                chunkIndex += maxChunk;
            }
            await database_1.default.$atomicQuery(queries);
            return true;
        }
        catch (e) {
            logger_1.default.err(`Cannot save cpfp clusters into db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /** @asyncUnsafe */
    async $getCluster(clusterRoot) {
        const [clusterRows] = await database_1.default.query(`
        SELECT *
        FROM compact_cpfp_clusters
        WHERE root = UNHEX(?)
      `, [clusterRoot]);
        const cluster = clusterRows[0];
        if (cluster?.txs) {
            if (cluster.template_algo === mempool_interfaces_1.TemplateAlgorithm.clusterMempool) {
                cluster.templateAlgorithm = mempool_interfaces_1.TemplateAlgorithm.clusterMempool;
                cluster.clusterData = this.unpackCM(cluster.txs);
                cluster.txs = cluster.clusterData.txs.map(tx => ({ txid: tx.txid, weight: tx.weight, fee: tx.fee }));
                cluster.effectiveFeePerVsize = 0;
            }
            else {
                cluster.templateAlgorithm = mempool_interfaces_1.TemplateAlgorithm.legacy;
                cluster.effectiveFeePerVsize = cluster.fee_rate;
                cluster.txs = this.unpack(cluster.txs);
            }
            return cluster;
        }
        return;
    }
    /** @asyncUnsafe */
    async $getClustersAt(height) {
        const [clusterRows] = await database_1.default.query(`
        SELECT *
        FROM compact_cpfp_clusters
        WHERE height = ?
      `, [height]);
        return clusterRows.map(cluster => {
            if (cluster?.txs) {
                if (cluster.template_algo === mempool_interfaces_1.TemplateAlgorithm.clusterMempool) {
                    cluster.templateAlgorithm = mempool_interfaces_1.TemplateAlgorithm.clusterMempool;
                    cluster.clusterData = this.unpackCM(cluster.txs);
                    cluster.txs = cluster.clusterData.txs.map(tx => ({ txid: tx.txid, weight: tx.weight, fee: tx.fee }));
                    cluster.effectiveFeePerVsize = 0;
                }
                else {
                    cluster.templateAlgorithm = mempool_interfaces_1.TemplateAlgorithm.legacy;
                    cluster.effectiveFeePerVsize = cluster.fee_rate;
                    cluster.txs = this.unpack(cluster.txs);
                }
                return cluster;
            }
            else {
                return null;
            }
        }).filter(cluster => cluster !== null);
    }
    async $deleteClustersFrom(height) {
        logger_1.default.info(`Delete newer cpfp clusters from height ${height} from the database`);
        try {
            const [rows] = await database_1.default.query(`
          SELECT txs, height, root, template_algo from compact_cpfp_clusters
          WHERE height >= ?
        `, [height]);
            if (rows?.length) {
                for (const clusterToDelete of rows) {
                    const txids = this.extractTxids(clusterToDelete);
                    for (const txid of txids) {
                        await TransactionRepository_1.default.$removeTransaction(txid);
                    }
                }
            }
            await database_1.default.query(`
          DELETE from compact_cpfp_clusters
          WHERE height >= ?
        `, [height]);
        }
        catch (e) {
            logger_1.default.err(`Cannot delete cpfp clusters from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $deleteClustersAt(height) {
        logger_1.default.info(`Delete cpfp clusters at height ${height} from the database`);
        try {
            const [rows] = await database_1.default.query(`
          SELECT txs, height, root, template_algo from compact_cpfp_clusters
          WHERE height = ?
        `, [height]);
            if (rows?.length) {
                for (const clusterToDelete of rows) {
                    const txids = this.extractTxids(clusterToDelete);
                    for (const txid of txids) {
                        await TransactionRepository_1.default.$removeTransaction(txid);
                    }
                }
            }
            await database_1.default.query(`
          DELETE from compact_cpfp_clusters
          WHERE height = ?
        `, [height]);
        }
        catch (e) {
            logger_1.default.err(`Cannot delete cpfp clusters from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    extractTxids(row) {
        if (row.template_algo === mempool_interfaces_1.TemplateAlgorithm.clusterMempool) {
            return this.unpackCM(row.txs).txs.map(tx => tx.txid);
        }
        return this.unpack(row.txs).map(tx => tx.txid);
    }
    // insert a dummy row to mark that we've indexed as far as this block
    async $insertProgressMarker(height) {
        try {
            const [rows] = await database_1.default.query(`
          SELECT root
          FROM compact_cpfp_clusters
          WHERE height = ?
        `, [height]);
            if (!rows?.length) {
                const rootBuffer = Buffer.alloc(32);
                rootBuffer.writeInt32LE(height);
                await database_1.default.query(`
            INSERT INTO compact_cpfp_clusters(root, height, fee_rate)
            VALUE (?, ?, ?)
          `, [rootBuffer, height, 0]);
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot insert cpfp progress marker. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    pack(txs) {
        const buf = new ArrayBuffer(44 * txs.length);
        const view = new DataView(buf);
        txs.forEach((tx, i) => {
            const offset = i * 44;
            for (let x = 0; x < 32; x++) {
                // store txid in little-endian
                view.setUint8(offset + (31 - x), parseInt(tx.txid.slice(x * 2, (x * 2) + 2), 16));
            }
            view.setUint32(offset + 32, tx.weight);
            view.setBigUint64(offset + 36, BigInt(Math.round(tx.fee)));
        });
        return buf;
    }
    unpack(buf) {
        if (!buf) {
            return [];
        }
        try {
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            const txs = [];
            const view = new DataView(arrayBuffer);
            for (let offset = 0; offset < arrayBuffer.byteLength; offset += 44) {
                const txid = Array.from(new Uint8Array(arrayBuffer, offset, 32)).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
                const weight = view.getUint32(offset + 32);
                const fee = Number(view.getBigUint64(offset + 36));
                txs.push({
                    txid,
                    weight,
                    fee
                });
            }
            return txs;
        }
        catch (e) {
            logger_1.default.warn(`Failed to unpack CPFP cluster. Reason: ` + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    /**
     * Pack cluster mempool data into binary format:
     * [num_chunks: uint16]
     * Per chunk: [num_txs: uint16]
     * Per tx (in linearization order, grouped by chunk):
     *   [txid: 32 bytes LE] [weight: uint32] [fee: uint64] [num_parents: uint8] [parent_indices: uint8 each]
     */
    packCM(clusterData) {
        const headerSize = 2;
        const chunkHeadersSize = clusterData.chunks.length * 2;
        let txDataSize = 0;
        for (const tx of clusterData.txs) {
            txDataSize += 32 + 4 + 8 + 1 + tx.parents.length;
        }
        const totalSize = headerSize + chunkHeadersSize + txDataSize;
        const buf = new ArrayBuffer(totalSize);
        const view = new DataView(buf);
        let offset = 0;
        view.setUint16(offset, clusterData.chunks.length);
        offset += 2;
        for (const chunk of clusterData.chunks) {
            view.setUint16(offset, chunk.txs.length);
            offset += 2;
        }
        for (const tx of clusterData.txs) {
            for (let x = 0; x < 32; x++) {
                view.setUint8(offset + (31 - x), parseInt(tx.txid.slice(x * 2, (x * 2) + 2), 16));
            }
            offset += 32;
            view.setUint32(offset, tx.weight);
            offset += 4;
            view.setBigUint64(offset, BigInt(Math.round(tx.fee)));
            offset += 8;
            view.setUint8(offset, tx.parents.length);
            offset += 1;
            for (const parentIdx of tx.parents) {
                view.setUint8(offset, parentIdx);
                offset += 1;
            }
        }
        return buf;
    }
    unpackCM(buf) {
        if (!buf) {
            return { txs: [], chunks: [] };
        }
        try {
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            const view = new DataView(arrayBuffer);
            let offset = 0;
            const numChunks = view.getUint16(offset);
            offset += 2;
            const chunkSizes = [];
            for (let i = 0; i < numChunks; i++) {
                chunkSizes.push(view.getUint16(offset));
                offset += 2;
            }
            const txs = [];
            const chunks = [];
            let txIndex = 0;
            for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
                const chunkTxIndices = [];
                let chunkFee = 0;
                let chunkWeight = 0;
                for (let t = 0; t < chunkSizes[chunkIdx]; t++) {
                    const txid = Array.from(new Uint8Array(arrayBuffer, offset, 32)).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
                    offset += 32;
                    const weight = view.getUint32(offset);
                    offset += 4;
                    const fee = Number(view.getBigUint64(offset));
                    offset += 8;
                    const numParents = view.getUint8(offset);
                    offset += 1;
                    const parents = [];
                    for (let p = 0; p < numParents; p++) {
                        parents.push(view.getUint8(offset));
                        offset += 1;
                    }
                    txs.push({ txid, fee, weight, parents });
                    chunkTxIndices.push(txIndex);
                    chunkFee += fee;
                    chunkWeight += weight;
                    txIndex++;
                }
                chunks.push({
                    txs: chunkTxIndices,
                    feerate: chunkWeight > 0 ? (chunkFee * 4) / chunkWeight : 0,
                });
            }
            return { txs, chunks };
        }
        catch (e) {
            logger_1.default.warn(`Failed to unpack CM CPFP cluster. Reason: ` + (e instanceof Error ? e.message : e));
            return { txs: [], chunks: [] };
        }
    }
    // returns `true` if two sets of CPFP clusters are deeply identical
    compareClusters(clustersA, clustersB) {
        if (clustersA.length !== clustersB.length) {
            return false;
        }
        clustersA = clustersA.sort((a, b) => a.root.localeCompare(b.root));
        clustersB = clustersB.sort((a, b) => a.root.localeCompare(b.root));
        for (let i = 0; i < clustersA.length; i++) {
            if (clustersA[i].root !== clustersB[i].root) {
                return false;
            }
            if (clustersA[i].txs.length !== clustersB[i].txs.length) {
                return false;
            }
            for (let j = 0; j < clustersA[i].txs.length; j++) {
                if (clustersA[i].txs[j].txid !== clustersB[i].txs[j].txid) {
                    return false;
                }
            }
        }
        return true;
    }
}
exports.default = new CpfpRepository();
