"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const common_1 = require("../api/common");
const config_1 = __importDefault(require("../config"));
const blocks_1 = __importDefault(require("../api/blocks"));
const acceleration_1 = __importDefault(require("../api/services/acceleration"));
const acceleration_2 = __importDefault(require("../api/acceleration/acceleration"));
const bitcoin_api_factory_1 = __importDefault(require("../api/bitcoin/bitcoin-api-factory"));
const transaction_utils_1 = __importDefault(require("../api/transaction-utils"));
const mini_miner_1 = require("../api/mini-miner");
class AccelerationRepository {
    bidBoostV2Activated = 831580;
    /** @asyncSafe */
    async $saveAcceleration(acceleration, block, pool_id, accelerationData) {
        const accelerationMap = {};
        for (const acc of accelerationData) {
            accelerationMap[acc.txid] = acc;
        }
        try {
            await database_1.default.query(`
        INSERT INTO accelerations(txid, requested, added, height, pool, effective_vsize, effective_fee, boost_rate, boost_cost)
        VALUE (?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          height = ?
      `, [
                acceleration.txSummary.txid,
                accelerationMap[acceleration.txSummary.txid].added,
                block.timestamp,
                block.height,
                pool_id,
                acceleration.txSummary.effectiveVsize,
                acceleration.txSummary.effectiveFee,
                acceleration.targetFeeRate,
                acceleration.cost,
                block.height,
            ]);
        }
        catch (e) {
            logger_1.default.err(`Cannot save acceleration (${acceleration.txSummary.txid}) into db. Reason: ` + (e instanceof Error ? e.message : e));
            // We don't throw, not a critical issue if we miss some accelerations
        }
    }
    /** @asyncSafe */
    async $getAccelerationInfoForTxid(txid) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT *, UNIX_TIMESTAMP(requested) as requested_timestamp, UNIX_TIMESTAMP(added) as block_timestamp FROM accelerations
        JOIN pools on pools.unique_id = accelerations.pool
        WHERE txid = ?
      `, [txid]);
            if (rows?.length) {
                const row = rows[0];
                return {
                    txid: row.txid,
                    height: row.height,
                    added: row.requested_timestamp || row.block_timestamp,
                    pool: {
                        id: row.id,
                        slug: row.slug,
                        name: row.name,
                    },
                    effective_vsize: row.effective_vsize,
                    effective_fee: row.effective_fee,
                    boost_rate: row.boost_rate,
                    boost_cost: row.boost_cost,
                };
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot get acceleration info for txid ${txid}. Reason: ` + (e instanceof Error ? e.message : e));
            return null;
        }
        return null;
    }
    async $getAccelerationInfo(poolSlug = null, height = null, interval = null) {
        if (!interval || !['24h', '3d', '1w', '1m'].includes(interval)) {
            interval = '1m';
        }
        interval = common_1.Common.getSqlInterval(interval);
        if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS || (interval == null && poolSlug == null && height == null)) {
            return [];
        }
        let query = `
      SELECT *, UNIX_TIMESTAMP(requested) as requested_timestamp, UNIX_TIMESTAMP(added) as block_timestamp FROM accelerations
      JOIN pools on pools.unique_id = accelerations.pool
    `;
        const params = [];
        let hasFilter = false;
        if (interval && height === null) {
            query += ` WHERE accelerations.added BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW() `;
            hasFilter = true;
        }
        if (height != null) {
            if (hasFilter) {
                query += ` AND accelerations.height = ? `;
            }
            else {
                query += ` WHERE accelerations.height = ? `;
            }
            params.push(height);
        }
        else if (poolSlug != null) {
            if (hasFilter) {
                query += ` AND pools.slug = ? `;
            }
            else {
                query += ` WHERE pools.slug = ? `;
            }
            params.push(poolSlug);
        }
        query += ` ORDER BY accelerations.added DESC `;
        try {
            const [rows] = await database_1.default.query(query, params);
            if (rows?.length) {
                return rows.map(row => ({
                    txid: row.txid,
                    height: row.height,
                    added: row.requested_timestamp || row.block_timestamp,
                    pool: {
                        id: row.id,
                        slug: row.slug,
                        name: row.name,
                    },
                    effective_vsize: row.effective_vsize,
                    effective_fee: row.effective_fee,
                    boost_rate: row.boost_rate,
                    boost_cost: row.boost_cost,
                }));
            }
            else {
                return [];
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot query acceleration info. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $getAccelerationTotals(poolSlug = null, interval = null) {
        interval = common_1.Common.getSqlInterval(interval);
        if (!config_1.default.MEMPOOL_SERVICES.ACCELERATIONS) {
            return { cost: 0, count: 0 };
        }
        let query = `
      SELECT SUM(boost_cost) as total_cost, COUNT(txid) as count FROM accelerations
      JOIN pools on pools.unique_id = accelerations.pool
    `;
        const params = [];
        let hasFilter = false;
        if (interval) {
            query += ` WHERE accelerations.added BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW() `;
            hasFilter = true;
        }
        if (poolSlug != null) {
            if (hasFilter) {
                query += ` AND pools.slug = ? `;
            }
            else {
                query += ` WHERE pools.slug = ? `;
            }
            params.push(poolSlug);
        }
        try {
            const [rows] = await database_1.default.query(query, params);
            return {
                cost: rows[0]?.total_cost || 0,
                count: rows[0]?.count || 0,
            };
        }
        catch (e) {
            logger_1.default.err(`Cannot query acceleration totals. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /** @asyncSafe */
    async $getLastSyncedHeight() {
        try {
            const [rows] = await database_1.default.query(`
        SELECT * FROM state
        WHERE name = 'last_acceleration_block'
      `);
            if (rows?.['length']) {
                return rows[0].number;
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot find last acceleration sync height. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return 0;
    }
    /** @asyncSafe */
    async $setLastSyncedHeight(height) {
        try {
            await database_1.default.query(`
        UPDATE state
        SET number = ?
        WHERE name = 'last_acceleration_block'
      `, [height]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update last acceleration sync height. Reason: ` + (e instanceof Error ? e.message : e));
        }
    }
    // modifies block transactions
    /** @asyncSafe */
    async $indexAccelerationsForBlock(block, accelerations, transactions) {
        const blockTxs = {};
        for (const tx of transactions) {
            blockTxs[tx.txid] = tx;
        }
        const successfulAccelerations = accelerations.filter(acc => acc.pools.includes(block.extras.pool.id));
        let boostRate = null;
        for (const acc of successfulAccelerations) {
            if (boostRate === null) {
                boostRate = acceleration_2.default.calculateBoostRate(accelerations.map(acc => ({ txid: acc.txid, max_bid: acc.feeDelta })), transactions);
            }
            if (blockTxs[acc.txid]) {
                const tx = blockTxs[acc.txid];
                const accelerationInfo = acceleration_2.default.getAccelerationInfo(tx, boostRate, transactions);
                accelerationInfo.cost = Math.max(0, Math.min(acc.feeDelta, accelerationInfo.cost));
                void this.$saveAcceleration(accelerationInfo, block, block.extras.pool.id, successfulAccelerations);
            }
        }
        let anyConfirmed = false;
        for (const acc of accelerations) {
            if (blockTxs[acc.txid]) {
                anyConfirmed = true;
            }
        }
        if (anyConfirmed) {
            acceleration_1.default.accelerationConfirmed();
        }
        const lastSyncedHeight = await this.$getLastSyncedHeight();
        // if we've missed any blocks, let the indexer catch up from the last synced height on the next run
        if (block.height === lastSyncedHeight + 1) {
            await this.$setLastSyncedHeight(block.height);
        }
    }
    /**
     * [INDEXING] Backfill missing acceleration data
     */
    async $indexPastAccelerations() {
        if (config_1.default.MEMPOOL.NETWORK !== 'mainnet' || !config_1.default.MEMPOOL_SERVICES.ACCELERATIONS) {
            // acceleration history disabled
            return;
        }
        const lastSyncedHeight = await this.$getLastSyncedHeight();
        const currentHeight = blocks_1.default.getCurrentBlockHeight();
        if (currentHeight <= lastSyncedHeight) {
            // already in sync
            return;
        }
        logger_1.default.debug(`Fetching accelerations between block ${lastSyncedHeight} and ${currentHeight}`);
        // Fetch accelerations from mempool.space since the last synced block;
        const accelerationsByBlock = {};
        const blockHashes = {};
        let done = false;
        let page = 1;
        let count = 0;
        try {
            while (!done) {
                // don't DDoS the services backend
                await common_1.Common.sleep$(500 + (Math.random() * 1000));
                const accelerations = await acceleration_1.default.$fetchAccelerationHistory(page);
                page++;
                if (!accelerations?.length) {
                    done = true;
                    break;
                }
                for (const acc of accelerations) {
                    if (acc.status !== 'completed_provisional' && acc.status !== 'completed') {
                        continue;
                    }
                    if (!lastSyncedHeight || acc.blockHeight > lastSyncedHeight) {
                        if (!accelerationsByBlock[acc.blockHeight]) {
                            accelerationsByBlock[acc.blockHeight] = [];
                            blockHashes[acc.blockHeight] = acc.blockHash;
                        }
                        accelerationsByBlock[acc.blockHeight].push(acc);
                        count++;
                    }
                    else {
                        done = true;
                    }
                }
            }
        }
        catch (e) {
            logger_1.default.err(`Failed to fetch full acceleration history. Reason: ` + (e instanceof Error ? e.message : e));
        }
        logger_1.default.debug(`Indexing ${count} accelerations between block ${lastSyncedHeight} and ${currentHeight}`);
        // process accelerated blocks in order
        const heights = Object.keys(accelerationsByBlock).map(key => parseInt(key)).sort((a, b) => a - b);
        for (const height of heights) {
            const accelerations = accelerationsByBlock[height];
            try {
                const block = await blocks_1.default.$getBlock(blockHashes[height]);
                const transactions = (await bitcoin_api_factory_1.default.$getTxsForBlock(blockHashes[height])).map(tx => transaction_utils_1.default.extendMempoolTransaction(tx));
                const blockTxs = {};
                for (const tx of transactions) {
                    blockTxs[tx.txid] = tx;
                }
                let boostRate = 0;
                // use Bid Boost V2 if active
                if (height > this.bidBoostV2Activated) {
                    boostRate = acceleration_2.default.calculateBoostRate(accelerations.map(acc => ({ txid: acc.txid, max_bid: acc.feeDelta })), transactions);
                }
                else {
                    // default to Bid Boost V1 (median block fee rate)
                    const template = (0, mini_miner_1.makeBlockTemplate)(transactions, accelerations.map(acc => ({ txid: acc.txid, max_bid: acc.feeDelta })), 1, Infinity, Infinity);
                    const feeStats = common_1.Common.calcEffectiveFeeStatistics(template);
                    boostRate = feeStats.medianFee;
                }
                const accelerationSummaries = accelerations.map(acc => ({
                    ...acc,
                    pools: acc.pools,
                }));
                for (const acc of accelerations) {
                    if (blockTxs[acc.txid] && acc.pools.includes(block.extras.pool.id)) {
                        const tx = blockTxs[acc.txid];
                        const accelerationInfo = acceleration_2.default.getAccelerationInfo(tx, boostRate, transactions);
                        accelerationInfo.cost = Math.max(0, Math.min(acc.feeDelta, accelerationInfo.cost));
                        await this.$saveAcceleration(accelerationInfo, block, block.extras.pool.id, accelerationSummaries);
                    }
                }
                await this.$setLastSyncedHeight(height);
            }
            catch (e) {
                logger_1.default.err(`Failed to process accelerations for block ${height}. Reason: ` + (e instanceof Error ? e.message : e));
                return;
            }
            logger_1.default.debug(`Indexed ${accelerations.length} accelerations in block  ${height}`);
        }
        await this.$setLastSyncedHeight(currentHeight);
        logger_1.default.debug(`Indexing accelerations completed`);
    }
    /**
     * Delete accelerations from the database above blockHeight
     */
    async $deleteAccelerationsFrom(blockHeight) {
        logger_1.default.info(`Delete newer accelerations from height ${blockHeight} from the database`);
        try {
            const currentSyncedHeight = await this.$getLastSyncedHeight();
            if (currentSyncedHeight >= blockHeight) {
                await database_1.default.query(`
          UPDATE state
          SET number = ?
          WHERE name = 'last_acceleration_block'
        `, [blockHeight - 1]);
            }
            await database_1.default.query(`DELETE FROM accelerations where height >= ${blockHeight}`);
        }
        catch (e) {
            logger_1.default.err('Cannot delete indexed accelerations. Reason: ' + (e instanceof Error ? e.message : e));
        }
    }
}
exports.default = new AccelerationRepository();
