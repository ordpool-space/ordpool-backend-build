"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterMempool = void 0;
const depgraph_1 = require("./depgraph");
const linearize_1 = require("./linearize");
const block_builder_1 = require("./block-builder");
const logger_1 = __importDefault(require("../logger"));
const DEFAULT_COST_BUDGET = 75000;
class ClusterMempool {
    clusters = new Map();
    txToCluster = new Map();
    parentMap = new Map();
    spentBy = new Map();
    mempool;
    accelerations = {};
    nextClusterId = 0;
    modifyTxs;
    costBudget = DEFAULT_COST_BUDGET;
    constructor(mempool, accelerations, modifyTxs = true, costBudget = DEFAULT_COST_BUDGET) {
        this.mempool = mempool;
        if (accelerations) {
            this.accelerations = accelerations;
        }
        this.modifyTxs = modifyTxs;
        this.costBudget = costBudget;
        this.buildFromMempool();
    }
    applyMempoolChange(diff) {
        this.processRemovals(diff.removed);
        this.splitDisconnectedClusters();
        this.processAccelerationChanges(diff.accelerations);
        this.processAdditions(diff.added);
        this.relinearizeDirtyClusters();
    }
    getBlocks(n, enforceLimit = false) {
        return (0, block_builder_1.assembleBlocks)(n, this.clusters, this.mempool, enforceLimit);
    }
    getCluster(clusterId) {
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            return null;
        }
        return this.buildClusterData(cluster);
    }
    getClusterInfo(txid) {
        const match = this.getClusterForTx(txid);
        if (!match) {
            return null;
        }
        return this.findChunkInfo(match.cluster, match.clusterTx);
    }
    getClusterForApi(txid) {
        const info = this.getClusterInfo(txid);
        if (!info) {
            return null;
        }
        const cluster = this.getCluster(info.clusterId);
        if (!cluster || cluster.txs.length <= 1) {
            return null;
        }
        return { ...cluster, chunkIndex: info.chunkIndex };
    }
    getCpfpDataForTx(txid) {
        const clusterInfo = this.getClusterForTx(txid);
        if (!clusterInfo) {
            return null;
        }
        const chunkInfo = this.findChunkInfo(clusterInfo.cluster, clusterInfo.clusterTx);
        if (!chunkInfo) {
            return null;
        }
        const chunk = clusterInfo.cluster.chunks[chunkInfo?.chunkIndex];
        const chunkSet = chunk.txs.length > 1 ? new Set(chunk.txs) : null;
        return {
            effectiveFeePerVsize: chunkInfo.chunkFeerate,
            clusterId: clusterInfo.cluster.id,
            chunkIndex: chunkInfo.chunkIndex,
            cpfpDirty: true,
            cpfpChecked: true,
            ancestors: chunkSet ? this.getChunkRelatives(clusterInfo.clusterTx, chunkSet, 'ancestors') : [],
            descendants: chunkSet ? this.getChunkRelatives(clusterInfo.clusterTx, chunkSet, 'descendants') : [],
        };
    }
    getClusterCount() {
        return this.clusters.size;
    }
    getTxCount() {
        return this.txToCluster.size;
    }
    getClusterForTx(txid) {
        const clusterId = this.txToCluster.get(txid);
        if (clusterId === undefined) {
            return null;
        }
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            return null;
        }
        const clusterTx = cluster.txs.get(txid);
        if (!clusterTx) {
            return null;
        }
        return { cluster, clusterTx };
    }
    buildFromMempool() {
        this.buildRelativeMaps();
        const components = this.findMempoolComponents();
        for (const component of components) {
            this.createClusterFromTxids(component);
        }
    }
    buildRelativeMaps() {
        this.parentMap.clear();
        this.spentBy.clear();
        for (const txid in this.mempool) {
            const tx = this.mempool[txid];
            const txParents = new Set();
            for (const vin of tx.vin) {
                if (!vin.is_coinbase && this.mempool[vin.txid]) {
                    txParents.add(vin.txid);
                    this.spentBy.set(`${vin.txid}:${vin.vout}`, txid);
                }
            }
            if (txParents.size > 0) {
                this.parentMap.set(txid, txParents);
            }
        }
    }
    findMempoolComponents() {
        const visited = new Set();
        const components = [];
        for (const txid in this.mempool) {
            if (!visited.has(txid)) {
                const component = this.dfsComponent(txid, visited);
                components.push(component);
            }
        }
        return components;
    }
    dfsComponent(startTxid, visited) {
        const component = new Set();
        const stack = [startTxid];
        while (stack.length > 0) {
            const current = stack.pop();
            if (current !== undefined && !visited.has(current)) {
                visited.add(current);
                component.add(current);
                const txParents = this.parentMap.get(current);
                if (txParents) {
                    for (const p of txParents) {
                        if (!visited.has(p)) {
                            stack.push(p);
                        }
                    }
                }
                const tx = this.mempool[current];
                if (tx) {
                    for (let vout = 0; vout < tx.vout.length; vout++) {
                        const child = this.spentBy.get(`${current}:${vout}`);
                        if (child && !visited.has(child)) {
                            stack.push(child);
                        }
                    }
                }
            }
        }
        return component;
    }
    effectiveFee(txid, tx) {
        return tx.fee + (this.accelerations[txid]?.feeDelta || 0);
    }
    adjustedWeight(tx) {
        return Math.max(tx.weight, (tx.sigops || 0) * 20);
    }
    createClusterFromTxids(txids) {
        const clusterId = this.nextClusterId++;
        const depgraph = new depgraph_1.DepGraph();
        const txMap = new Map();
        for (const txid of txids) {
            const tx = this.mempool[txid];
            if (!tx) {
                logger_1.default.warn(`Warning: missing mempool tx ${txid} during cluster creation, skipping`);
                return null;
            }
            const clusterTx = depgraph.addTransaction(txid, this.effectiveFee(txid, tx), this.adjustedWeight(tx), tx.order ?? 0);
            txMap.set(txid, clusterTx);
        }
        for (const txid of txids) {
            const txParents = this.parentMap.get(txid);
            if (txParents) {
                for (const parentTxid of txParents) {
                    if (txids.has(parentTxid)) {
                        const parentTx = txMap.get(parentTxid);
                        const childTx = txMap.get(txid);
                        if (parentTx && childTx) {
                            depgraph.addDependency(parentTx, childTx);
                        }
                    }
                }
            }
        }
        const { linearization, chunks } = (0, linearize_1.linearizeCluster)(depgraph.getTxs(), this.costBudget);
        const cluster = {
            id: clusterId,
            depgraph,
            txs: txMap,
            linearization,
            chunks,
            dirty: false,
        };
        this.clusters.set(clusterId, cluster);
        for (const txid of txids) {
            this.txToCluster.set(txid, clusterId);
        }
        if (this.modifyTxs) {
            this.writeBackCluster(cluster);
        }
        return cluster;
    }
    writeBackClusters() {
        for (const cluster of this.clusters.values()) {
            this.writeBackCluster(cluster);
        }
    }
    writeBackCluster(cluster) {
        for (let chunkIdx = 0; chunkIdx < cluster.chunks.length; chunkIdx++) {
            const chunk = cluster.chunks[chunkIdx];
            const chunkFeerate = chunk.weight > 0 ? (chunk.fee * 4) / chunk.weight : 0;
            const chunkSet = chunk.txs.length > 1 ? new Set(chunk.txs) : null;
            for (const clusterTx of chunk.txs) {
                this.writeBackTx(cluster, clusterTx, chunkIdx, chunkFeerate, chunkSet);
            }
        }
    }
    writeBackTx(cluster, clusterTx, chunkIdx, chunkFeerate, chunkSet) {
        const txid = clusterTx.txid;
        if (!this.mempool[txid]) {
            logger_1.default.warn(`ClusterMempool.writeBackTx: ${txid} missing from mempool (cluster ${cluster.id})`);
            return;
        }
        const tx = this.mempool[txid];
        if (tx.effectiveFeePerVsize !== chunkFeerate || tx.clusterId !== cluster.id) {
            tx.cpfpDirty = true;
        }
        tx.effectiveFeePerVsize = chunkFeerate;
        tx.clusterId = cluster.id;
        tx.chunkIndex = chunkIdx;
        tx.cpfpChecked = true;
        if (chunkSet) {
            tx.ancestors = this.getChunkRelatives(clusterTx, chunkSet, 'ancestors');
            tx.descendants = this.getChunkRelatives(clusterTx, chunkSet, 'descendants');
        }
        else {
            tx.ancestors = [];
            tx.descendants = [];
        }
    }
    getChunkRelatives(clusterTx, chunkSet, direction) {
        const relatives = [];
        const related = direction === 'ancestors' ? clusterTx.ancestors : clusterTx.descendants;
        for (const rel of related) {
            if (rel !== clusterTx && chunkSet.has(rel)) {
                const mempoolTx = this.mempool[rel.txid];
                if (mempoolTx) {
                    relatives.push({ txid: rel.txid, fee: mempoolTx.fee, weight: mempoolTx.weight });
                }
                else {
                    logger_1.default.warn(`ClusterMempool.getChunkRelatives: ${rel.txid} missing from mempool`);
                }
            }
        }
        return relatives;
    }
    processRemovals(removed) {
        for (const txid of removed) {
            const tx = this.mempool[txid];
            if (tx) {
                for (const vin of tx.vin) {
                    if (!vin.is_coinbase) {
                        this.spentBy.delete(`${vin.txid}:${vin.vout}`);
                    }
                }
            }
            else if (this.txToCluster.has(txid)) {
                logger_1.default.warn(`ClusterMempool.processRemovals: ${txid} missing from mempool, spentBy cleanup skipped`);
            }
        }
        for (const txid of removed) {
            const match = this.getClusterForTx(txid);
            if (match) {
                match.cluster.depgraph.removeTransactions(new Set([match.clusterTx]));
                match.cluster.txs.delete(txid);
                match.cluster.linearization = match.cluster.linearization.filter(t => t !== match.clusterTx);
                this.txToCluster.delete(txid);
                match.cluster.dirty = true;
            }
        }
    }
    splitDisconnectedClusters() {
        for (const [clusterId, cluster] of this.clusters.entries()) {
            if (cluster.dirty) {
                if (cluster.depgraph.size === 0) {
                    this.clusters.delete(clusterId);
                }
                else {
                    const components = cluster.depgraph.findConnectedComponents();
                    if (components.length > 1) {
                        this.clusters.delete(clusterId);
                        for (const component of components) {
                            this.splitComponentToCluster(cluster, component);
                        }
                    }
                }
            }
        }
    }
    splitComponentToCluster(sourceCluster, component) {
        const newClusterId = this.nextClusterId++;
        const { depgraph: newDepgraph, txMap } = (0, depgraph_1.subgraph)(component);
        const newTxs = new Map();
        for (const oldTx of component) {
            const newTx = txMap.get(oldTx);
            if (newTx) {
                newTxs.set(oldTx.txid, newTx);
                this.txToCluster.set(oldTx.txid, newClusterId);
            }
        }
        const newLinearization = [];
        for (const oldTx of sourceCluster.linearization) {
            if (component.has(oldTx)) {
                const newTx = txMap.get(oldTx);
                if (newTx) {
                    newLinearization.push(newTx);
                }
            }
        }
        const newCluster = {
            id: newClusterId,
            dirty: true,
            depgraph: newDepgraph,
            txs: newTxs,
            linearization: newLinearization,
            chunks: [],
        };
        this.clusters.set(newClusterId, newCluster);
    }
    processAdditions(added) {
        for (const tx of added) {
            const txid = tx.txid;
            for (const vin of tx.vin) {
                if (!vin.is_coinbase) {
                    this.spentBy.set(`${vin.txid}:${vin.vout}`, txid);
                }
            }
            const { relatedClusterIds, parentTxids, childTxids } = this.findRelatedClusters(tx);
            if (relatedClusterIds.size === 0) {
                this.addSingletonCluster(tx);
            }
            else if (relatedClusterIds.size === 1) {
                this.addToExistingCluster(tx, relatedClusterIds, parentTxids, childTxids);
            }
            else {
                this.mergeAndAddToCluster(tx, relatedClusterIds, parentTxids, childTxids);
            }
        }
    }
    findRelatedClusters(tx) {
        const relatedClusterIds = new Set();
        const parentTxids = [];
        const childTxids = [];
        for (const vin of tx.vin) {
            if (!vin.is_coinbase && this.mempool[vin.txid]) {
                const parentCluster = this.txToCluster.get(vin.txid);
                if (parentCluster !== undefined) {
                    relatedClusterIds.add(parentCluster);
                    parentTxids.push(vin.txid);
                }
            }
        }
        for (let vout = 0; vout < tx.vout.length; vout++) {
            const childTxid = this.spentBy.get(`${tx.txid}:${vout}`);
            if (childTxid && this.mempool[childTxid]) {
                const childCluster = this.txToCluster.get(childTxid);
                if (childCluster !== undefined) {
                    relatedClusterIds.add(childCluster);
                    childTxids.push(childTxid);
                }
            }
        }
        return { relatedClusterIds, parentTxids, childTxids };
    }
    addSingletonCluster(tx) {
        const txid = tx.txid;
        const clusterId = this.nextClusterId++;
        const depgraph = new depgraph_1.DepGraph();
        const clusterTx = depgraph.addTransaction(txid, this.effectiveFee(txid, tx), this.adjustedWeight(tx), tx.order ?? 0);
        const cluster = {
            id: clusterId,
            dirty: true,
            depgraph,
            txs: new Map([[txid, clusterTx]]),
            linearization: [clusterTx],
            chunks: [],
        };
        this.clusters.set(clusterId, cluster);
        this.txToCluster.set(txid, clusterId);
    }
    addToExistingCluster(tx, relatedClusterIds, parentTxids, childTxids) {
        const txid = tx.txid;
        const clusterId = relatedClusterIds.values().next().value;
        const cluster = this.clusters.get(clusterId);
        if (!cluster) {
            return;
        }
        const clusterTx = cluster.depgraph.addTransaction(txid, this.effectiveFee(txid, tx), this.adjustedWeight(tx), tx.order ?? 0);
        cluster.txs.set(txid, clusterTx);
        cluster.linearization.push(clusterTx);
        this.txToCluster.set(txid, clusterId);
        this.addParentDeps(cluster, clusterTx, parentTxids);
        this.addChildDeps(cluster, clusterTx, childTxids);
        cluster.dirty = true;
    }
    mergeAndAddToCluster(tx, relatedClusterIds, parentTxids, childTxids) {
        const clusterIterator = relatedClusterIds.values();
        const primaryId = clusterIterator.next().value;
        const primary = this.clusters.get(primaryId);
        if (!primary) {
            return;
        }
        for (const clusterId of clusterIterator) {
            const other = this.clusters.get(clusterId);
            if (other) {
                this.mergeClusterInto(primary, other);
                this.clusters.delete(clusterId);
            }
        }
        const clusterTx = primary.depgraph.addTransaction(tx.txid, this.effectiveFee(tx.txid, tx), this.adjustedWeight(tx), tx.order ?? 0);
        primary.txs.set(tx.txid, clusterTx);
        primary.linearization.push(clusterTx);
        this.txToCluster.set(tx.txid, primaryId);
        this.addParentDeps(primary, clusterTx, parentTxids);
        this.addChildDeps(primary, clusterTx, childTxids);
        primary.dirty = true;
    }
    addParentDeps(cluster, childTx, parentTxids) {
        for (const parentTxid of parentTxids) {
            const parentTx = cluster.txs.get(parentTxid);
            if (parentTx) {
                cluster.depgraph.addDependency(parentTx, childTx);
            }
        }
    }
    addChildDeps(cluster, parentTx, childTxids) {
        for (const childTxid of childTxids) {
            const childTx = cluster.txs.get(childTxid);
            if (childTx) {
                cluster.depgraph.addDependency(parentTx, childTx);
            }
        }
    }
    mergeClusterInto(primary, other) {
        for (const [txid, otherTx] of other.txs) {
            const newTx = primary.depgraph.addTransaction(txid, otherTx.effectiveFee, otherTx.weight, otherTx.order);
            primary.txs.set(txid, newTx);
            this.txToCluster.set(txid, primary.id);
        }
        for (const otherTx of other.depgraph.getTxs()) {
            for (const parent of otherTx.parents) {
                const newChild = primary.txs.get(otherTx.txid);
                const newParent = primary.txs.get(parent.txid);
                if (newChild && newParent) {
                    primary.depgraph.addDependency(newParent, newChild);
                }
            }
        }
        for (const otherTx of other.linearization) {
            const newTx = primary.txs.get(otherTx.txid);
            if (newTx) {
                primary.linearization.push(newTx);
            }
        }
    }
    processAccelerationChanges(newAccelerations) {
        const changed = new Set();
        for (const txid in newAccelerations) {
            if ((newAccelerations[txid]?.feeDelta || 0) !== (this.accelerations[txid]?.feeDelta || 0)) {
                changed.add(txid);
            }
        }
        for (const txid in this.accelerations) {
            if (!newAccelerations[txid]) {
                changed.add(txid);
            }
        }
        this.accelerations = newAccelerations;
        for (const txid of changed) {
            const tx = this.mempool[txid];
            if (!tx) {
                continue;
            }
            const match = this.getClusterForTx(txid);
            if (match) {
                match.clusterTx.effectiveFee = this.effectiveFee(txid, tx);
                match.cluster.dirty = true;
            }
        }
    }
    relinearizeDirtyClusters() {
        for (const [clusterId, cluster] of this.clusters.entries()) {
            if (cluster.dirty) {
                cluster.dirty = false;
                const newId = this.nextClusterId++;
                this.clusters.delete(clusterId);
                cluster.id = newId;
                this.clusters.set(newId, cluster);
                for (const txid of cluster.txs.keys()) {
                    this.txToCluster.set(txid, newId);
                }
                const { linearization, chunks } = (0, linearize_1.linearizeCluster)(cluster.depgraph.getTxs(), this.costBudget, cluster.linearization);
                cluster.linearization = linearization;
                cluster.chunks = chunks;
                if (this.modifyTxs) {
                    this.writeBackCluster(cluster);
                }
            }
        }
    }
    buildClusterData(cluster) {
        const txs = [];
        const txToFlatIdx = new Map();
        for (const chunk of cluster.chunks) {
            const ordered = (0, depgraph_1.sortTopological)(new Set(chunk.txs));
            for (const clusterTx of ordered) {
                if (this.mempool[clusterTx.txid]) {
                    txToFlatIdx.set(clusterTx, txs.length);
                    const parents = [];
                    for (const parentTx of clusterTx.parents) {
                        const flatIdx = txToFlatIdx.get(parentTx);
                        if (flatIdx !== undefined) {
                            parents.push(flatIdx);
                        }
                    }
                    const mempoolTx = this.mempool[clusterTx.txid];
                    txs.push({ txid: clusterTx.txid, fee: mempoolTx.fee, weight: mempoolTx.weight, parents });
                }
                else {
                    logger_1.default.warn(`ClusterMempool.buildClusterData: ${clusterTx.txid} missing from mempool (cluster ${cluster.id})`);
                }
            }
        }
        let offset = 0;
        const chunks = cluster.chunks.map(chunk => {
            const count = chunk.txs.length;
            const chunkEntry = {
                txs: Array.from({ length: count }, (_, i) => offset + i),
                feerate: chunk.weight > 0 ? (chunk.fee * 4) / chunk.weight : 0,
            };
            offset += count;
            return chunkEntry;
        });
        return { txs, chunks };
    }
    findChunkInfo(cluster, tx) {
        for (let chunkIdx = 0; chunkIdx < cluster.chunks.length; chunkIdx++) {
            const chunk = cluster.chunks[chunkIdx];
            if (chunk.txs.includes(tx)) {
                return {
                    clusterId: cluster.id,
                    chunkIndex: chunkIdx,
                    chunkFeerate: chunk.weight > 0 ? (chunk.fee * 4) / chunk.weight : 0,
                };
            }
        }
        return null;
    }
}
exports.ClusterMempool = ClusterMempool;
