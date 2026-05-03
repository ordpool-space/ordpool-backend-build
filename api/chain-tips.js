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
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../logger"));
const BlocksSummariesRepository_1 = __importDefault(require("../repositories/BlocksSummariesRepository"));
const bitcoin_api_factory_1 = __importStar(require("./bitcoin/bitcoin-api-factory"));
const bitcoin_client_1 = __importDefault(require("./bitcoin/bitcoin-client"));
const blocks_1 = __importDefault(require("./blocks"));
const common_1 = require("./common");
;
class ChainTips {
    chainTips = [];
    staleTips = {};
    orphanedBlocks = {};
    blockCache = {};
    orphansByHeight = {};
    indexingOrphanedBlocks = false;
    indexingQueue = [];
    staleTipsCacheSize = 50;
    maxIndexingQueueSize = 100;
    /** @asyncSafe */
    async updateOrphanedBlocks() {
        try {
            this.chainTips = await bitcoin_client_1.default.getChainTips();
            const activeTipHeight = this.chainTips.find(tip => tip.status === 'active')?.height || (await bitcoin_api_factory_1.default.$getBlockHeightTip());
            let minIndexHeight = 0;
            const indexedBlockAmount = Math.min(config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT, activeTipHeight);
            if (indexedBlockAmount > 0) {
                minIndexHeight = Math.max(0, activeTipHeight - indexedBlockAmount + 1);
            }
            const start = Date.now();
            const breakAt = start + 10000;
            let newOrphans = 0;
            const newOrphanedBlocks = {};
            for (const chain of this.chainTips) {
                if (chain.status === 'valid-fork' || chain.status === 'valid-headers') {
                    const orphans = [];
                    let hash = chain.hash;
                    do {
                        let orphan = this.blockCache[hash];
                        if (!orphan) {
                            const block = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash);
                            if (block && block.stale) {
                                newOrphans++;
                                orphan = {
                                    height: block.height,
                                    hash: block.id,
                                    status: chain.status,
                                    prevhash: block.previousblockhash,
                                };
                                this.blockCache[hash] = orphan;
                                // don't index stale blocks below the INDEXING_BLOCKS_AMOUNT cutoff
                                if (block.height >= minIndexHeight) {
                                    if (this.indexingQueue.length < this.maxIndexingQueueSize) {
                                        this.indexingQueue.push({ block, tip: orphan });
                                    }
                                    else {
                                        // re-fetch blocks lazily if the queue is big to keep memory usage sane
                                        this.indexingQueue.push({ blockhash: hash, tip: orphan });
                                    }
                                }
                                // make sure the cached canonical block at this height is correct & up to date
                                if (block.height >= (activeTipHeight - (config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT * 4))) {
                                    const cachedBlocks = blocks_1.default.getBlocks();
                                    for (const cachedBlock of cachedBlocks) {
                                        if (cachedBlock.height === block.height) {
                                            // ensure this stale block is included in the orphans list
                                            cachedBlock.extras.orphans = Array.from(new Set([...(cachedBlock.extras.orphans || []), orphan]));
                                        }
                                    }
                                }
                            }
                        }
                        if (orphan) {
                            orphans.push(orphan);
                        }
                        hash = orphan?.prevhash;
                    } while (hash && (Date.now() < breakAt));
                    for (const orphan of orphans) {
                        newOrphanedBlocks[orphan.hash] = orphan;
                    }
                }
                if (Date.now() >= breakAt) {
                    logger_1.default.debug(`Breaking orphaned blocks updater after 10s, will continue next block`);
                    break;
                }
            }
            this.orphansByHeight = {};
            this.orphanedBlocks = newOrphanedBlocks;
            const allOrphans = Object.values(this.orphanedBlocks);
            for (const orphan of allOrphans) {
                if (!this.orphansByHeight[orphan.height]) {
                    this.orphansByHeight[orphan.height] = [];
                }
                this.orphansByHeight[orphan.height].push(orphan);
            }
            const heightsToKeep = new Set(this.chainTips.filter(tip => tip.status !== 'active').map(tip => tip.height));
            const heightsToRemove = Object.keys(this.staleTips).map(Number).filter(height => !heightsToKeep.has(height));
            for (const height of heightsToRemove) {
                delete this.staleTips[height];
            }
            this.trimStaleTipsCache();
            // index new orphaned blocks in the background
            void this.$indexOrphanedBlocks();
            logger_1.default.debug(`Updated orphaned blocks cache. Fetched ${newOrphans} new orphaned blocks. Total ${allOrphans.length}`);
        }
        catch (e) {
            logger_1.default.err(`Cannot get fetch orphaned blocks. Reason: ${e instanceof Error ? e.message : e}`);
        }
    }
    /** @asyncSafe */
    async $indexOrphanedBlocks() {
        if (this.indexingOrphanedBlocks) {
            return;
        }
        this.indexingOrphanedBlocks = true;
        while (this.indexingQueue.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, prefer-const
            let { blockhash, block, tip } = this.indexingQueue.shift();
            if (!block && !blockhash) {
                continue;
            }
            try {
                if (blockhash && !block) {
                    block = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(blockhash);
                }
                if (!block) {
                    continue;
                }
                let staleBlock;
                const alreadyIndexed = await BlocksSummariesRepository_1.default.$isSummaryIndexed(block.id);
                const needToCache = Object.keys(this.staleTips).length < this.staleTipsCacheSize || block.height > Object.keys(this.staleTips).map(Number).sort((a, b) => b - a)[this.staleTipsCacheSize - 1];
                if (!alreadyIndexed) {
                    staleBlock = await blocks_1.default.$indexBlock(block.id, block, true);
                    await blocks_1.default.$indexBlockSummary(block.id, block.height, true);
                    // don't DDOS core by indexing too fast
                    await common_1.Common.sleep$(5000);
                }
                else if (needToCache) {
                    staleBlock = await blocks_1.default.$getBlock(block.id, true);
                }
                if (staleBlock && needToCache) {
                    const canonicalBlock = await blocks_1.default.$indexBlockByHeight(staleBlock.height);
                    this.staleTips[staleBlock.height] = {
                        height: staleBlock.height,
                        hash: staleBlock.id,
                        branchlen: tip.height - staleBlock.height,
                        status: tip.status,
                        stale: staleBlock,
                        canonical: canonicalBlock,
                    };
                    this.trimStaleTipsCache();
                }
            }
            catch (e) {
                logger_1.default.err(`Failed to index orphaned block ${block?.id} at height ${block?.height}. Reason: ${e instanceof Error ? e.message : e}`);
            }
        }
        this.indexingOrphanedBlocks = false;
    }
    trimStaleTipsCache() {
        const staleTipHeights = Object.keys(this.staleTips).map(Number).sort((a, b) => b - a);
        if (staleTipHeights.length > this.staleTipsCacheSize) {
            const heightsToDiscard = staleTipHeights.slice(this.staleTipsCacheSize);
            for (const height of heightsToDiscard) {
                delete this.staleTips[height];
            }
        }
    }
    getOrphanedBlocksAtHeight(height) {
        if (height === undefined) {
            return [];
        }
        return this.orphansByHeight[height] || [];
    }
    getChainTips() {
        return this.chainTips;
    }
    getStaleTips() {
        return Object.values(this.staleTips).sort((a, b) => b.height - a.height);
    }
    clearOrphanCacheAboveHeight(height) {
        for (const h in this.orphansByHeight) {
            if (Number(h) > height) {
                const orphans = this.orphansByHeight[h];
                delete this.orphansByHeight[h];
                for (const o of orphans) {
                    delete this.orphanedBlocks[o.hash];
                    delete this.blockCache[o.hash];
                }
            }
        }
    }
    isOrphaned(hash) {
        return !!this.orphanedBlocks[hash] || this.blockCache[hash]?.status === 'valid-fork' || this.blockCache[hash]?.status === 'valid-headers';
    }
    getOrphanedBlock(hash) {
        return this.orphanedBlocks[hash] || this.blockCache[hash];
    }
}
exports.default = new ChainTips();
