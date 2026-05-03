"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subgraph = exports.sortTopological = exports.DepGraph = exports.ClusterTx = void 0;
const logger_1 = __importDefault(require("../logger"));
class ClusterTx {
    txid;
    effectiveFee;
    weight;
    order;
    ancestors;
    descendants;
    parents;
    children;
    constructor(txid, effectiveFee, weight, order) {
        this.txid = txid;
        this.effectiveFee = effectiveFee;
        this.weight = weight;
        this.order = order;
        this.ancestors = new Set([this]);
        this.descendants = new Set([this]);
        this.parents = new Set();
        this.children = new Set();
    }
}
exports.ClusterTx = ClusterTx;
class DepGraph {
    txs = new Set();
    get size() {
        return this.txs.size;
    }
    addTransaction(txid, fee, weight, order = 0) {
        const tx = new ClusterTx(txid, fee, weight, order);
        this.txs.add(tx);
        return tx;
    }
    addDependency(parent, child) {
        if (!this.txs.has(parent) || !this.txs.has(child)) {
            logger_1.default.warn(`Warning: invalid dependency, skipping`);
            return;
        }
        parent.children.add(child);
        child.parents.add(parent);
        if (child.ancestors.has(parent)) {
            return;
        }
        for (const descendant of child.descendants) {
            for (const ancestor of parent.ancestors) {
                descendant.ancestors.add(ancestor);
                ancestor.descendants.add(descendant);
            }
        }
    }
    removeTransactions(toRemove) {
        for (const tx of toRemove) {
            for (const parent of tx.parents) {
                parent.children.delete(tx);
            }
            for (const child of tx.children) {
                child.parents.delete(tx);
            }
            this.txs.delete(tx);
        }
        for (const tx of this.txs) {
            for (const removed of toRemove) {
                tx.ancestors.delete(removed);
                tx.descendants.delete(removed);
            }
        }
        this.rederiveAncestorsDescendants();
    }
    rederiveAncestorsDescendants() {
        const ordered = [...this.txs].sort((a, b) => a.ancestors.size - b.ancestors.size);
        for (const tx of this.txs) {
            tx.ancestors = new Set([tx]);
            tx.descendants = new Set([tx]);
        }
        for (const tx of ordered) {
            for (const parent of tx.parents) {
                for (const ancestor of parent.ancestors) {
                    tx.ancestors.add(ancestor);
                }
            }
            for (const ancestor of tx.ancestors) {
                ancestor.descendants.add(tx);
            }
        }
    }
    hasTx(tx) {
        return this.txs.has(tx);
    }
    getTxs() {
        return this.txs;
    }
    findConnectedComponents() {
        const visited = new Set();
        const components = [];
        for (const tx of this.txs) {
            if (!visited.has(tx)) {
                const component = new Set();
                const stack = [tx];
                while (stack.length > 0) {
                    const node = stack.pop();
                    if (node && !visited.has(node)) {
                        visited.add(node);
                        component.add(node);
                        for (const a of node.ancestors) {
                            if (!visited.has(a) && this.txs.has(a)) {
                                stack.push(a);
                            }
                        }
                        for (const d of node.descendants) {
                            if (!visited.has(d) && this.txs.has(d)) {
                                stack.push(d);
                            }
                        }
                    }
                }
                components.push(component);
            }
        }
        return components;
    }
}
exports.DepGraph = DepGraph;
function sortTopological(subset) {
    return [...subset].sort((a, b) => a.ancestors.size - b.ancestors.size);
}
exports.sortTopological = sortTopological;
function subgraph(txSubset) {
    const newGraph = new DepGraph();
    const txMap = new Map();
    for (const oldTx of txSubset) {
        const newTx = newGraph.addTransaction(oldTx.txid, oldTx.effectiveFee, oldTx.weight, oldTx.order);
        txMap.set(oldTx, newTx);
    }
    for (const oldTx of txSubset) {
        for (const parent of oldTx.parents) {
            if (txSubset.has(parent)) {
                const newChild = txMap.get(oldTx);
                const newParent = txMap.get(parent);
                if (newChild && newParent) {
                    newGraph.addDependency(newParent, newChild);
                }
            }
        }
    }
    return { depgraph: newGraph, txMap };
}
exports.subgraph = subgraph;
