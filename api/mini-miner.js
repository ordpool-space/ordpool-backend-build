"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeBlockTemplate = exports.mempoolComparator = exports.setAncestorScores = exports.removeAncestors = exports.initializeRelatives = exports.expandRelativesGraph = exports.convertToGraphTx = exports.getSameBlockRelatives = void 0;
const logger_1 = __importDefault(require("../logger"));
const BLOCK_WEIGHT_UNITS = 4_000_000;
const BLOCK_SIGOPS = 80_000;
const MAX_RELATIVE_GRAPH_SIZE = 100;
/**
 * Takes a raw transaction, and builds a graph of same-block relatives,
 * and returns as a GraphTx
 *
 * @param tx
 */
function getSameBlockRelatives(tx, transactions) {
    const blockTxs = new Map(); // map of txs in this block
    const spendMap = new Map(); // map of outpoints to spending txids
    for (const tx of transactions) {
        blockTxs.set(tx.txid, tx);
        for (const vin of tx.vin) {
            spendMap.set(`${vin.txid}:${vin.vout}`, tx.txid);
        }
    }
    const relatives = new Map();
    const stack = [tx.txid];
    // build set of same-block ancestors
    while (stack.length > 0) {
        const nextTxid = stack.pop();
        const nextTx = nextTxid ? blockTxs.get(nextTxid) : null;
        if (!nextTx || relatives.has(nextTx.txid)) {
            continue;
        }
        const mempoolTx = convertToGraphTx(nextTx, spendMap);
        for (const txid of [...mempoolTx.depends, ...mempoolTx.spentby]) {
            if (txid) {
                stack.push(txid);
            }
        }
        relatives.set(mempoolTx.txid, mempoolTx);
    }
    return relatives;
}
exports.getSameBlockRelatives = getSameBlockRelatives;
/**
 * Takes a raw transaction and converts it to GraphTx format
 * fee and ancestor data is initialized with dummy/null values
 *
 * @param tx
 */
function convertToGraphTx(tx, spendMap) {
    return {
        txid: tx.txid,
        vsize: Math.max(tx.sigops * 5, Math.ceil(tx.weight / 4)),
        weight: tx.weight,
        fees: {
            base: tx.fee || 0,
            ancestor: tx.fee || 0,
        },
        depends: tx.vin.map(vin => vin.txid).filter(depend => depend),
        spentby: spendMap ? tx.vout.map((vout, index) => { const spend = spendMap.get(`${tx.txid}:${index}`); return (spend?.['txid'] || spend); }).filter(spent => spent) : [],
        ancestorcount: 1,
        ancestorsize: Math.max(tx.sigops * 5, Math.ceil(tx.weight / 4)),
        ancestors: new Map(),
        ancestorRate: 0,
        individualRate: 0,
        score: 0,
    };
}
exports.convertToGraphTx = convertToGraphTx;
/**
 * Takes a map of transaction ancestors, and expands it into a full graph of up to MAX_GRAPH_SIZE in-mempool relatives
 */
function expandRelativesGraph(mempool, ancestors, spendMap) {
    const relatives = new Map();
    const stack = Array.from(ancestors.values());
    while (stack.length > 0) {
        if (relatives.size > MAX_RELATIVE_GRAPH_SIZE) {
            return relatives;
        }
        const nextTx = stack.pop();
        if (!nextTx) {
            continue;
        }
        relatives.set(nextTx.txid, nextTx);
        for (const relativeTxid of [...nextTx.depends, ...nextTx.spentby]) {
            if (relatives.has(relativeTxid)) {
                // already processed this tx
                continue;
            }
            let ancestorTx = ancestors.get(relativeTxid);
            if (!ancestorTx && relativeTxid in mempool) {
                const mempoolTx = mempool[relativeTxid];
                ancestorTx = convertToGraphTx(mempoolTx, spendMap);
            }
            if (ancestorTx) {
                stack.push(ancestorTx);
            }
        }
    }
    return relatives;
}
exports.expandRelativesGraph = expandRelativesGraph;
/**
 * Recursively traverses an in-mempool dependency graph, and sets a Map of in-mempool ancestors
 * for each transaction.
 *
 * @param tx
 * @param all
 */
function setAncestors(tx, all, visited, depth = 0) {
    // sanity check for infinite recursion / too many ancestors (should never happen)
    if (depth > MAX_RELATIVE_GRAPH_SIZE) {
        logger_1.default.warn('cpfp dependency calculation failed: setAncestors reached depth of 100, unable to proceed');
        return tx.ancestors;
    }
    // initialize the ancestor map for this tx
    tx.ancestors = new Map();
    tx.depends.forEach(parentId => {
        const parent = all.get(parentId);
        if (parent) {
            // add the parent
            tx.ancestors?.set(parentId, parent);
            // check for a cached copy of this parent's ancestors
            let ancestors = visited.get(parent.txid);
            if (!ancestors) {
                // recursively fetch the parent's ancestors
                ancestors = setAncestors(parent, all, visited, depth + 1);
            }
            // and add to this tx's map
            ancestors.forEach((ancestor, ancestorId) => {
                tx.ancestors?.set(ancestorId, ancestor);
            });
        }
    });
    visited.set(tx.txid, tx.ancestors);
    return tx.ancestors;
}
/**
   * Efficiently sets a Map of in-mempool ancestors for each member of an expanded relative graph
   * by running setAncestors on each leaf, and caching intermediate results.
   * then initializes ancestor data for each transaction
   *
   * @param all
   */
function initializeRelatives(mempoolTxs) {
    const visited = new Map();
    const leaves = Array.from(mempoolTxs.values()).filter(entry => entry.spentby.length === 0);
    for (const leaf of leaves) {
        setAncestors(leaf, mempoolTxs, visited);
    }
    mempoolTxs.forEach(entry => {
        entry.ancestors?.forEach(ancestor => {
            entry.ancestorcount++;
            entry.ancestorsize += ancestor.vsize;
            entry.fees.ancestor += ancestor.fees.base;
        });
        setAncestorScores(entry);
    });
    return mempoolTxs;
}
exports.initializeRelatives = initializeRelatives;
/**
 * Remove a cluster of transactions from an in-mempool dependency graph
 * and update the survivors' scores and ancestors
 *
 * @param cluster
 * @param ancestors
 */
function removeAncestors(cluster, all) {
    // remove
    cluster.forEach(tx => {
        all.delete(tx.txid);
    });
    // update survivors
    all.forEach(tx => {
        cluster.forEach(remove => {
            if (tx.ancestors?.has(remove.txid)) {
                // remove as dependency
                tx.ancestors.delete(remove.txid);
                tx.depends = tx.depends.filter(parent => parent !== remove.txid);
                // update ancestor sizes and fees
                tx.ancestorsize -= remove.vsize;
                tx.fees.ancestor -= remove.fees.base;
            }
        });
        // recalculate fee rates
        setAncestorScores(tx);
    });
}
exports.removeAncestors = removeAncestors;
/**
 * Take a mempool transaction, and set the fee rates and ancestor score
 *
 * @param tx
 */
function setAncestorScores(tx) {
    tx.individualRate = tx.fees.base / tx.vsize;
    tx.ancestorRate = tx.fees.ancestor / tx.ancestorsize;
    tx.score = Math.min(tx.individualRate, tx.ancestorRate);
}
exports.setAncestorScores = setAncestorScores;
// Sort by descending score
function mempoolComparator(a, b) {
    return b.score - a.score;
}
exports.mempoolComparator = mempoolComparator;
/*
* Build a block using an approximation of the transaction selection algorithm from Bitcoin Core
* (see BlockAssembler in https://github.com/bitcoin/bitcoin/blob/master/src/node/miner.cpp)
*/
function makeBlockTemplate(candidates, accelerations, maxBlocks = 8, weightLimit = BLOCK_WEIGHT_UNITS, sigopLimit = BLOCK_SIGOPS) {
    const auditPool = new Map();
    const mempoolArray = [];
    candidates.forEach(tx => {
        // initializing everything up front helps V8 optimize property access later
        const adjustedVsize = Math.ceil(Math.max(tx.weight / 4, 5 * (tx.sigops || 0)));
        const feePerVsize = (tx.fee / adjustedVsize);
        auditPool.set(tx.txid, {
            txid: tx.txid,
            order: txidToOrdering(tx.txid),
            fee: tx.fee,
            feeDelta: 0,
            weight: tx.weight,
            adjustedVsize,
            feePerVsize: feePerVsize,
            effectiveFeePerVsize: feePerVsize,
            dependencyRate: feePerVsize,
            sigops: tx.sigops || 0,
            inputs: (tx.vin?.map(vin => vin.txid) || []),
            relativesSet: false,
            ancestors: [],
            cluster: [],
            ancestorMap: new Map(),
            children: new Set(),
            ancestorFee: 0,
            ancestorVsize: 0,
            ancestorSigops: 0,
            score: 0,
            used: false,
            modified: false,
        });
        mempoolArray.push(auditPool.get(tx.txid));
    });
    // set accelerated effective fee
    for (const acceleration of accelerations) {
        const tx = auditPool.get(acceleration.txid);
        if (tx) {
            tx.feeDelta = acceleration.max_bid;
            tx.feePerVsize = ((tx.fee + tx.feeDelta) / tx.adjustedVsize);
            tx.effectiveFeePerVsize = tx.feePerVsize;
            tx.dependencyRate = tx.feePerVsize;
        }
    }
    // Build relatives graph & calculate ancestor scores
    for (const tx of mempoolArray) {
        if (!tx.relativesSet) {
            setRelatives(tx, auditPool);
        }
    }
    // Sort by descending ancestor score
    mempoolArray.sort(priorityComparator);
    // Build blocks by greedily choosing the highest feerate package
    // (i.e. the package rooted in the transaction with the best ancestor score)
    const blocks = [];
    let blockWeight = 0;
    let blockSigops = 0;
    const transactions = [];
    let modified = [];
    const overflow = [];
    let failures = 0;
    while (mempoolArray.length || modified.length) {
        // skip invalid transactions
        while (mempoolArray[0]?.used || mempoolArray[0]?.modified) {
            mempoolArray.shift();
        }
        // Select best next package
        let nextTx;
        const nextPoolTx = mempoolArray[0];
        const nextModifiedTx = modified[0];
        if (nextPoolTx && (!nextModifiedTx || (nextPoolTx.score || 0) > (nextModifiedTx.score || 0))) {
            nextTx = nextPoolTx;
            mempoolArray.shift();
        }
        else {
            modified.shift();
            if (nextModifiedTx) {
                nextTx = nextModifiedTx;
            }
        }
        if (nextTx && !nextTx?.used) {
            // Check if the package fits into this block
            if (blocks.length >= (maxBlocks - 1) || ((blockWeight + (4 * nextTx.ancestorVsize) < weightLimit) && (blockSigops + nextTx.ancestorSigops <= sigopLimit))) {
                const ancestors = Array.from(nextTx.ancestorMap.values());
                // sort ancestors by dependency graph (equivalent to sorting by ascending ancestor count)
                const sortedTxSet = [...ancestors.sort((a, b) => { return (a.ancestorMap.size || 0) - (b.ancestorMap.size || 0); }), nextTx];
                const clusterTxids = sortedTxSet.map(tx => tx.txid);
                const effectiveFeeRate = Math.min(nextTx.dependencyRate || Infinity, nextTx.ancestorFee / nextTx.ancestorVsize);
                const used = [];
                while (sortedTxSet.length) {
                    const ancestor = sortedTxSet.pop();
                    if (!ancestor) {
                        continue;
                    }
                    ancestor.used = true;
                    ancestor.usedBy = nextTx.txid;
                    // update this tx with effective fee rate & relatives data
                    if (ancestor.effectiveFeePerVsize !== effectiveFeeRate) {
                        ancestor.effectiveFeePerVsize = effectiveFeeRate;
                    }
                    ancestor.cluster = clusterTxids;
                    transactions.push(ancestor);
                    blockWeight += ancestor.weight;
                    blockSigops += ancestor.sigops;
                    used.push(ancestor);
                }
                // remove these as valid package ancestors for any descendants remaining in the mempool
                if (used.length) {
                    used.forEach(tx => {
                        modified = updateDescendants(tx, auditPool, modified, effectiveFeeRate);
                    });
                }
                failures = 0;
            }
            else {
                // hold this package in an overflow list while we check for smaller options
                overflow.push(nextTx);
                failures++;
            }
        }
        // this block is full
        const exceededPackageTries = failures > 1000 && blockWeight > (weightLimit - 4000);
        const queueEmpty = !mempoolArray.length && !modified.length;
        if (exceededPackageTries || queueEmpty) {
            break;
        }
    }
    for (const tx of transactions) {
        tx.ancestors = Object.values(tx.ancestorMap);
    }
    return transactions;
}
exports.makeBlockTemplate = makeBlockTemplate;
// traverse in-mempool ancestors
// recursion unavoidable, but should be limited to depth < 25 by mempool policy
function setRelatives(tx, mempool) {
    for (const parent of tx.inputs) {
        const parentTx = mempool.get(parent);
        if (parentTx && !tx.ancestorMap?.has(parent)) {
            tx.ancestorMap.set(parent, parentTx);
            parentTx.children.add(tx);
            // visit each node only once
            if (!parentTx.relativesSet) {
                setRelatives(parentTx, mempool);
            }
            parentTx.ancestorMap.forEach((ancestor) => {
                tx.ancestorMap.set(ancestor.txid, ancestor);
            });
        }
    }
    ;
    tx.ancestorFee = (tx.fee + tx.feeDelta);
    tx.ancestorVsize = tx.adjustedVsize || 0;
    tx.ancestorSigops = tx.sigops || 0;
    tx.ancestorMap.forEach((ancestor) => {
        tx.ancestorFee += (ancestor.fee + ancestor.feeDelta);
        tx.ancestorVsize += ancestor.adjustedVsize;
        tx.ancestorSigops += ancestor.sigops;
    });
    tx.score = tx.ancestorFee / tx.ancestorVsize;
    tx.relativesSet = true;
}
// iterate over remaining descendants, removing the root as a valid ancestor & updating the ancestor score
// avoids recursion to limit call stack depth
function updateDescendants(rootTx, mempool, modified, clusterRate) {
    const descendantSet = new Set();
    // stack of nodes left to visit
    const descendants = [];
    let descendantTx;
    rootTx.children.forEach(childTx => {
        if (!descendantSet.has(childTx)) {
            descendants.push(childTx);
            descendantSet.add(childTx);
        }
    });
    while (descendants.length) {
        descendantTx = descendants.pop();
        if (descendantTx && descendantTx.ancestorMap && descendantTx.ancestorMap.has(rootTx.txid)) {
            // remove tx as ancestor
            descendantTx.ancestorMap.delete(rootTx.txid);
            descendantTx.ancestorFee -= (rootTx.fee + rootTx.feeDelta);
            descendantTx.ancestorVsize -= rootTx.adjustedVsize;
            descendantTx.ancestorSigops -= rootTx.sigops;
            descendantTx.score = descendantTx.ancestorFee / descendantTx.ancestorVsize;
            descendantTx.dependencyRate = descendantTx.dependencyRate ? Math.min(descendantTx.dependencyRate, clusterRate) : clusterRate;
            if (!descendantTx.modified) {
                descendantTx.modified = true;
                modified.push(descendantTx);
            }
            // add this node's children to the stack
            descendantTx.children.forEach(childTx => {
                // visit each node only once
                if (!descendantSet.has(childTx)) {
                    descendants.push(childTx);
                    descendantSet.add(childTx);
                }
            });
        }
    }
    // return new, resorted modified list
    return modified.sort(priorityComparator);
}
// Used to sort an array of MinerTransactions by descending ancestor score
function priorityComparator(a, b) {
    if (b.score === a.score) {
        // tie-break by txid for stability
        return a.order - b.order;
    }
    else {
        return b.score - a.score;
    }
}
// returns the most significant 4 bytes of the txid as an integer
function txidToOrdering(txid) {
    return parseInt(txid.substring(62, 64) +
        txid.substring(60, 62) +
        txid.substring(58, 60) +
        txid.substring(56, 58), 16);
}
