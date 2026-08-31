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
const ordpool_parser_1 = require("ordpool-parser");
const config_1 = __importDefault(require("../../../config"));
const database_1 = __importDefault(require("../../../database"));
const logger_1 = __importDefault(require("../../../logger"));
const get_sql_interval_1 = require("./get-sql-interval");
const ordpool_stats_daily_1 = __importStar(require("./ordpool-stats-daily"));
class OrdpoolStatisticsApi {
    async getOrdpoolStatistics(type, interval, aggregation) {
        const firstInscriptionHeight = (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK);
        const sqlInterval = (0, get_sql_interval_1.getSqlInterval)(interval);
        // Historical day/week/month/year charts read the pre-aggregated daily rollup
        // (milliseconds) instead of re-scanning every block in the window (~27s).
        // block/hour over a long interval is coarsened to day -- block-level over a
        // year is tens of thousands of unreadable points anyway.
        const effectiveAggregation = this.coarsenAggregation(interval, aggregation);
        const useRollup = effectiveAggregation !== 'block' && effectiveAggregation !== 'hour';
        // Satellite-table charts (atomical-ops, counterparty-messages, ots) get the
        // same rollup treatment for day+ aggregation; short block/hour intervals stay
        // on the live per-block breakdown/total query.
        const satellite = ordpool_stats_daily_1.SATELLITE_ROLLUPS.find((c) => c.chartType === type);
        if (satellite) {
            const rollupSql = useRollup && await ordpool_stats_daily_1.default.isReady(satellite.rollupTable)
                ? (0, ordpool_stats_daily_1.getSatelliteRollupRead)(type, sqlInterval, effectiveAggregation)
                : null;
            if (rollupSql) {
                try {
                    const [rows] = await database_1.default.query(rollupSql);
                    return rows;
                }
                catch (error) {
                    logger_1.default.err(`Error executing satellite rollup query: ${error}`, 'Ordpool');
                    throw error;
                }
            }
            if (type === 'atomical-ops') {
                return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_atomical_op', 'sat.operation', 'operation');
            }
            if (type === 'counterparty-messages') {
                return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_counterparty', 'sat.message_type', 'messageType');
            }
            // ordpool_stats_ots only carries confirmed-by-block rows once the poller's
            // confirm step fills in blockhash/blockheight; pending rows (NULL blockhash)
            // are filtered by the INNER JOIN.
            return this.getSatelliteTotal(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_ots');
        }
        if (useRollup && await ordpool_stats_daily_1.default.isReady()) {
            return this.getFromRollup(type, sqlInterval, effectiveAggregation);
        }
        const query = `
      SELECT ${(0, ordpool_stats_daily_1.getLiveSelectClause)(type)}
      FROM blocks b
      LEFT JOIN ordpool_stats bos ON b.hash = bos.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      ${this.getGroupByClause(aggregation)}
      ORDER BY b.blockTimestamp DESC
    `;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (error) {
            logger_1.default.err(`Error executing query: ${error}`, 'Ordpool');
            throw error;
        }
    }
    /** Read a main (non-satellite) chart from the daily rollup: a GROUP BY over
     *  ~700 immutable daily rows, indexed, no temp-table scan over 100k+ blocks. */
    async getFromRollup(type, sqlInterval, aggregation) {
        const query = `
      SELECT ${(0, ordpool_stats_daily_1.getRollupSelectClause)(type)}
      FROM ordpool_stats_daily d
      WHERE d.day >= DATE_SUB(CURDATE(), INTERVAL ${sqlInterval})
      ${(0, ordpool_stats_daily_1.rollupGroupBy)(aggregation)}
      ORDER BY minTime DESC
    `;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (error) {
            logger_1.default.err(`Error executing rollup query: ${error}`, 'Ordpool');
            throw error;
        }
    }
    /** block/hour aggregation over a long interval produces thousands of
     *  unreadable points and a slow scan; coarsen to day past a small budget so
     *  those requests serve fast from the rollup instead. */
    coarsenAggregation(interval, aggregation) {
        if (aggregation !== 'block' && aggregation !== 'hour') {
            return aggregation;
        }
        const days = this.intervalToDays(interval);
        if (aggregation === 'block' && days > 2) {
            return 'day';
        }
        if (aggregation === 'hour' && days > 14) {
            return 'day';
        }
        return aggregation;
    }
    intervalToDays(interval) {
        const m = /^(\d+)([hwdmy])$/.exec(interval);
        if (!m) {
            return 0;
        }
        const n = parseInt(m[1], 10);
        switch (m[2]) {
            case 'h': return n / 24;
            case 'd': return n;
            case 'w': return n * 7;
            case 'm': return n * 30;
            case 'y': return n * 365;
            default: return 0;
        }
    }
    /** Single-series total per period from a satellite table (no discriminator
     *  column). Used by the `ots` chart -- one COUNT(*) per period. The
     *  satellite is joined on `sat.blockhash = b.hash`; rows whose blockhash
     *  is NULL (i.e. still pending, not yet confirmed) are filtered by the
     *  INNER JOIN. */
    async getSatelliteTotal(firstInscriptionHeight, sqlInterval, aggregation, satelliteTable) {
        const groupByTime = this.getGroupByClause(aggregation).replace(/^GROUP BY/, '');
        const query = `
      SELECT
        MIN(b.height) AS minHeight,
        MAX(b.height) AS maxHeight,
        MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
        MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime,
        COUNT(*) AS count
      FROM blocks b
      JOIN ${satelliteTable} sat ON sat.blockhash = b.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      GROUP BY ${groupByTime}
      ORDER BY b.blockTimestamp DESC
    `;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (error) {
            logger_1.default.err(`Error executing ${satelliteTable} total query: ${error}`, 'Ordpool');
            throw error;
        }
    }
    /** Per-discriminator breakdown for charts whose data lives in a satellite
     *  table (atomical-ops, counterparty-messages). Each chart has one row per
     *  (period, discriminator) combination: one ECharts series per distinct
     *  discriminator value. Examples:
     *    atomical-ops          → discriminator = sat.operation
     *    counterparty-messages → discriminator = sat.message_type   */
    async getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation, satelliteTable, discriminatorCol, discriminatorAlias) {
        // Strip the leading 'GROUP BY' so we can append our discriminator column.
        const groupByTime = this.getGroupByClause(aggregation).replace(/^GROUP BY/, '');
        const query = `
      SELECT
        MIN(b.height) AS minHeight,
        MAX(b.height) AS maxHeight,
        MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
        MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime,
        ${discriminatorCol} AS ${discriminatorAlias},
        COUNT(*) AS count
      FROM blocks b
      JOIN ${satelliteTable} sat ON sat.hash = b.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      GROUP BY ${groupByTime}, ${discriminatorCol}
      ORDER BY b.blockTimestamp DESC
    `;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (error) {
            logger_1.default.err(`Error executing ${satelliteTable} breakdown query: ${error}`, 'Ordpool');
            throw error;
        }
    }
    getGroupByClause(aggregation) {
        switch (aggregation) {
            case 'hour':
                return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp), DAY(b.blockTimestamp), HOUR(b.blockTimestamp)`;
            case 'day':
                return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp), DAY(b.blockTimestamp)`;
            case 'week':
                return `GROUP BY YEAR(b.blockTimestamp), WEEK(b.blockTimestamp)`;
            case 'month':
                return `GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp)`;
            case 'year':
                return `GROUP BY YEAR(b.blockTimestamp)`;
            default:
                return `GROUP BY b.blockTimestamp`; // Default to block-level aggregation
        }
    }
}
exports.default = new OrdpoolStatisticsApi();
