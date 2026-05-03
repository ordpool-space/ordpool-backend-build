"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BlocksRepository_1 = __importDefault(require("../../repositories/BlocksRepository"));
const PoolsRepository_1 = __importDefault(require("../../repositories/PoolsRepository"));
const HashratesRepository_1 = __importDefault(require("../../repositories/HashratesRepository"));
const bitcoin_client_1 = __importDefault(require("../bitcoin/bitcoin-client"));
const logger_1 = __importDefault(require("../../logger"));
const common_1 = require("../common");
const loading_indicators_1 = __importDefault(require("../loading-indicators"));
const DifficultyAdjustmentsRepository_1 = __importDefault(require("../../repositories/DifficultyAdjustmentsRepository"));
const config_1 = __importDefault(require("../../config"));
const BlocksAuditsRepository_1 = __importDefault(require("../../repositories/BlocksAuditsRepository"));
const PricesRepository_1 = __importDefault(require("../../repositories/PricesRepository"));
const bitcoin_api_factory_1 = __importDefault(require("../bitcoin/bitcoin-api-factory"));
const database_1 = __importDefault(require("../../database"));
class Mining {
    blocksPriceIndexingRunning = false;
    lastHashrateIndexingDate = null;
    lastWeeklyHashrateIndexingDate = null;
    reindexHashrateRequested = false;
    reindexDifficultyAdjustmentRequested = false;
    genesisData = null;
    /**
     * Get historical blocks health
     */
    async $getBlocksHealthHistory(interval = null) {
        return await BlocksAuditsRepository_1.default.$getBlocksHealthHistory(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Get historical block total fee
     */
    async $getHistoricalBlockFees(interval = null) {
        return await BlocksRepository_1.default.$getHistoricalBlockFees(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Get timespan block total fees
     */
    async $getBlockFeesTimespan(from, to) {
        return await BlocksRepository_1.default.$getHistoricalBlockFees(this.getTimeRangeFromTimespan(from, to), null, { from, to });
    }
    /**
     * Get historical block rewards
     */
    async $getHistoricalBlockRewards(interval = null) {
        return await BlocksRepository_1.default.$getHistoricalBlockRewards(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Get historical block fee rates percentiles
     */
    async $getHistoricalBlockFeeRates(interval = null) {
        return await BlocksRepository_1.default.$getHistoricalBlockFeeRates(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Get historical block sizes
     */
    async $getHistoricalBlockSizes(interval = null) {
        return await BlocksRepository_1.default.$getHistoricalBlockSizes(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Get historical block weights
     */
    async $getHistoricalBlockWeights(interval = null) {
        return await BlocksRepository_1.default.$getHistoricalBlockWeights(this.getTimeRange(interval), common_1.Common.getSqlInterval(interval));
    }
    /**
     * Generate high level overview of the pool ranks and general stats
     */
    async $getPoolsStats(interval) {
        const poolsStatistics = {};
        const poolsInfo = await PoolsRepository_1.default.$getPoolsInfo(interval);
        const emptyBlocks = await BlocksRepository_1.default.$countEmptyBlocks(null, interval);
        const poolsStats = [];
        let rank = 1;
        poolsInfo.forEach((poolInfo) => {
            const emptyBlocksCount = emptyBlocks.filter((emptyCount) => emptyCount.poolId === poolInfo.poolId);
            const poolStat = {
                poolId: poolInfo.poolId,
                name: poolInfo.name,
                link: poolInfo.link,
                blockCount: poolInfo.blockCount,
                rank: rank++,
                emptyBlocks: emptyBlocksCount.length > 0 ? emptyBlocksCount[0]['count'] : 0,
                slug: poolInfo.slug,
                avgMatchRate: poolInfo.avgMatchRate !== null ? Math.round(100 * poolInfo.avgMatchRate) / 100 : null,
                avgFeeDelta: poolInfo.avgFeeDelta,
                poolUniqueId: poolInfo.poolUniqueId
            };
            poolsStats.push(poolStat);
        });
        poolsStatistics['pools'] = poolsStats;
        const blockCount = await BlocksRepository_1.default.$blockCount(null, interval);
        poolsStatistics['blockCount'] = blockCount;
        const totalBlock24h = await BlocksRepository_1.default.$blockCount(null, '24h');
        const totalBlock3d = await BlocksRepository_1.default.$blockCount(null, '3d');
        const totalBlock1w = await BlocksRepository_1.default.$blockCount(null, '1w');
        try {
            poolsStatistics['lastEstimatedHashrate'] = await bitcoin_client_1.default.getNetworkHashPs(totalBlock24h);
            poolsStatistics['lastEstimatedHashrate3d'] = await bitcoin_client_1.default.getNetworkHashPs(totalBlock3d);
            poolsStatistics['lastEstimatedHashrate1w'] = await bitcoin_client_1.default.getNetworkHashPs(totalBlock1w);
        }
        catch (e) {
            poolsStatistics['lastEstimatedHashrate'] = 0;
            logger_1.default.debug('Bitcoin Core is not available, using zeroed value for current hashrate', logger_1.default.tags.mining);
        }
        return poolsStatistics;
    }
    /**
     * Get all mining pool stats for a pool
     */
    async $getPoolStat(slug) {
        const pool = await PoolsRepository_1.default.$getPool(slug);
        if (!pool) {
            throw new Error('This mining pool does not exist');
        }
        const blockCount = await BlocksRepository_1.default.$blockCount(pool.id);
        const totalBlock = await BlocksRepository_1.default.$blockCount(null, null);
        const blockCount24h = await BlocksRepository_1.default.$blockCount(pool.id, '24h');
        const totalBlock24h = await BlocksRepository_1.default.$blockCount(null, '24h');
        const blockCount1w = await BlocksRepository_1.default.$blockCount(pool.id, '1w');
        const totalBlock1w = await BlocksRepository_1.default.$blockCount(null, '1w');
        const avgHealth = await BlocksRepository_1.default.$getAvgBlockHealthPerPoolId(pool.id);
        const totalReward = await BlocksRepository_1.default.$getTotalRewardForPoolId(pool.id);
        let currentEstimatedHashrate = 0;
        try {
            currentEstimatedHashrate = await bitcoin_client_1.default.getNetworkHashPs(totalBlock24h);
        }
        catch (e) {
            logger_1.default.debug('Bitcoin Core is not available, using zeroed value for current hashrate', logger_1.default.tags.mining);
        }
        return {
            pool: pool,
            blockCount: {
                'all': blockCount,
                '24h': blockCount24h,
                '1w': blockCount1w,
            },
            blockShare: {
                'all': blockCount / totalBlock,
                '24h': blockCount24h / totalBlock24h,
                '1w': blockCount1w / totalBlock1w,
            },
            estimatedHashrate: currentEstimatedHashrate * (blockCount24h / totalBlock24h),
            reportedHashrate: null,
            avgBlockHealth: avgHealth,
            totalReward: totalReward,
        };
    }
    /**
     * Get miner reward stats
     */
    async $getRewardStats(blockCount) {
        return await BlocksRepository_1.default.$getBlockStats(blockCount);
    }
    /**
     * Generate weekly mining pool hashrate history
     */
    async $generatePoolHashrateHistory() {
        const now = new Date();
        // Run only if:
        // * this.lastWeeklyHashrateIndexingDate is set to null (node backend restart, reorg, or re-indexing was requested after mining pools update)
        // * we started a new week (around Monday midnight)
        const runIndexing = this.lastWeeklyHashrateIndexingDate === null ||
            now.getUTCDay() === 1 && this.lastWeeklyHashrateIndexingDate !== now.getUTCDate();
        if (!runIndexing) {
            logger_1.default.debug(`Pool hashrate history indexing is up to date, nothing to do`, logger_1.default.tags.mining);
            return;
        }
        try {
            const oldestConsecutiveBlockTimestamp = 1000 * (await BlocksRepository_1.default.$getOldestConsecutiveBlock()).timestamp;
            const genesisData = await this.getGenesisData();
            const genesisTimestamp = genesisData.timestamp * 1000;
            const indexedTimestamp = await HashratesRepository_1.default.$getWeeklyHashrateTimestamps();
            const hashrates = [];
            const lastMonday = new Date(now.setDate(now.getDate() - (now.getDay() + 6) % 7));
            const lastMondayMidnight = this.getDateMidnight(lastMonday);
            let toTimestamp = lastMondayMidnight.getTime();
            const totalWeekIndexed = (await BlocksRepository_1.default.$blockCount(null, null)) / 1008;
            let indexedThisRun = 0;
            let totalIndexed = 0;
            let newlyIndexed = 0;
            const startedAt = new Date().getTime() / 1000;
            let timer = new Date().getTime() / 1000;
            logger_1.default.debug(`Indexing weekly mining pool hashrate`, logger_1.default.tags.mining);
            loading_indicators_1.default.setProgress('weekly-hashrate-indexing', 0);
            while (toTimestamp > genesisTimestamp && toTimestamp > oldestConsecutiveBlockTimestamp) {
                const fromTimestamp = toTimestamp - 604800000;
                // Skip already indexed weeks
                if (indexedTimestamp.includes(toTimestamp / 1000)) {
                    toTimestamp -= 604800000;
                    ++totalIndexed;
                    continue;
                }
                const blockStats = await BlocksRepository_1.default.$blockCountBetweenTimestamp(null, fromTimestamp / 1000, toTimestamp / 1000);
                if (blockStats.blockCount <= 0) {
                    logger_1.default.debug(`No block found between ${fromTimestamp / 1000} and ${toTimestamp / 1000}, skipping hashrate indexing for this period`, logger_1.default.tags.mining);
                }
                else {
                    const lastBlockHashrate = await bitcoin_client_1.default.getNetworkHashPs(blockStats.blockCount, blockStats.lastBlockHeight);
                    let pools = await PoolsRepository_1.default.$getPoolsInfoBetween(fromTimestamp / 1000, toTimestamp / 1000);
                    const totalBlocks = pools.reduce((acc, pool) => acc + pool.blockCount, 0);
                    if (totalBlocks > 0) {
                        pools = pools.map((pool) => {
                            pool.hashrate = (pool.blockCount / totalBlocks) * lastBlockHashrate;
                            pool.share = (pool.blockCount / totalBlocks);
                            return pool;
                        });
                        for (const pool of pools) {
                            hashrates.push({
                                hashrateTimestamp: toTimestamp / 1000,
                                avgHashrate: pool['hashrate'],
                                poolId: pool.poolId,
                                share: pool['share'],
                                type: 'weekly',
                            });
                        }
                        newlyIndexed += hashrates.length / Math.max(1, pools.length);
                        await HashratesRepository_1.default.$saveHashrates(hashrates);
                        hashrates.length = 0;
                    }
                }
                const elapsedSeconds = Math.max(1, Math.round((new Date().getTime() / 1000) - timer));
                if (elapsedSeconds > 1) {
                    const runningFor = Math.max(1, Math.round((new Date().getTime() / 1000) - startedAt));
                    const weeksPerSeconds = Math.max(1, Math.round(indexedThisRun / elapsedSeconds));
                    const progress = Math.round(totalIndexed / totalWeekIndexed * 10000) / 100;
                    const formattedDate = new Date(fromTimestamp).toUTCString();
                    logger_1.default.debug(`Getting weekly pool hashrate for ${formattedDate} | ~${weeksPerSeconds.toFixed(2)} weeks/sec | total: ~${totalIndexed}/${Math.round(totalWeekIndexed)} (${progress}%) | elapsed: ${runningFor} seconds`, logger_1.default.tags.mining);
                    timer = new Date().getTime() / 1000;
                    indexedThisRun = 0;
                    loading_indicators_1.default.setProgress('weekly-hashrate-indexing', progress, false);
                }
                toTimestamp -= 604800000;
                ++indexedThisRun;
                ++totalIndexed;
            }
            this.lastWeeklyHashrateIndexingDate = new Date().getUTCDate();
            if (newlyIndexed > 0) {
                logger_1.default.info(`Weekly mining pools hashrates indexing completed: indexed ${newlyIndexed} weeks`, logger_1.default.tags.mining);
            }
            else {
                logger_1.default.debug(`Weekly mining pools hashrates indexing completed: indexed ${newlyIndexed} weeks`, logger_1.default.tags.mining);
            }
            loading_indicators_1.default.setProgress('weekly-hashrate-indexing', 100);
        }
        catch (e) {
            loading_indicators_1.default.setProgress('weekly-hashrate-indexing', 100);
            logger_1.default.err(`Weekly mining pools hashrates indexing failed. Trying again in 10 seconds. Reason: ${(e instanceof Error ? e.message : e)}`, logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Generate daily hashrate data
     * @asyncUnsafe
     */
    async $generateNetworkHashrateHistory() {
        // If a re-index was requested, truncate first
        if (this.reindexHashrateRequested === true) {
            logger_1.default.notice(`hashrates will now be re-indexed`);
            await database_1.default.query(`TRUNCATE hashrates`);
            this.lastHashrateIndexingDate = 0;
            this.lastWeeklyHashrateIndexingDate = null;
            this.reindexHashrateRequested = false;
        }
        // We only run this once a day around midnight
        const today = new Date().getUTCDate();
        if (today === this.lastHashrateIndexingDate) {
            logger_1.default.debug(`Network hashrate history indexing is up to date, nothing to do`, logger_1.default.tags.mining);
            return;
        }
        const oldestConsecutiveBlockTimestamp = 1000 * (await BlocksRepository_1.default.$getOldestConsecutiveBlock()).timestamp;
        try {
            const genesisData = await this.getGenesisData();
            const genesisTimestamp = genesisData.timestamp * 1000;
            const indexedTimestamp = (await HashratesRepository_1.default.$getRawNetworkDailyHashrate(null)).map(hashrate => hashrate.timestamp);
            const lastMidnight = this.getDateMidnight(new Date());
            let toTimestamp = Math.round(lastMidnight.getTime());
            const hashrates = [];
            const totalDayIndexed = (await BlocksRepository_1.default.$blockCount(null, null)) / 144;
            let indexedThisRun = 0;
            let totalIndexed = 0;
            let newlyIndexed = 0;
            const startedAt = new Date().getTime() / 1000;
            let timer = new Date().getTime() / 1000;
            logger_1.default.debug(`Indexing daily network hashrate`, logger_1.default.tags.mining);
            loading_indicators_1.default.setProgress('daily-hashrate-indexing', 0);
            while (toTimestamp > genesisTimestamp && toTimestamp > oldestConsecutiveBlockTimestamp) {
                const fromTimestamp = toTimestamp - 86400000;
                // Skip already indexed days
                if (indexedTimestamp.includes(toTimestamp / 1000)) {
                    toTimestamp -= 86400000;
                    ++totalIndexed;
                    continue;
                }
                const blockStats = await BlocksRepository_1.default.$blockCountBetweenTimestamp(null, fromTimestamp / 1000, toTimestamp / 1000);
                const lastBlockHashrate = blockStats.blockCount === 0 ? 0 : await bitcoin_client_1.default.getNetworkHashPs(blockStats.blockCount, blockStats.lastBlockHeight);
                hashrates.push({
                    hashrateTimestamp: toTimestamp / 1000,
                    avgHashrate: lastBlockHashrate,
                    poolId: 0,
                    share: 1,
                    type: 'daily',
                });
                if (hashrates.length > 10) {
                    newlyIndexed += hashrates.length;
                    await HashratesRepository_1.default.$saveHashrates(hashrates);
                    hashrates.length = 0;
                }
                const elapsedSeconds = Math.max(1, Math.round((new Date().getTime() / 1000) - timer));
                if (elapsedSeconds > 1) {
                    const runningFor = Math.max(1, Math.round((new Date().getTime() / 1000) - startedAt));
                    const daysPerSeconds = Math.max(1, Math.round(indexedThisRun / elapsedSeconds));
                    const progress = Math.round(totalIndexed / totalDayIndexed * 10000) / 100;
                    const formattedDate = new Date(fromTimestamp).toUTCString();
                    logger_1.default.debug(`Getting network daily hashrate for ${formattedDate} | ~${daysPerSeconds.toFixed(2)} days/sec | total: ~${totalIndexed}/${Math.round(totalDayIndexed)} (${progress}%) | elapsed: ${runningFor} seconds`, logger_1.default.tags.mining);
                    timer = new Date().getTime() / 1000;
                    indexedThisRun = 0;
                    loading_indicators_1.default.setProgress('daily-hashrate-indexing', progress);
                }
                toTimestamp -= 86400000;
                ++indexedThisRun;
                ++totalIndexed;
            }
            // Add genesis block manually
            if (config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT === -1 && !indexedTimestamp.includes(genesisTimestamp / 1000)) {
                hashrates.push({
                    hashrateTimestamp: genesisTimestamp / 1000,
                    avgHashrate: await bitcoin_client_1.default.getNetworkHashPs(1, 1),
                    poolId: 0,
                    share: 1,
                    type: 'daily',
                });
            }
            newlyIndexed += hashrates.length;
            await HashratesRepository_1.default.$saveHashrates(hashrates);
            this.lastHashrateIndexingDate = new Date().getUTCDate();
            if (newlyIndexed > 0) {
                logger_1.default.info(`Daily network hashrate indexing completed: indexed ${newlyIndexed} days`, logger_1.default.tags.mining);
            }
            else {
                logger_1.default.debug(`Daily network hashrate indexing completed: indexed ${newlyIndexed} days`, logger_1.default.tags.mining);
            }
            loading_indicators_1.default.setProgress('daily-hashrate-indexing', 100);
        }
        catch (e) {
            loading_indicators_1.default.setProgress('daily-hashrate-indexing', 100);
            logger_1.default.err(`Daily network hashrate indexing failed. Trying again later. Reason: ${(e instanceof Error ? e.message : e)}`, logger_1.default.tags.mining);
            throw e;
        }
    }
    /**
     * Index difficulty adjustments
     * @asyncUnsafe
     */
    async $indexDifficultyAdjustments() {
        // If a re-index was requested, truncate first
        if (this.reindexDifficultyAdjustmentRequested === true) {
            logger_1.default.notice(`difficulty_adjustments will now be re-indexed`);
            await database_1.default.query(`TRUNCATE difficulty_adjustments`);
            this.reindexDifficultyAdjustmentRequested = false;
        }
        const indexedHeightsArray = await DifficultyAdjustmentsRepository_1.default.$getAdjustmentsHeights();
        const indexedHeights = {};
        for (const height of indexedHeightsArray) {
            indexedHeights[height] = true;
        }
        // gets {time, height, difficulty, bits} of blocks in ascending order of height
        const blocks = await BlocksRepository_1.default.$getBlocksDifficulty();
        const genesisData = await this.getGenesisData();
        let currentDifficulty = genesisData.difficulty;
        let currentBits = genesisData.bits;
        let totalIndexed = 0;
        if (config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT === -1 && indexedHeights[0] !== true) {
            await DifficultyAdjustmentsRepository_1.default.$saveAdjustments({
                time: genesisData.timestamp,
                height: 0,
                difficulty: currentDifficulty,
                adjustment: 0.0,
            });
        }
        if (!blocks?.length) {
            // no blocks in database yet
            return;
        }
        const oldestConsecutiveBlock = this.getOldestConsecutiveBlock(blocks);
        currentBits = oldestConsecutiveBlock.bits;
        currentDifficulty = oldestConsecutiveBlock.difficulty;
        let totalBlockChecked = 0;
        let timer = new Date().getTime() / 1000;
        for (const block of blocks) {
            // skip until the first block after the oldest consecutive block
            if (block.height <= oldestConsecutiveBlock.height) {
                continue;
            }
            // difficulty has changed between two consecutive blocks!
            if (block.bits !== currentBits) {
                // skip if already indexed
                if (indexedHeights[block.height] !== true) {
                    let adjustment = block.difficulty / currentDifficulty;
                    adjustment = Math.round(adjustment * 1000000) / 1000000; // Remove float point noise
                    await DifficultyAdjustmentsRepository_1.default.$saveAdjustments({
                        time: block.time,
                        height: block.height,
                        difficulty: block.difficulty,
                        adjustment: adjustment,
                    });
                    totalIndexed++;
                }
                // update the current difficulty
                currentDifficulty = block.difficulty;
                currentBits = block.bits;
            }
            totalBlockChecked++;
            const elapsedSeconds = Math.max(1, Math.round((new Date().getTime() / 1000) - timer));
            if (elapsedSeconds > 5) {
                const progress = Math.round(totalBlockChecked / blocks.length * 100);
                logger_1.default.debug(`Indexing difficulty adjustment at block #${block.height} | Progress: ${progress}%`, logger_1.default.tags.mining);
                timer = new Date().getTime() / 1000;
            }
        }
        if (totalIndexed > 0) {
            logger_1.default.info(`Indexed ${totalIndexed} difficulty adjustments`, logger_1.default.tags.mining);
        }
        else {
            logger_1.default.debug(`Indexed ${totalIndexed} difficulty adjustments`, logger_1.default.tags.mining);
        }
    }
    /**
     * Create a link between blocks and the latest price at when they were mined
     *
     * @asyncSafe
     */
    async $indexBlockPrices() {
        if (this.blocksPriceIndexingRunning === true) {
            return;
        }
        this.blocksPriceIndexingRunning = true;
        let totalInserted = 0;
        try {
            const prices = await PricesRepository_1.default.$getPricesTimesAndId();
            const blocksWithoutPrices = await BlocksRepository_1.default.$getBlocksWithoutPrice();
            const blocksPrices = [];
            for (const block of blocksWithoutPrices) {
                // Quick optimisation, out mtgox feed only goes back to 2010-07-19 02:00:00, so skip the first 68951 blocks
                if (['mainnet', 'testnet'].includes(config_1.default.MEMPOOL.NETWORK) && block.height < 68951) {
                    blocksPrices.push({
                        height: block.height,
                        priceId: prices[0].id,
                    });
                    continue;
                }
                for (const price of prices) {
                    if (block.timestamp < price.time) {
                        blocksPrices.push({
                            height: block.height,
                            priceId: price.id,
                        });
                        break;
                    }
                    ;
                }
                if (blocksPrices.length >= 100000) {
                    totalInserted += blocksPrices.length;
                    let logStr = `Linking ${blocksPrices.length} blocks to their closest price`;
                    if (blocksWithoutPrices.length > 200000) {
                        logStr += ` | Progress ${Math.round(totalInserted / blocksWithoutPrices.length * 100)}%`;
                    }
                    logger_1.default.debug(logStr, logger_1.default.tags.mining);
                    await BlocksRepository_1.default.$saveBlockPrices(blocksPrices);
                    blocksPrices.length = 0;
                }
            }
            if (blocksPrices.length > 0) {
                totalInserted += blocksPrices.length;
                let logStr = `Linking ${blocksPrices.length} blocks to their closest price`;
                if (blocksWithoutPrices.length > 200000) {
                    logStr += ` | Progress ${Math.round(totalInserted / blocksWithoutPrices.length * 100)}%`;
                }
                logger_1.default.debug(logStr, logger_1.default.tags.mining);
                await BlocksRepository_1.default.$saveBlockPrices(blocksPrices);
            }
        }
        catch (e) {
            this.blocksPriceIndexingRunning = false;
            logger_1.default.err(`Cannot index block prices. ${e}`);
        }
        if (totalInserted > 0) {
            logger_1.default.info(`Indexing blocks prices completed. Indexed ${totalInserted}`, logger_1.default.tags.mining);
        }
        else {
            logger_1.default.debug(`Indexing blocks prices completed. Indexed 0.`, logger_1.default.tags.mining);
        }
        this.blocksPriceIndexingRunning = false;
    }
    /**
     * Index core coinstatsindex
     *
     * @asyncUnsafe
     */
    async $indexCoinStatsIndex() {
        let timer = new Date().getTime() / 1000;
        let totalIndexed = 0;
        const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
        let currentBlockHeight = blockchainInfo.blocks;
        while (currentBlockHeight > 0) {
            const indexedBlocks = await BlocksRepository_1.default.$getBlocksMissingCoinStatsIndex(currentBlockHeight, currentBlockHeight - 10000);
            for (const block of indexedBlocks) {
                const txoutset = await bitcoin_client_1.default.getTxoutSetinfo('none', block.height);
                await BlocksRepository_1.default.$updateCoinStatsIndexData(block.hash, txoutset.txouts, Math.round(txoutset.block_info.prevout_spent * 100000000));
                ++totalIndexed;
                const elapsedSeconds = Math.max(1, new Date().getTime() / 1000 - timer);
                if (elapsedSeconds > 5) {
                    logger_1.default.info(`Indexing coinstatsindex data for block #${block.height}. Indexed ${totalIndexed} blocks.`, logger_1.default.tags.mining);
                    timer = new Date().getTime() / 1000;
                }
            }
            currentBlockHeight -= 10000;
        }
        if (totalIndexed > 0) {
            logger_1.default.info(`Indexing missing coinstatsindex data completed. Indexed ${totalIndexed}`, logger_1.default.tags.mining);
        }
        else {
            logger_1.default.debug(`Indexing missing coinstatsindex data completed. Indexed 0.`, logger_1.default.tags.mining);
        }
    }
    /**
     * List existing mining pools
     * @asyncUnsafe
     */
    async $listPools() {
        const [rows] = await database_1.default.query(`
      SELECT
        name,
        slug,
        unique_id
      FROM pools`);
        return rows;
    }
    getDateMidnight(date) {
        date.setUTCHours(0);
        date.setUTCMinutes(0);
        date.setUTCSeconds(0);
        date.setUTCMilliseconds(0);
        return date;
    }
    getTimeRange(interval, scale = 1) {
        switch (interval) {
            case '4y': return 43200 * scale; // 12h
            case '3y': return 43200 * scale; // 12h
            case '2y': return 28800 * scale; // 8h
            case '1y': return 28800 * scale; // 8h
            case '6m': return 10800 * scale; // 3h
            case '3m': return 7200 * scale; // 2h
            case '1m': return 1800 * scale; // 30min
            case '1w': return 300 * scale; // 5min
            case '3d': return 1 * scale;
            case '24h': return 1 * scale;
            default: return 86400 * scale;
        }
    }
    getTimeRangeFromTimespan(from, to, scale = 1) {
        const timespan = to - from;
        switch (true) {
            case timespan > 3600 * 24 * 365 * 4: return 86400 * scale; // 24h
            case timespan > 3600 * 24 * 365 * 3: return 43200 * scale; // 12h
            case timespan > 3600 * 24 * 365 * 2: return 43200 * scale; // 12h
            case timespan > 3600 * 24 * 365: return 28800 * scale; // 8h
            case timespan > 3600 * 24 * 30 * 6: return 28800 * scale; // 8h
            case timespan > 3600 * 24 * 30 * 3: return 10800 * scale; // 3h
            case timespan > 3600 * 24 * 30: return 7200 * scale; // 2h
            case timespan > 3600 * 24 * 7: return 1800 * scale; // 30min
            case timespan > 3600 * 24 * 3: return 300 * scale; // 5min
            case timespan > 3600 * 24: return 1 * scale;
            default: return 1 * scale;
        }
    }
    // Finds the oldest block in a consecutive chain back from the tip
    // assumes `blocks` is sorted in ascending height order
    getOldestConsecutiveBlock(blocks) {
        for (let i = blocks.length - 1; i > 0; i--) {
            if ((blocks[i].height - blocks[i - 1].height) > 1) {
                return blocks[i];
            }
        }
        return blocks[0];
    }
    /** @asyncUnsafe */
    async getGenesisData() {
        if (this.genesisData == null) {
            const genesisBlock = await bitcoin_api_factory_1.default.$getBlock(await bitcoin_api_factory_1.default.$getBlockHash(0));
            this.genesisData = {
                timestamp: genesisBlock.timestamp,
                bits: genesisBlock.bits,
                difficulty: genesisBlock.difficulty,
            };
        }
        return this.genesisData;
    }
}
exports.default = new Mining();
