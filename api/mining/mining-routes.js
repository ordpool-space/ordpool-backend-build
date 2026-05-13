"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../logger"));
const BlocksAuditsRepository_1 = __importDefault(require("../../repositories/BlocksAuditsRepository"));
const BlocksRepository_1 = __importDefault(require("../../repositories/BlocksRepository"));
const DifficultyAdjustmentsRepository_1 = __importDefault(require("../../repositories/DifficultyAdjustmentsRepository"));
const HashratesRepository_1 = __importDefault(require("../../repositories/HashratesRepository"));
const bitcoin_client_1 = __importDefault(require("../bitcoin/bitcoin-client"));
const mining_1 = __importDefault(require("./mining"));
const PricesRepository_1 = __importDefault(require("../../repositories/PricesRepository"));
const AccelerationRepository_1 = __importDefault(require("../../repositories/AccelerationRepository"));
const acceleration_1 = __importDefault(require("../services/acceleration"));
const api_1 = require("../../utils/api");
class MiningRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pools', this.$listPools)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pools/:interval', this.$getPools)
            // HACK -- Ordpool: pool detail endpoints disabled. The underlying
            // queries (per-pool block list + historical hashrate) are heavy and
            // routinely time out on api.ordpool.space, while the frontend pool
            // detail page itself is now a redirect (see graphs.routing.module).
            // Return 410 Gone with a 1-day cache so clients back off. The
            // pools-LIST routes (`mining/pools`, `mining/pools/:interval`) stay
            // alive — they're cheap and still feed the mining dashboard.
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/hashrate', this.$poolDetailDisabled)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/blocks', this.$poolDetailDisabled)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/blocks/:height', this.$poolDetailDisabled)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug', this.$poolDetailDisabled)
            /* HACK -- Ordpool: original mempool registrations, preserved for merge clarity.
            .get(config.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/hashrate', this.$getPoolHistoricalHashrate)
            .get(config.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/blocks', this.$getPoolBlocks)
            .get(config.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug/blocks/:height', this.$getPoolBlocks)
            .get(config.MEMPOOL.API_URL_PREFIX + 'mining/pool/:slug', this.$getPool)
            */
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/hashrate/pools/:interval', this.$getPoolsHistoricalHashrate)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/hashrate/:interval', this.$getHistoricalHashrate)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/difficulty-adjustments', this.$getDifficultyAdjustments)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/reward-stats/:blockCount', this.$getRewardStats)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/fees/:interval', this.$getHistoricalBlockFees)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/fees', this.$getBlockFeesTimespan)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/rewards/:interval', this.$getHistoricalBlockRewards)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/fee-rates/:interval', this.$getHistoricalBlockFeeRates)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/sizes-weights/:interval', this.$getHistoricalBlockSizeAndWeight)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/difficulty-adjustments/:interval', this.$getDifficultyAdjustments)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/predictions/:interval', this.$getHistoricalBlocksHealth)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/audit/scores', this.$getBlockAuditScores)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/audit/scores/:height', this.$getBlockAuditScores)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/audit/score/:hash', this.$getBlockAuditScore)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/audit/:hash', this.$getBlockAudit)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'mining/blocks/timestamp/:timestamp', this.$getHeightFromTimestamp)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'historical-price', this.$getHistoricalPrice)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'accelerations/pool/:slug', this.$getAccelerationsByPool)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'accelerations/block/:height', this.$getAccelerationsByHeight)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'accelerations/recent/:interval', this.$getRecentAccelerations)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'accelerations/total', this.$getAccelerationTotals)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'accelerations', this.$getActiveAccelerations)
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'acceleration/request/:txid', this.$requestAcceleration);
    }
    // HACK -- Ordpool: empty-200 stub for the disabled pool detail
    // endpoints. See initRoutes for the rationale. We avoid 4xx so this
    // doesn't show up as a red row in any browser DevTools / console for
    // direct callers; Cache-Control: 1d still encourages well-behaved
    // clients to back off.
    $poolDetailDisabled(req, res) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.status(200).json([]);
    }
    async $getHistoricalPrice(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            if (['testnet', 'signet', 'liquidtestnet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Prices are not available on testnets.');
                return;
            }
            const timestamp = parseInt(req.query.timestamp, 10) || 0;
            const currency = req.query.currency;
            let response;
            if (timestamp && currency) {
                response = await PricesRepository_1.default.$getNearestHistoricalPrice(timestamp, currency);
            }
            else if (timestamp) {
                response = await PricesRepository_1.default.$getNearestHistoricalPrice(timestamp);
            }
            else if (currency) {
                response = await PricesRepository_1.default.$getHistoricalPrices(currency);
            }
            else {
                response = await PricesRepository_1.default.$getHistoricalPrices();
            }
            res.status(200).send(response);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical prices');
        }
    }
    async $getPool(req, res) {
        try {
            const stats = await mining_1.default.$getPoolStat(req.params.slug);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(stats);
        }
        catch (e) {
            if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
                (0, api_1.handleError)(req, res, 404, e.message);
            }
            else {
                (0, api_1.handleError)(req, res, 500, 'Failed to get pool');
            }
        }
    }
    async $getPoolBlocks(req, res) {
        try {
            const poolBlocks = await BlocksRepository_1.default.$getBlocksByPool(req.params.slug, req.params.height === undefined ? undefined : parseInt(req.params.height, 10));
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(poolBlocks);
        }
        catch (e) {
            if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
                (0, api_1.handleError)(req, res, 404, e.message);
            }
            else {
                (0, api_1.handleError)(req, res, 500, 'Failed to get blocks for pool');
            }
        }
    }
    async $listPools(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            const pools = await mining_1.default.$listPools();
            if (!pools) {
                res.status(500).end();
                return;
            }
            res.header('X-total-count', pools.length.toString());
            if (pools.length === 0) {
                res.status(204).send();
            }
            else {
                res.json(pools);
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pools');
        }
    }
    async $getPools(req, res) {
        try {
            const stats = await mining_1.default.$getPoolsStats(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(stats);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pools');
        }
    }
    async $getPoolsHistoricalHashrate(req, res) {
        try {
            const hashrates = await HashratesRepository_1.default.$getPoolsWeeklyHashrate(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            res.json(hashrates);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pools historical hashrate');
        }
    }
    async $getPoolHistoricalHashrate(req, res) {
        try {
            const hashrates = await HashratesRepository_1.default.$getPoolWeeklyHashrate(req.params.slug);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            res.json(hashrates);
        }
        catch (e) {
            if (e instanceof Error && e.message.indexOf('This mining pool does not exist') > -1) {
                (0, api_1.handleError)(req, res, 404, e.message);
            }
            else {
                (0, api_1.handleError)(req, res, 500, 'Failed to get pool historical hashrate');
            }
        }
    }
    async $getHistoricalHashrate(req, res) {
        let currentHashrate = 0, currentDifficulty = 0;
        try {
            currentHashrate = await bitcoin_client_1.default.getNetworkHashPs(1008);
            currentDifficulty = await bitcoin_client_1.default.getDifficulty();
        }
        catch (e) {
            logger_1.default.debug('Bitcoin Core is not available, using zeroed value for current hashrate and difficulty');
        }
        try {
            const hashrates = await HashratesRepository_1.default.$getNetworkDailyHashrate(req.params.interval);
            const difficulty = await DifficultyAdjustmentsRepository_1.default.$getAdjustments(req.params.interval, false);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            res.json({
                hashrates: hashrates,
                difficulty: difficulty,
                currentHashrate: currentHashrate,
                currentDifficulty: currentDifficulty,
            });
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical hashrate');
        }
    }
    async $getHistoricalBlockFees(req, res) {
        try {
            const blockFees = await mining_1.default.$getHistoricalBlockFees(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(blockFees);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical block fees');
        }
    }
    async $getBlockFeesTimespan(req, res) {
        try {
            if (!parseInt(req.query.from, 10) || !parseInt(req.query.to, 10)) {
                throw new Error('Invalid timestamp range');
            }
            if (parseInt(req.query.from, 10) > parseInt(req.query.to, 10)) {
                throw new Error('from must be less than to');
            }
            const blockFees = await mining_1.default.$getBlockFeesTimespan(parseInt(req.query.from, 10), parseInt(req.query.to, 10));
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(blockFees);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical block fees');
        }
    }
    async $getHistoricalBlockRewards(req, res) {
        try {
            const blockRewards = await mining_1.default.$getHistoricalBlockRewards(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(blockRewards);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical block rewards');
        }
    }
    async $getHistoricalBlockFeeRates(req, res) {
        try {
            const blockFeeRates = await mining_1.default.$getHistoricalBlockFeeRates(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(blockFeeRates);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical block fee rates');
        }
    }
    async $getHistoricalBlockSizeAndWeight(req, res) {
        try {
            const blockSizes = await mining_1.default.$getHistoricalBlockSizes(req.params.interval);
            const blockWeights = await mining_1.default.$getHistoricalBlockWeights(req.params.interval);
            const blockCount = await BlocksRepository_1.default.$blockCount(null, null);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json({
                sizes: blockSizes,
                weights: blockWeights
            });
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical block size and weight');
        }
    }
    async $getDifficultyAdjustments(req, res) {
        try {
            const difficulty = await DifficultyAdjustmentsRepository_1.default.$getRawAdjustments(req.params.interval, true);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            res.json(difficulty.map(adj => [adj.time, adj.height, adj.difficulty, adj.adjustment]));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical difficulty adjustments');
        }
    }
    async $getRewardStats(req, res) {
        try {
            const response = await mining_1.default.$getRewardStats(parseInt(req.params.blockCount, 10));
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(response);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get reward stats');
        }
    }
    async $getHistoricalBlocksHealth(req, res) {
        try {
            const blocksHealth = await mining_1.default.$getBlocksHealthHistory(req.params.interval);
            const blockCount = await BlocksAuditsRepository_1.default.$getBlocksHealthCount();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', blockCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(blocksHealth.map(health => [health.time, health.height, health.match_rate]));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical blocks health');
        }
    }
    async $getBlockAudit(req, res) {
        try {
            const audit = await BlocksAuditsRepository_1.default.$getBlockAudit(req.params.hash);
            if (!audit) {
                (0, api_1.handleError)(req, res, 204, `This block has not been audited.`);
                return;
            }
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24).toUTCString());
            res.json(audit);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block audit');
        }
    }
    async $getHeightFromTimestamp(req, res) {
        try {
            const timestamp = parseInt(req.params.timestamp, 10);
            // This will prevent people from entering milliseconds etc.
            // Block timestamps are allowed to be up to 2 hours off, so 24 hours
            // will never put the maximum value before the most recent block
            const nowPlus1day = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
            // Prevent non-integers that are not seconds
            if (!/^[1-9][0-9]*$/.test(req.params.timestamp) || timestamp > nowPlus1day) {
                throw new Error(`Invalid timestamp, value must be Unix seconds`);
            }
            const result = await BlocksRepository_1.default.$getBlockHeightFromTimestamp(timestamp);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get height from timestamp');
        }
    }
    async $getBlockAuditScores(req, res) {
        try {
            let height = req.params.height === undefined ? undefined : parseInt(req.params.height, 10);
            if (height == null) {
                height = await BlocksRepository_1.default.$mostRecentBlockHeight();
            }
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(await BlocksAuditsRepository_1.default.$getBlockAuditScores(height, height - 15));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block audit scores');
        }
    }
    async $getBlockAuditScore(req, res) {
        try {
            const audit = await BlocksAuditsRepository_1.default.$getBlockAuditScore(req.params.hash);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24).toUTCString());
            res.json(audit || 'null');
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get block audit score');
        }
    }
    async $getAccelerationsByPool(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || ['testnet', 'signet', 'liquidtestnet', 'liquid', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Acceleration data is not available.');
                return;
            }
            res.status(200).send(await AccelerationRepository_1.default.$getAccelerationInfo(req.params.slug));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get accelerations by pool');
        }
    }
    async $getAccelerationsByHeight(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 3600 * 24).toUTCString());
            if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || ['testnet', 'signet', 'liquidtestnet', 'liquid', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Acceleration data is not available.');
                return;
            }
            const height = req.params.height === undefined ? undefined : parseInt(req.params.height, 10);
            res.status(200).send(await AccelerationRepository_1.default.$getAccelerationInfo(null, height));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get accelerations by height');
        }
    }
    async $getRecentAccelerations(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || ['testnet', 'signet', 'liquidtestnet', 'liquid', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Acceleration data is not available.');
                return;
            }
            res.status(200).send(await AccelerationRepository_1.default.$getAccelerationInfo(null, null, req.params.interval));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get recent accelerations');
        }
    }
    async $getAccelerationTotals(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || ['testnet', 'signet', 'liquidtestnet', 'liquid', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Acceleration data is not available.');
                return;
            }
            res.status(200).send(await AccelerationRepository_1.default.$getAccelerationTotals(req.query.pool, req.query.interval));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get acceleration totals');
        }
    }
    async $getActiveAccelerations(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || ['testnet', 'signet', 'liquidtestnet', 'liquid', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Acceleration data is not available.');
                return;
            }
            res.status(200).send(Object.values(acceleration_1.default.getAccelerations() || {}));
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get active accelerations');
        }
    }
    async $requestAcceleration(req, res) {
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-control', 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('expires', -1);
        try {
            acceleration_1.default.accelerationRequested(req.params.txid);
            res.status(200).send();
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to request acceleration');
        }
    }
}
exports.default = new MiningRoutes();
