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
const bitcoin_api_factory_1 = __importDefault(require("../api/bitcoin/bitcoin-api-factory"));
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const common_1 = require("../api/common");
const PoolsRepository_1 = __importDefault(require("./PoolsRepository"));
const HashratesRepository_1 = __importDefault(require("./HashratesRepository"));
const BlocksSummariesRepository_1 = __importDefault(require("./BlocksSummariesRepository"));
const DifficultyAdjustmentsRepository_1 = __importDefault(require("./DifficultyAdjustmentsRepository"));
const bitcoin_client_1 = __importDefault(require("../api/bitcoin/bitcoin-client"));
const config_1 = __importDefault(require("../config"));
const chain_tips_1 = __importDefault(require("../api/chain-tips"));
const blocks_1 = __importDefault(require("../api/blocks"));
const BlocksAuditsRepository_1 = __importDefault(require("./BlocksAuditsRepository"));
const transaction_utils_1 = __importDefault(require("../api/transaction-utils"));
const bitcoin_script_1 = require("../utils/bitcoin-script");
const pools_updater_1 = __importDefault(require("../tasks/pools-updater"));
const OrdpoolBlocksRepository_1 = __importStar(require("../repositories/OrdpoolBlocksRepository"));
const BLOCK_DB_FIELDS = `
  blocks.index_version AS indexVersion,
  blocks.hash AS id,
  blocks.height,
  blocks.version,
  UNIX_TIMESTAMP(blocks.blockTimestamp) AS timestamp,
  blocks.bits,
  blocks.nonce,
  blocks.difficulty,
  blocks.merkle_root,
  blocks.tx_count,
  blocks.size,
  blocks.weight,
  blocks.previous_block_hash AS previousblockhash,
  UNIX_TIMESTAMP(blocks.median_timestamp) AS mediantime,
  blocks.fees AS totalFees,
  blocks.median_fee AS medianFee,
  blocks.fee_span AS feeRange,
  blocks.reward,
  pools.unique_id AS poolId,
  pools.name AS poolName,
  pools.slug AS poolSlug,
  blocks.avg_fee AS avgFee,
  blocks.avg_fee_rate AS avgFeeRate,
  blocks.coinbase_raw AS coinbaseRaw,
  blocks.coinbase_address AS coinbaseAddress,
  blocks.coinbase_addresses AS coinbaseAddresses,
  blocks.coinbase_signature AS coinbaseSignature,
  blocks.coinbase_signature_ascii AS coinbaseSignatureAscii,
  blocks.avg_tx_size AS avgTxSize,
  blocks.total_inputs AS totalInputs,
  blocks.total_outputs AS totalOutputs,
  blocks.total_output_amt AS totalOutputAmt,
  blocks.median_fee_amt AS medianFeeAmt,
  blocks.fee_percentiles AS feePercentiles,
  blocks.segwit_total_txs AS segwitTotalTxs,
  blocks.segwit_total_size AS segwitTotalSize,
  blocks.segwit_total_weight AS segwitTotalWeight,
  blocks.header,
  blocks.utxoset_change AS utxoSetChange,
  blocks.utxoset_size AS utxoSetSize,
  blocks.total_input_amt AS totalInputAmt,
  UNIX_TIMESTAMP(blocks.first_seen) AS firstSeen,
  blocks.stale

  , ${OrdpoolBlocksRepository_1.ORDPOOL_BLOCK_DB_FIELDS}`;
class BlocksRepository {
    static version = 1;
    /**
     * Save indexed block data in the database
     * @asyncSafe
     */
    async $saveBlockInDatabase(block) {
        const truncatedCoinbaseSignature = block?.extras?.coinbaseSignature?.substring(0, 500);
        const truncatedCoinbaseSignatureAscii = block?.extras?.coinbaseSignatureAscii?.substring(0, 500);
        // HACK -- Ordpool Stats
        // storing ordpool stats before storing to the `blocks` table, ER_DUP_ENTRY could occur, but that would also skip our code
        await OrdpoolBlocksRepository_1.default.saveBlockOrdpoolStatsInDatabase(block);
        try {
            const query = `INSERT INTO blocks(
        height,             hash,                     blockTimestamp,    size,
        weight,             tx_count,                 coinbase_raw,      difficulty,
        pool_id,            fees,                     fee_span,          median_fee,
        reward,             version,                  bits,              nonce,
        merkle_root,        previous_block_hash,      avg_fee,           avg_fee_rate,
        median_timestamp,   header,                   coinbase_address,  coinbase_addresses,
        coinbase_signature, utxoset_size,             utxoset_change,    avg_tx_size,
        total_inputs,       total_outputs,            total_input_amt,   total_output_amt,
        fee_percentiles,    segwit_total_txs,         segwit_total_size, segwit_total_weight,
        median_fee_amt,     coinbase_signature_ascii, definition_hash,   index_version,
        stale,              first_seen
      ) VALUE (
        ?, ?, FROM_UNIXTIME(?), ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        FROM_UNIXTIME(?), ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, FROM_UNIXTIME(?)
      )`;
            const poolDbId = await PoolsRepository_1.default.$getPoolByUniqueId(block.extras.pool.id);
            if (!poolDbId) {
                throw Error(`Could not find a mining pool with the unique_id = ${block.extras.pool.id}. This error should never be printed.`);
            }
            const params = [
                block.height,
                block.id,
                block.timestamp,
                block.size,
                block.weight,
                block.tx_count,
                block.extras.coinbaseRaw,
                block.difficulty,
                poolDbId.id,
                block.extras.totalFees,
                JSON.stringify(block.extras.feeRange),
                block.extras.medianFee,
                block.extras.reward,
                block.version,
                block.bits,
                block.nonce,
                block.merkle_root,
                block.previousblockhash,
                block.extras.avgFee,
                block.extras.avgFeeRate,
                block.mediantime,
                block.extras.header,
                block.extras.coinbaseAddress,
                block.extras.coinbaseAddresses ? JSON.stringify(block.extras.coinbaseAddresses) : null,
                truncatedCoinbaseSignature,
                block.extras.utxoSetSize,
                block.extras.utxoSetChange,
                block.extras.avgTxSize,
                block.extras.totalInputs,
                block.extras.totalOutputs,
                block.extras.totalInputAmt,
                block.extras.totalOutputAmt,
                block.extras.feePercentiles ? JSON.stringify(block.extras.feePercentiles) : null,
                block.extras.segwitTotalTxs,
                block.extras.segwitTotalSize,
                block.extras.segwitTotalWeight,
                block.extras.medianFeeAmt,
                truncatedCoinbaseSignatureAscii,
                pools_updater_1.default.currentSha,
                BlocksRepository.version,
                (block.stale ? 1 : 0),
                block.extras.firstSeen === null ? 1 : block.extras.firstSeen // Sentinel value 1 indicates that we could not find first seen time
            ];
            await database_1.default.query(query, params, 'silent');
        }
        catch (e) {
            if (e.errno === 1062) { // ER_DUP_ENTRY - This scenario is possible upon node backend restart or if a stale block is reconnected
                if (!block.stale) {
                    logger_1.default.debug(`$saveBlockInDatabase() - Block ${block.height} has already been indexed, setting as canonical`, logger_1.default.tags.mining);
                    try {
                        await this.$setCanonicalBlockAtHeight(block.id, block.height);
                    }
                    catch (e) {
                        logger_1.default.err(`Cannot set canonical block at height ${block.height}. Reason: ` + (e instanceof Error ? e.message : e));
                    }
                }
                else {
                    logger_1.default.debug(`$saveBlockInDatabase() - Block ${block.height} has already been indexed, ignoring`, logger_1.default.tags.mining);
                }
            }
            else {
                logger_1.default.err('Cannot save indexed block into db. Reason: ' + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
                throw e;
            }
        }
    }
    /**
     * Save newly indexed data from core coinstatsindex
     *
     * @param utxoSetSize
     * @param totalInputAmt
     * @asyncSafe
     */
    async $updateCoinStatsIndexData(blockHash, utxoSetSize, totalInputAmt) {
        try {
            const query = `
        UPDATE blocks
        SET utxoset_size = ?, total_input_amt = ?
        WHERE hash = ?
      `;
            const params = [
                utxoSetSize,
                totalInputAmt,
                blockHash
            ];
            await database_1.default.query(query, params);
        }
        catch (e) {
            logger_1.default.err('Cannot update indexed block coinstatsindex. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Update missing fee amounts fields
     *
     * @param blockHash
     * @param feeAmtPercentiles
     * @param medianFeeAmt
     * @asyncSafe
     */
    async $updateFeeAmounts(blockHash, feeAmtPercentiles, medianFeeAmt) {
        try {
            const query = `
        UPDATE blocks
        SET fee_percentiles = ?, median_fee_amt = ?
        WHERE hash = ?
      `;
            const params = [
                JSON.stringify(feeAmtPercentiles),
                medianFeeAmt,
                blockHash
            ];
            await database_1.default.query(query, params);
        }
        catch (e) {
            logger_1.default.err(`Cannot update fee amounts for block ${blockHash}. Reason: ' + ${e instanceof Error ? e.message : e}`);
            throw e;
        }
    }
    /**
     * Get all block height that have not been indexed between [startHeight, endHeight]
     * @asyncSafe
     */
    async $getMissingBlocksBetweenHeights(startHeight, endHeight) {
        // Ensure startHeight is the lower value and endHeight is the higher value
        const minHeight = Math.min(startHeight, endHeight);
        const maxHeight = Math.max(startHeight, endHeight);
        if (minHeight === maxHeight) {
            return [];
        }
        try {
            const [rows] = await database_1.default.query(`
        SELECT height
        FROM blocks
        WHERE height >= ? AND height <= ? AND stale = 0
        ORDER BY height ASC;
      `, [minHeight, maxHeight]);
            const indexedBlockHeights = [];
            rows.forEach((row) => { indexedBlockHeights.push(row.height); });
            const seekedBlocks = Array.from(Array(maxHeight - minHeight + 1).keys(), n => n + minHeight);
            const missingBlocksHeights = seekedBlocks.filter(x => indexedBlockHeights.indexOf(x) === -1);
            return missingBlocksHeights;
        }
        catch (e) {
            logger_1.default.err('Cannot retrieve blocks list to index. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get empty blocks for one or all pools
     * @asyncSafe
     */
    async $countEmptyBlocks(poolId, interval = null) {
        interval = common_1.Common.getSqlInterval(interval);
        const params = [];
        let query = `SELECT count(height) as count, pools.id as poolId
      FROM blocks
      JOIN pools on pools.id = blocks.pool_id
      WHERE tx_count = 1 AND stale = 0`;
        if (poolId) {
            query += ` AND pool_id = ?`;
            params.push(poolId);
        }
        if (interval) {
            query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        query += ` GROUP by pools.id`;
        try {
            const [rows] = await database_1.default.query(query, params);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot count empty blocks. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Return most recent block height
     * @asyncSafe
     */
    async $mostRecentBlockHeight() {
        try {
            const [row] = await database_1.default.query('SELECT MAX(height) as maxHeight from blocks');
            return row[0]['maxHeight'];
        }
        catch (e) {
            logger_1.default.err(`Cannot count blocks for this pool (using offset). Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get blocks count for a period
     * @asyncSafe
     */
    async $blockCount(poolId, interval = null) {
        interval = common_1.Common.getSqlInterval(interval);
        const params = [];
        let query = `SELECT count(height) as blockCount
      FROM blocks 
      WHERE stale = 0`;
        if (poolId) {
            query += ` AND pool_id = ?`;
            params.push(poolId);
        }
        if (interval) {
            query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        try {
            const [rows] = await database_1.default.query(query, params);
            return rows[0].blockCount;
        }
        catch (e) {
            logger_1.default.err(`Cannot count blocks for this pool (using offset). Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get blocks count between two dates
     * @param poolId
     * @param from - The oldest timestamp
     * @param to - The newest timestamp
     * @returns
     * @asyncSafe
     */
    async $blockCountBetweenTimestamp(poolId, from, to) {
        const params = [];
        let query = `SELECT
      count(height) as blockCount,
      max(height) as lastBlockHeight
      FROM blocks
      WHERE stale = 0`;
        if (poolId) {
            query += ` AND pool_id = ?`;
            params.push(poolId);
        }
        query += ` AND blockTimestamp BETWEEN FROM_UNIXTIME('${from}') AND FROM_UNIXTIME('${to}')`;
        try {
            const [rows] = await database_1.default.query(query, params);
            return rows[0];
        }
        catch (e) {
            logger_1.default.err(`Cannot count blocks for this pool (using timestamps). Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get blocks count for a period
     * @asyncSafe
     */
    async $blockCountBetweenHeight(startHeight, endHeight) {
        const params = [];
        const query = `SELECT count(height) as blockCount
      FROM blocks
      WHERE height <= ${startHeight} AND height >= ${endHeight} AND stale = 0`;
        try {
            const [rows] = await database_1.default.query(query, params);
            return rows[0].blockCount;
        }
        catch (e) {
            logger_1.default.err(`Cannot count blocks for this pool (using offset). Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get average block health for all blocks for a single pool
     * @asyncSafe
     */
    async $getAvgBlockHealthPerPoolId(poolId) {
        const params = [];
        const query = `
      SELECT AVG(blocks_audits.match_rate) AS avg_match_rate
      FROM blocks
      JOIN blocks_audits ON blocks.height = blocks_audits.height
      WHERE blocks.pool_id = ? AND stale = 0
    `;
        params.push(poolId);
        try {
            const [rows] = await database_1.default.query(query, params);
            if (!rows[0] || rows[0].avg_match_rate == null) {
                return null;
            }
            return Math.round(rows[0].avg_match_rate * 100) / 100;
        }
        catch (e) {
            logger_1.default.err(`Cannot get average block health for pool id ${poolId}. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get average block health for all blocks for a single pool
     * @asyncSafe
     */
    async $getTotalRewardForPoolId(poolId) {
        const params = [];
        const query = `
      SELECT sum(reward) as total_reward
      FROM blocks
      WHERE blocks.pool_id = ? AND stale = 0
    `;
        params.push(poolId);
        try {
            const [rows] = await database_1.default.query(query, params);
            if (!rows[0] || !rows[0].total_reward) {
                return 0;
            }
            return rows[0].total_reward;
        }
        catch (e) {
            logger_1.default.err(`Cannot get total reward for pool id ${poolId}. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the oldest indexed block
     * @asyncSafe
     */
    async $oldestBlockTimestamp() {
        const query = `SELECT UNIX_TIMESTAMP(blockTimestamp) as blockTimestamp
      FROM blocks
      WHERE stale = 0
      ORDER BY height
      LIMIT 1;`;
        try {
            const [rows] = await database_1.default.query(query);
            if (rows.length <= 0) {
                return -1;
            }
            return rows[0].blockTimestamp;
        }
        catch (e) {
            logger_1.default.err('Cannot get oldest indexed block timestamp. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get blocks mined by a specific mining pool
     * @asyncSafe
     */
    async $getBlocksByPool(slug, startHeight) {
        const pool = await PoolsRepository_1.default.$getPool(slug);
        if (!pool) {
            throw new Error('This mining pool does not exist');
        }
        const params = [];
        let query = `
      SELECT ${BLOCK_DB_FIELDS}
      FROM blocks
      JOIN pools ON blocks.pool_id = pools.id

      -- HACK -- Ordpool Stats
      LEFT JOIN ordpool_stats ON blocks.hash = ordpool_stats.hash

      -- HACK -- Ordpool Stats Mint Activity Tables
      LEFT JOIN ordpool_stats_rune_mint    rune_mint    ON rune_mint.hash  = blocks.hash
      LEFT JOIN ordpool_stats_brc20_mint   brc20_mint   ON brc20_mint.hash = blocks.hash
      LEFT JOIN ordpool_stats_src20_mint   src20_mint   ON src20_mint.hash = blocks.hash
      LEFT JOIN ordpool_stats_cat21_mint   cat21_mint   ON cat21_mint.hash = blocks.hash

      -- HACK -- Ordpool Stats Etch/Deploy Tables
      LEFT JOIN ordpool_stats_rune_etch    rune_etch    ON rune_etch.hash    = blocks.hash
      LEFT JOIN ordpool_stats_brc20_deploy brc20_deploy ON brc20_deploy.hash = blocks.hash
      LEFT JOIN ordpool_stats_src20_deploy src20_deploy ON src20_deploy.hash = blocks.hash

      WHERE pool_id = ? AND stale = 0`;
        params.push(pool.id);
        if (startHeight !== undefined) {
            query += ` AND height < ?`;
            params.push(startHeight);
        }
        query += ` GROUP BY blocks.hash -- HACK: combine ordpool activity rows
      ORDER BY height DESC
      LIMIT 100`;
        try {
            const [rows] = await database_1.default.query(query, params);
            const blocks = [];
            for (const block of rows) {
                blocks.push(await this.formatDbBlockIntoExtendedBlock(block));
            }
            return blocks;
        }
        catch (e) {
            logger_1.default.err('Cannot get blocks for this pool. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get one block by height
     * @asyncSafe
     */
    async $getBlockByHeight(height) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT ${BLOCK_DB_FIELDS}
        FROM blocks
        JOIN pools ON blocks.pool_id = pools.id

        -- HACK -- Ordpool Stats
        LEFT JOIN ordpool_stats ON blocks.hash = ordpool_stats.hash

        -- HACK -- Ordpool Stats Mint Activity Tables
        LEFT JOIN ordpool_stats_rune_mint    rune_mint    ON rune_mint.hash  = blocks.hash
        LEFT JOIN ordpool_stats_brc20_mint   brc20_mint   ON brc20_mint.hash = blocks.hash
        LEFT JOIN ordpool_stats_src20_mint   src20_mint   ON src20_mint.hash = blocks.hash
        LEFT JOIN ordpool_stats_cat21_mint   cat21_mint   ON cat21_mint.hash = blocks.hash

        -- HACK -- Ordpool Stats Etch/Deploy Tables
        LEFT JOIN ordpool_stats_rune_etch    rune_etch    ON rune_etch.hash    = blocks.hash
        LEFT JOIN ordpool_stats_brc20_deploy brc20_deploy ON brc20_deploy.hash = blocks.hash
        LEFT JOIN ordpool_stats_src20_deploy src20_deploy ON src20_deploy.hash = blocks.hash

        WHERE blocks.height = ? AND stale = 0
        GROUP BY blocks.hash -- HACK: combine ordpool activity rows`, [height]);
            if (rows.length <= 0) {
                return null;
            }
            return await this.formatDbBlockIntoExtendedBlock(rows[0]);
        }
        catch (e) {
            logger_1.default.err(`Cannot get indexed block ${height}. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get one block by hash
     */
    async $getBlockByHash(hash) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT ${BLOCK_DB_FIELDS}
        FROM blocks
        JOIN pools ON blocks.pool_id = pools.id

        -- HACK -- Ordpool Stats
        LEFT JOIN ordpool_stats ON blocks.hash = ordpool_stats.hash

        -- HACK -- Ordpool Stats Mint Activity Tables
        LEFT JOIN ordpool_stats_rune_mint    rune_mint    ON rune_mint.hash  = blocks.hash
        LEFT JOIN ordpool_stats_brc20_mint   brc20_mint   ON brc20_mint.hash = blocks.hash
        LEFT JOIN ordpool_stats_src20_mint   src20_mint   ON src20_mint.hash = blocks.hash
        LEFT JOIN ordpool_stats_cat21_mint   cat21_mint   ON cat21_mint.hash = blocks.hash

        -- HACK -- Ordpool Stats Etch/Deploy Tables
        LEFT JOIN ordpool_stats_rune_etch    rune_etch    ON rune_etch.hash    = blocks.hash
        LEFT JOIN ordpool_stats_brc20_deploy brc20_deploy ON brc20_deploy.hash = blocks.hash
        LEFT JOIN ordpool_stats_src20_deploy src20_deploy ON src20_deploy.hash = blocks.hash

        WHERE blocks.hash = ?
        GROUP BY blocks.hash -- HACK: combine ordpool activity rows`, [hash]);
            if (rows.length <= 0) {
                return null;
            }
            return await this.formatDbBlockIntoExtendedBlock(rows[0]);
        }
        catch (e) {
            logger_1.default.err(`Cannot get indexed block ${hash}. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Return blocks difficulty
     * @asyncSafe
     */
    async $getBlocksDifficulty() {
        try {
            const [rows] = await database_1.default.query(`SELECT UNIX_TIMESTAMP(blockTimestamp) as time, height, difficulty, bits FROM blocks WHERE stale = 0 ORDER BY height ASC`);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot get blocks difficulty list from the db. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the first block at or directly after a given timestamp
     * @param timestamp number unix time in seconds
     * @returns The height and timestamp of a block (timestamp might vary from given timestamp)
     * @asyncSafe
     */
    async $getBlockHeightFromTimestamp(timestamp) {
        try {
            // Get first block at or after the given timestamp
            const query = `SELECT height, hash, blockTimestamp as timestamp FROM blocks
        WHERE blockTimestamp <= FROM_UNIXTIME(?) AND stale = 0
        ORDER BY blockTimestamp DESC
        LIMIT 1`;
            const params = [timestamp];
            const [rows] = await database_1.default.query(query, params);
            if (rows.length === 0) {
                throw new Error(`No block was found before timestamp ${timestamp}`);
            }
            return rows[0];
        }
        catch (e) {
            logger_1.default.err('Cannot get block height from timestamp from the db. Reason: ' +
                (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get general block stats
     * @asyncSafe
     */
    async $getBlockStats(blockCount) {
        try {
            // We need to use a subquery
            const query = `
        SELECT MIN(height) as startBlock, MAX(height) as endBlock, SUM(reward) as totalReward, SUM(fees) as totalFee, SUM(tx_count) as totalTx
        FROM
          (SELECT height, reward, fees, tx_count FROM blocks
          WHERE stale = 0
          ORDER by height DESC
          LIMIT ?) as sub`;
            const [rows] = await database_1.default.query(query, [blockCount]);
            return rows[0];
        }
        catch (e) {
            logger_1.default.err('Cannot generate reward stats. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Check if the canonical chain of blocks is valid and fix it if needed
     * @asyncSafe
     */
    async $validateChain() {
        try {
            const start = new Date().getTime();
            const tip = await bitcoin_api_factory_1.default.$getBlockHashTip();
            let firstBadBlockHeight = null;
            let firstBadBlockTimestamp = null;
            const [blocks] = await database_1.default.query(`
        SELECT
          height,
          hash,
          previous_block_hash,
          UNIX_TIMESTAMP(blockTimestamp) AS timestamp,
          stale
        FROM blocks
        ORDER BY height DESC
      `);
            if (!blocks || blocks.length === 0) {
                throw new Error('Cannot validate chain: no indexed blocks in database');
            }
            const blocksByHash = {};
            const blocksByHeight = {};
            let minHeight = Infinity;
            for (const block of blocks) {
                blocksByHash[block.hash] = block;
                if (!blocksByHeight[block.height]) {
                    blocksByHeight[block.height] = [block];
                }
                else {
                    blocksByHeight[block.height].push(block);
                }
                minHeight = block.height;
            }
            // ensure that indexed blocks are correctly classified as stale or canonical
            // iterate back to genesis, resetting canonical status where necessary
            let hash = tip;
            const indexedTip = blocksByHash[hash];
            const tipHeight = indexedTip?.height ?? (await bitcoin_api_factory_1.default.$getBlock(hash))?.height;
            if (typeof tipHeight !== 'number') {
                throw new Error(`Cannot validate chain: could not resolve tip block height for ${hash} from index or node`);
            }
            // stop at the last canonical block we're supposed to have indexed already
            let lastIndexedBlockHeight = minHeight;
            const indexedBlockAmount = Math.min(config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT, tipHeight);
            if (indexedBlockAmount > 0) {
                lastIndexedBlockHeight = Math.max(0, tipHeight - indexedBlockAmount + 1);
            }
            for (let height = tipHeight; height > lastIndexedBlockHeight; height--) {
                const block = blocksByHash[hash];
                if (!block) {
                    // block hasn't been indexed
                    // mark any other blocks at this height as stale
                    if (blocksByHeight[height]?.length > 1) {
                        await this.$setCanonicalBlockAtHeight(null, height);
                    }
                }
                else if (block.stale) {
                    // block is marked stale, but shouldn't be
                    await this.$setCanonicalBlockAtHeight(block.hash, height);
                    firstBadBlockHeight = height;
                    firstBadBlockTimestamp = block.timestamp;
                }
                hash = block?.previous_block_hash;
                if (!hash) {
                    if (height < minHeight) {
                        // we haven't indexed anything below this height anyway
                        height = -1;
                        break;
                    }
                    else {
                        logger_1.default.info('Some blocks are not indexed, looking up prevhashes directly for chain validation');
                        hash = await bitcoin_api_factory_1.default.$getBlockHash(height - 1);
                    }
                }
            }
            if (firstBadBlockHeight != null) {
                logger_1.default.warn(`Chain divergence detected at block ${firstBadBlockHeight}`);
                if (firstBadBlockTimestamp != null) {
                    await HashratesRepository_1.default.$deleteHashratesFromTimestamp(firstBadBlockTimestamp - 604800);
                }
                await DifficultyAdjustmentsRepository_1.default.$deleteAdjustementsFromHeight(firstBadBlockHeight);
                return false;
            }
            logger_1.default.debug(`validated best chain of ${tipHeight} blocks in ${new Date().getTime() - start} ms`);
            return true;
        }
        catch (e) {
            logger_1.default.err('Cannot validate chain of block hash. Reason: ' + (e instanceof Error ? e.message : e));
            return true; // Don't do anything if there is a db error
        }
    }
    /**
     * Get the historical averaged block fees
     * @asyncSafe
     */
    async $getHistoricalBlockFees(div, interval, timespan) {
        try {
            let query = `SELECT
        CAST(AVG(blocks.height) as INT) as avgHeight,
        CAST(AVG(UNIX_TIMESTAMP(blockTimestamp)) as INT) as timestamp,
        CAST(AVG(fees) as INT) as avgFees,
        prices.USD
        FROM blocks
        JOIN blocks_prices on blocks_prices.height = blocks.height
        JOIN prices on prices.id = blocks_prices.price_id
        WHERE stale = 0
      `;
            if (interval !== null) {
                query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
            }
            else if (timespan) {
                query += ` AND blockTimestamp BETWEEN FROM_UNIXTIME(${timespan.from}) AND FROM_UNIXTIME(${timespan.to})`;
            }
            query += ` GROUP BY UNIX_TIMESTAMP(blockTimestamp) DIV ${div}`;
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block fees history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the historical averaged block rewards
     * @asyncSafe
     */
    async $getHistoricalBlockRewards(div, interval) {
        try {
            let query = `SELECT
        CAST(AVG(blocks.height) as INT) as avgHeight,
        CAST(AVG(UNIX_TIMESTAMP(blockTimestamp)) as INT) as timestamp,
        CAST(AVG(reward) as INT) as avgRewards,
        prices.USD
        FROM blocks
        JOIN blocks_prices on blocks_prices.height = blocks.height
        JOIN prices on prices.id = blocks_prices.price_id
        WHERE stale = 0
      `;
            if (interval !== null) {
                query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
            }
            query += ` GROUP BY UNIX_TIMESTAMP(blockTimestamp) DIV ${div}`;
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block rewards history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the historical averaged block fee rate percentiles
     * @asyncSafe
     */
    async $getHistoricalBlockFeeRates(div, interval) {
        try {
            let query = `SELECT
        CAST(AVG(height) as INT) as avgHeight,
        CAST(AVG(UNIX_TIMESTAMP(blockTimestamp)) as INT) as timestamp,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[0]')) as INT) as avgFee_0,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[1]')) as INT) as avgFee_10,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[2]')) as INT) as avgFee_25,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[3]')) as INT) as avgFee_50,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[4]')) as INT) as avgFee_75,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[5]')) as INT) as avgFee_90,
        CAST(AVG(JSON_EXTRACT(fee_span, '$[6]')) as INT) as avgFee_100
      FROM blocks
      WHERE stale = 0`;
            if (interval !== null) {
                query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
            }
            query += ` GROUP BY UNIX_TIMESTAMP(blockTimestamp) DIV ${div}`;
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block fee rates history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the historical averaged block sizes
     * @asyncSafe
     */
    async $getHistoricalBlockSizes(div, interval) {
        try {
            let query = `SELECT
        CAST(AVG(height) as INT) as avgHeight,
        CAST(AVG(UNIX_TIMESTAMP(blockTimestamp)) as INT) as timestamp,
        CAST(AVG(size) as INT) as avgSize
      FROM blocks
      WHERE stale = 0`;
            if (interval !== null) {
                query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
            }
            query += ` GROUP BY UNIX_TIMESTAMP(blockTimestamp) DIV ${div}`;
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block size and weight history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get the historical averaged block weights
     * @asyncSafe
     */
    async $getHistoricalBlockWeights(div, interval) {
        try {
            let query = `SELECT
        CAST(AVG(height) as INT) as avgHeight,
        CAST(AVG(UNIX_TIMESTAMP(blockTimestamp)) as INT) as timestamp,
        CAST(AVG(weight) as INT) as avgWeight
      FROM blocks
      WHERE stale = 0`;
            if (interval !== null) {
                query += ` AND blockTimestamp BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
            }
            query += ` GROUP BY UNIX_TIMESTAMP(blockTimestamp) DIV ${div}`;
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block size and weight history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get a list of blocks that have been indexed
     * (includes stale blocks)
     * @asyncSafe
     */
    async $getIndexedBlocks() {
        try {
            const [rows] = await database_1.default.query(`SELECT height, hash, stale FROM blocks ORDER BY height DESC`);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot generate block size and weight history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get a list of blocks that have not had CPFP data indexed
     * @asyncSafe
     */
    async $getCPFPUnindexedBlocks() {
        try {
            const blockchainInfo = await bitcoin_client_1.default.getBlockchainInfo();
            const currentBlockHeight = blockchainInfo.blocks;
            let indexingBlockAmount = Math.min(config_1.default.MEMPOOL.INDEXING_BLOCKS_AMOUNT, currentBlockHeight);
            if (indexingBlockAmount <= -1) {
                indexingBlockAmount = currentBlockHeight + 1;
            }
            const minHeight = Math.max(0, currentBlockHeight - indexingBlockAmount + 1);
            const [rows] = await database_1.default.query(`
        SELECT height
        FROM compact_cpfp_clusters
        WHERE height <= ? AND height >= ?
        GROUP BY height
        ORDER BY height DESC;
      `, [currentBlockHeight, minHeight]);
            const indexedHeights = {};
            rows.forEach((row) => { indexedHeights[row.height] = true; });
            const allHeights = Array.from(Array(currentBlockHeight - minHeight + 1).keys(), n => n + minHeight).reverse();
            const unindexedHeights = allHeights.filter(x => !indexedHeights[x]);
            return unindexedHeights;
        }
        catch (e) {
            logger_1.default.err('Cannot fetch CPFP unindexed blocks. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Return the oldest block  from a consecutive chain of block from the most recent one
     * @asyncSafe
     */
    async $getOldestConsecutiveBlock() {
        try {
            const [rows] = await database_1.default.query(`SELECT height, UNIX_TIMESTAMP(blockTimestamp) as timestamp, difficulty, bits FROM blocks WHERE stale = 0 ORDER BY height DESC`);
            for (let i = 0; i < rows.length - 1; ++i) {
                if (rows[i].height - rows[i + 1].height > 1) {
                    return rows[i];
                }
            }
            return rows[rows.length - 1];
        }
        catch (e) {
            logger_1.default.err('Cannot generate block size and weight history. Reason: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Get all blocks which have not be linked to a price yet
     * @asyncSafe
     */
    async $getBlocksWithoutPrice() {
        try {
            const [rows] = await database_1.default.query(`
        SELECT UNIX_TIMESTAMP(blocks.blockTimestamp) as timestamp, blocks.height
        FROM blocks
        LEFT JOIN blocks_prices ON blocks.height = blocks_prices.height
        LEFT JOIN prices ON blocks_prices.price_id = prices.id
        WHERE blocks_prices.height IS NULL
          OR prices.id IS NULL
        ORDER BY blocks.height
      `);
            return rows;
        }
        catch (e) {
            logger_1.default.err('Cannot get blocks height and timestamp from the db. Reason: ' + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    /**
     * Save block price by batch
     * @asyncSafe
     */
    async $saveBlockPrices(blockPrices) {
        try {
            let query = `INSERT INTO blocks_prices(height, price_id) VALUES`;
            for (const price of blockPrices) {
                query += ` (${price.height}, ${price.priceId}),`;
            }
            query = query.slice(0, -1);
            query += ` ON DUPLICATE KEY UPDATE price_id = VALUES(price_id)`;
            await database_1.default.query(query);
        }
        catch (e) {
            if (e.errno === 1062) { // ER_DUP_ENTRY - This scenario is possible upon node backend restart
                logger_1.default.debug(`Cannot save blocks prices for blocks [${blockPrices[0].height} to ${blockPrices[blockPrices.length - 1].height}] because it has already been indexed, ignoring`);
            }
            else {
                logger_1.default.err(`Cannot save blocks prices for blocks [${blockPrices[0].height} to ${blockPrices[blockPrices.length - 1].height}] into db. Reason: ` + (e instanceof Error ? e.message : e));
            }
        }
    }
    /**
     * Get all indexed blocsk with missing coinstatsindex data
     * @asyncSafe
     */
    async $getBlocksMissingCoinStatsIndex(maxHeight, minHeight) {
        try {
            const [blocks] = await database_1.default.query(`
        SELECT height, hash
        FROM blocks
        WHERE height >= ${minHeight} AND height <= ${maxHeight} AND
          (utxoset_size IS NULL OR total_input_amt IS NULL) AND stale = 0
      `);
            return blocks;
        }
        catch (e) {
            logger_1.default.err(`Cannot get blocks with missing coinstatsindex. Reason: ` + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    /**
     * Get all indexed blocks with missing coinbase addresses
     * (includes stale blocks)
     * @asyncSafe
     */
    async $getBlocksWithoutCoinbaseAddresses() {
        try {
            const [blocks] = await database_1.default.query(`
        SELECT height, hash, coinbase_addresses
        FROM blocks
        WHERE coinbase_addresses IS NULL AND
          coinbase_address IS NOT NULL
        ORDER BY height DESC
      `);
            return blocks;
        }
        catch (e) {
            logger_1.default.err(`Cannot get blocks with missing coinbase addresses. Reason: ` + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    /**
     * Save indexed median fee to avoid recomputing it later
     *
     * @param id
     * @param feePercentiles
     * @asyncSafe
     */
    async $saveFeePercentilesForBlockId(id, feePercentiles) {
        try {
            await database_1.default.query(`
        UPDATE blocks SET fee_percentiles = ?, median_fee_amt = ?
        WHERE hash = ?`, [JSON.stringify(feePercentiles), feePercentiles[3], id]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update block fee_percentiles. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Save indexed effective fee statistics
     *
     * @param id
     * @param feeStats
     * @asyncSafe
     */
    async $saveEffectiveFeeStats(id, feeStats) {
        try {
            await database_1.default.query(`
        UPDATE blocks SET median_fee = ?, fee_span = ?
        WHERE hash = ?`, [feeStats.medianFee, JSON.stringify(feeStats.feeRange), id]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update block fee stats. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Save coinbase addresses
     *
     * @param id
     * @param addresses
     * @asyncSafe
     */
    async $saveCoinbaseAddresses(id, addresses) {
        try {
            await database_1.default.query(`
        UPDATE blocks SET coinbase_addresses = ?
        WHERE hash = ?`, [JSON.stringify(addresses), id]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update block coinbase addresses. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Save pool
     *
     * @param id
     * @param poolId
     * @asyncSafe
     */
    async $savePool(id, poolId) {
        try {
            await database_1.default.query(`
        UPDATE blocks SET pool_id = ?, definition_hash = ?
        WHERE hash = ?`, [poolId, pools_updater_1.default.currentSha, id]);
        }
        catch (e) {
            logger_1.default.err(`Cannot update block pool. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Save block first seen times
     *
     * @param results
     * @asyncSafe
     */
    async $saveFirstSeenTimes(results) {
        if (!results.length) {
            return;
        }
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < results.length; i += CHUNK_SIZE) {
            const chunk = results.slice(i, i + CHUNK_SIZE);
            const params = [];
            const selects = chunk.map(() => 'SELECT ? AS hash, FROM_UNIXTIME(?) AS first_seen').join(' UNION ALL ');
            for (const { hash, firstSeen } of chunk) {
                params.push(hash, firstSeen === null ? 1 : firstSeen); // Sentinel value 1 indicates that we could not find first seen time
            }
            const query = `
        UPDATE blocks AS b
        JOIN (
          ${selects}
        ) AS updates ON updates.hash = b.hash
        SET b.first_seen = updates.first_seen
      `;
            try {
                await database_1.default.query(query, params);
            }
            catch (e) {
                logger_1.default.err(`Cannot batch update block first seen times. Reason: ` + (e instanceof Error ? e.message : e));
                throw e;
            }
        }
    }
    /**
     * Get all blocks which do not have a first seen time yet
     *
     * @param includeAlreadyTried Include blocks we have already tried to fetch first seen time for, identified by sentinel value 1
     */
    async $getBlocksWithoutFirstSeen(includeAlreadyTried = false) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT hash, UNIX_TIMESTAMP(blockTimestamp) as timestamp
        FROM blocks
        WHERE first_seen IS NULL
        ${includeAlreadyTried ? ' OR first_seen = FROM_UNIXTIME(1)' : ''}
      `);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch block first seen from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Change which block at a height belongs to the canonical chain
     *
     * @param hash
     * @param height
     */
    async $setCanonicalBlockAtHeight(hash, height) {
        try {
            // do this first, so that we fail if the block hasn't actually been indexed yet
            if (hash) {
                await database_1.default.query(`
          UPDATE blocks SET stale = 0
          WHERE hash = ?`, [hash]);
            }
            // all other blocks at this height must be stale
            await database_1.default.query(`
        UPDATE blocks SET stale = 1
        WHERE height = ? AND hash != ?`, [height, hash ?? '']);
        }
        catch (e) {
            logger_1.default.err(`Cannot set canonical block at height. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /**
     * Convert a mysql row block into a BlockExtended. Note that you
     * must provide the correct field into dbBlk object param
     *
     * @param dbBlk
     * @asyncUnsafe
     */
    async formatDbBlockIntoExtendedBlock(dbBlk) {
        const blk = {};
        const extras = {};
        // IEsploraApi.Block
        blk.id = dbBlk.id;
        blk.height = dbBlk.height;
        blk.version = dbBlk.version;
        blk.timestamp = dbBlk.timestamp;
        blk.bits = dbBlk.bits;
        blk.nonce = dbBlk.nonce;
        blk.difficulty = dbBlk.difficulty;
        blk.merkle_root = dbBlk.merkle_root;
        blk.tx_count = dbBlk.tx_count;
        blk.size = dbBlk.size;
        blk.weight = dbBlk.weight;
        blk.previousblockhash = dbBlk.previousblockhash;
        blk.mediantime = dbBlk.mediantime;
        blk.indexVersion = dbBlk.index_version;
        // BlockExtension
        extras.totalFees = dbBlk.totalFees;
        extras.medianFee = dbBlk.medianFee;
        extras.feeRange = JSON.parse(dbBlk.feeRange);
        extras.reward = dbBlk.reward;
        extras.pool = {
            id: dbBlk.poolId,
            name: dbBlk.poolName,
            slug: dbBlk.poolSlug,
            minerNames: null,
        };
        extras.avgFee = dbBlk.avgFee;
        extras.avgFeeRate = dbBlk.avgFeeRate;
        extras.coinbaseRaw = dbBlk.coinbaseRaw;
        extras.coinbaseAddress = dbBlk.coinbaseAddress;
        extras.coinbaseAddresses = dbBlk.coinbaseAddresses ? JSON.parse(dbBlk.coinbaseAddresses) : [];
        extras.coinbaseSignature = dbBlk.coinbaseSignature;
        extras.coinbaseSignatureAscii = dbBlk.coinbaseSignatureAscii;
        extras.avgTxSize = dbBlk.avgTxSize;
        extras.totalInputs = dbBlk.totalInputs;
        extras.totalOutputs = dbBlk.totalOutputs;
        extras.totalOutputAmt = dbBlk.totalOutputAmt;
        extras.medianFeeAmt = dbBlk.medianFeeAmt;
        extras.feePercentiles = JSON.parse(dbBlk.feePercentiles);
        extras.segwitTotalTxs = dbBlk.segwitTotalTxs;
        extras.segwitTotalSize = dbBlk.segwitTotalSize;
        extras.segwitTotalWeight = dbBlk.segwitTotalWeight;
        extras.header = dbBlk.header,
            extras.utxoSetChange = dbBlk.utxoSetChange;
        extras.utxoSetSize = dbBlk.utxoSetSize;
        extras.totalInputAmt = dbBlk.totalInputAmt;
        extras.virtualSize = dbBlk.weight / 4.0;
        extras.firstSeen = null;
        if (config_1.default.CORE_RPC.DEBUG_LOG_PATH) {
            const dbFirstSeen = parseFloat(dbBlk.firstSeen);
            if (dbFirstSeen > 1) { // Sentinel value 1 indicates that we could not find first seen time
                extras.firstSeen = dbFirstSeen;
            }
        }
        // Re-org can happen after indexing so we need to always get the
        // latest state from core
        extras.orphans = chain_tips_1.default.getOrphanedBlocksAtHeight(dbBlk.height);
        // Match rate is not part of the blocks table, but it is part of APIs so we must include it
        extras.matchRate = null;
        extras.expectedFees = null;
        extras.expectedWeight = null;
        if (config_1.default.MEMPOOL.AUDIT) {
            const auditScore = await BlocksAuditsRepository_1.default.$getBlockAuditScore(dbBlk.id);
            if (auditScore != null) {
                extras.matchRate = auditScore.matchRate;
                extras.expectedFees = auditScore.expectedFees;
                extras.expectedWeight = auditScore.expectedWeight;
            }
        }
        // If we're missing block summary related field, check if we can populate them on the fly now
        // This is for example triggered upon re-org
        if (common_1.Common.blocksSummariesIndexingEnabled() &&
            (extras.medianFeeAmt === null || extras.feePercentiles === null)) {
            extras.feePercentiles = await BlocksSummariesRepository_1.default.$getFeePercentilesByBlockId(dbBlk.id);
            if (extras.feePercentiles === null) {
                let summary;
                let summaryVersion = 0;
                if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
                    const txs = (await bitcoin_api_factory_1.default.$getTxsForBlock(dbBlk.id, dbBlk.stale)).map(tx => transaction_utils_1.default.extendTransaction(tx));
                    // HACK -- Ordpool: async
                    summary = await blocks_1.default.summarizeBlockTransactions(dbBlk.id, dbBlk.height, txs);
                    summaryVersion = 1;
                }
                else {
                    // Call Core RPC
                    const block = await bitcoin_client_1.default.getBlock(dbBlk.id, 2);
                    summary = blocks_1.default.summarizeBlock(block);
                }
                await BlocksSummariesRepository_1.default.$saveTransactions(dbBlk.height, dbBlk.id, summary.transactions, summaryVersion);
                extras.feePercentiles = await BlocksSummariesRepository_1.default.$getFeePercentilesByBlockId(dbBlk.id);
            }
            if (extras.feePercentiles !== null) {
                extras.medianFeeAmt = extras.feePercentiles[3];
                await this.$updateFeeAmounts(dbBlk.id, extras.feePercentiles, extras.medianFeeAmt);
            }
        }
        if (extras.pool.name === 'OCEAN') {
            extras.pool.minerNames = (0, bitcoin_script_1.parseDATUMTemplateCreator)(extras.coinbaseRaw);
        }
        // HACK -- Ordpool Stats
        extras.ordpoolStats = OrdpoolBlocksRepository_1.default.formatDbBlockIntoOrdpoolStats(dbBlk);
        blk.extras = extras;
        return blk;
    }
    // Execute reindexing tasks & lazy schema migrations
    async $migrateBlocks() {
        let blocksMigrated = 0;
        blocksMigrated = await this.$migrateBlocksToV1();
        if (blocksMigrated > 0) {
            // return early, run the next migration on the next indexing loop
            return blocksMigrated;
        }
        return 0;
    }
    // migration to fix median fee bug
    /** @asyncSafe */
    async $migrateBlocksToV1() {
        let blocksMigrated = 0;
        try {
            // median fee bug only affects mmre-than-half but less-than-completely full blocks
            const minWeight = config_1.default.MEMPOOL.BLOCK_WEIGHT_UNITS / 2 - (config_1.default.MEMPOOL.BLOCK_WEIGHT_UNITS / 800);
            const maxWeight = config_1.default.MEMPOOL.BLOCK_WEIGHT_UNITS - (config_1.default.MEMPOOL.BLOCK_WEIGHT_UNITS / 400);
            const [rows] = await database_1.default.query(`
        SELECT height, hash, index_version
        FROM blocks
        WHERE index_version < 1
          AND weight >= ?
          AND weight <= ?
        ORDER BY height DESC
      `, [minWeight, maxWeight]);
            const blocksToMigrate = rows.length;
            let timer = Date.now() / 1000;
            const startedAt = Date.now() / 1000;
            for (const row of rows) {
                // fetch block summary
                const transactions = await blocks_1.default.$getStrippedBlockTransactions(row.hash);
                // recalculate effective fee statistics using latest methodology
                const feeStats = common_1.Common.calcEffectiveFeeStatistics(transactions.map(tx => ({
                    weight: tx.vsize * 4,
                    effectiveFeePerVsize: tx.rate,
                    txid: tx.txid,
                    acceleration: tx.acc,
                })));
                // update block db
                await database_1.default.query(`
          UPDATE blocks SET index_version = 1, median_fee = ?, fee_span = ?
          WHERE hash = ?`, [feeStats.medianFee, JSON.stringify(feeStats.feeRange), row.hash]);
                const elapsedSeconds = (Date.now() / 1000) - timer;
                if (elapsedSeconds > 5) {
                    const runningFor = (Date.now() / 1000) - startedAt;
                    const blockPerSeconds = blocksMigrated / elapsedSeconds;
                    const progress = Math.round(blocksMigrated / blocksToMigrate * 10000) / 100;
                    logger_1.default.debug(`Migrating blocks to version 1 | ~${blockPerSeconds.toFixed(2)} blocks/sec | height: ${row.height} | total: ${blocksMigrated}/${blocksToMigrate} (${progress}%) | elapsed: ${runningFor.toFixed(2)} seconds`);
                    timer = Date.now() / 1000;
                }
                blocksMigrated++;
            }
            logger_1.default.notice(`Migrating blocks to version 1 completed: migrated ${blocksMigrated} blocks`);
        }
        catch (e) {
            logger_1.default.err(`Migrating blocks to version 1 failed. Trying again later. Reason: ${(e instanceof Error ? e.message : e)}`);
            throw e;
        }
        return blocksMigrated;
    }
}
exports.default = new BlocksRepository();
