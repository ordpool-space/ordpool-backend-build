"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const mempool_1 = __importDefault(require("./mempool"));
const mempool_blocks_1 = __importDefault(require("./mempool-blocks"));
const isLiquid = config_1.default.MEMPOOL.NETWORK === 'liquid' || config_1.default.MEMPOOL.NETWORK === 'liquidtestnet';
class FeeApi {
    constructor() { }
    minimumIncrement = isLiquid ? 0.1 : 1;
    minFastestFee = isLiquid ? 0.1 : 1;
    minHalfHourFee = isLiquid ? 0.1 : 0.5;
    priorityFactor = isLiquid ? 0 : 0.5;
    getRecommendedFee() {
        const pBlocks = mempool_blocks_1.default.getMempoolBlocks();
        const mPool = mempool_1.default.getMempoolInfo();
        return this.calculateRecommendedFee(pBlocks, mPool);
    }
    getPreciseRecommendedFee() {
        const pBlocks = mempool_blocks_1.default.getMempoolBlocks();
        const mPool = mempool_1.default.getMempoolInfo();
        // minimum non-zero minrelaytxfee / incrementalrelayfee is 1 sat/kvB = 0.001 sat/vB
        const recommendations = this.calculateRecommendedFee(pBlocks, mPool, 0.001);
        // enforce floor & offset for highest priority recommendations while <100% hashrate accepts sub-sat fees
        recommendations.fastestFee = Math.max(recommendations.fastestFee + this.priorityFactor, this.minFastestFee);
        recommendations.halfHourFee = Math.max(recommendations.halfHourFee + (this.priorityFactor / 2), this.minHalfHourFee);
        return {
            'fastestFee': Math.round(recommendations.fastestFee * 1000) / 1000,
            'halfHourFee': Math.round(recommendations.halfHourFee * 1000) / 1000,
            'hourFee': Math.round(recommendations.hourFee * 1000) / 1000,
            'economyFee': Math.round(recommendations.economyFee * 1000) / 1000,
            'minimumFee': Math.round(recommendations.minimumFee * 1000) / 1000,
        };
    }
    calculateRecommendedFee(pBlocks, mPool, minIncrement = this.minimumIncrement) {
        const purgeRate = this.roundUpToNearest(mPool.mempoolminfee * 100000, minIncrement);
        const minimumFee = Math.max(purgeRate, minIncrement);
        if (!pBlocks.length) {
            return {
                'fastestFee': minimumFee,
                'halfHourFee': minimumFee,
                'hourFee': minimumFee,
                'economyFee': minimumFee,
                'minimumFee': minimumFee,
            };
        }
        const firstMedianFee = this.optimizeMedianFee(pBlocks[0], pBlocks[1], undefined, minimumFee, minIncrement);
        const secondMedianFee = pBlocks[1] ? this.optimizeMedianFee(pBlocks[1], pBlocks[2], firstMedianFee, minimumFee, minIncrement) : minimumFee;
        const thirdMedianFee = pBlocks[2] ? this.optimizeMedianFee(pBlocks[2], pBlocks[3], secondMedianFee, minimumFee, minIncrement) : minimumFee;
        // explicitly enforce a minimum of ceil(mempoolminfee) on all recommendations.
        // simply rounding up recommended rates is insufficient, as the purging rate
        // can exceed the median rate of projected blocks in some extreme scenarios
        // (see https://bitcoin.stackexchange.com/a/120024)
        let fastestFee = Math.max(minimumFee, firstMedianFee);
        let halfHourFee = Math.max(minimumFee, secondMedianFee);
        let hourFee = Math.max(minimumFee, thirdMedianFee);
        const economyFee = Math.max(minimumFee, Math.min(2 * minimumFee, thirdMedianFee));
        // ensure recommendations always increase w/ priority
        fastestFee = Math.max(fastestFee, halfHourFee, hourFee, economyFee);
        halfHourFee = Math.max(halfHourFee, hourFee, economyFee);
        hourFee = Math.max(hourFee, economyFee);
        return {
            'fastestFee': this.roundToNearest(fastestFee, minIncrement),
            'halfHourFee': this.roundToNearest(halfHourFee, minIncrement),
            'hourFee': this.roundToNearest(hourFee, minIncrement),
            'economyFee': this.roundToNearest(economyFee, minIncrement),
            'minimumFee': this.roundToNearest(minimumFee, minIncrement),
        };
    }
    optimizeMedianFee(pBlock, nextBlock, previousFee, minFee, minIncrement = this.minimumIncrement) {
        const useFee = previousFee ? (pBlock.medianFee + previousFee) / 2 : pBlock.medianFee;
        if (pBlock.blockVSize <= 500000 || pBlock.medianFee < minFee) {
            return minFee;
        }
        if (pBlock.blockVSize <= 950000 && !nextBlock) {
            const multiplier = (pBlock.blockVSize - 500000) / 500000;
            return Math.max(this.roundToNearest(useFee * multiplier, minIncrement), minFee);
        }
        return Math.max(this.roundUpToNearest(useFee, minIncrement), minFee);
    }
    roundUpToNearest(value, nearest) {
        if (nearest !== 0) {
            return Math.ceil(value / nearest) * nearest;
        }
        return value;
    }
    roundToNearest(value, nearest) {
        if (nearest !== 0) {
            return Math.round(value / nearest) * nearest;
        }
        return value;
    }
}
exports.default = new FeeApi();
