"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_parser_1 = require("ordpool-parser");
const config_1 = __importDefault(require("../../../config"));
const database_1 = __importDefault(require("../../../database"));
const logger_1 = __importDefault(require("../../../logger"));
const get_sql_interval_1 = require("./get-sql-interval");
class OrdpoolStatisticsApi {
    async getOrdpoolStatistics(type, interval, aggregation) {
        const firstInscriptionHeight = (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK);
        const sqlInterval = (0, get_sql_interval_1.getSqlInterval)(interval);
        // Satellite-table charts use their own JOIN target + an extra GROUP BY
        // discriminator (one series per operation / message_type).
        if (type === 'atomical-ops') {
            return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_atomical_op', 'sat.operation', 'operation');
        }
        if (type === 'counterparty-messages') {
            return this.getSatelliteBreakdown(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_counterparty', 'sat.message_type', 'messageType');
        }
        if (type === 'ots') {
            // ordpool_stats_ots only carries confirmed-by-block rows once the
            // poller's confirm step fills in blockhash/blockheight. Pending rows
            // (NULL blockhash) deliberately skip aggregation -- they're not on
            // chain yet.
            return this.getSatelliteTotal(firstInscriptionHeight, sqlInterval, aggregation, 'ordpool_stats_ots');
        }
        const selectClause = this.getSelectClause(type);
        const groupByClause = this.getGroupByClause(aggregation);
        const query = `
      SELECT ${selectClause}
      FROM blocks b
      LEFT JOIN ordpool_stats bos ON b.hash = bos.hash
      WHERE b.height >= ${firstInscriptionHeight}
        AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL ${sqlInterval})
      ${groupByClause}
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
    /** Per-discriminator breakdown for charts whose data lives in a satellite
     *  table (atomical-ops, counterparty-messages). Each chart has one row per
     *  (period, discriminator) combination — one ECharts series per distinct
     *  discriminator value. Examples:
     *    atomical-ops          → discriminator = sat.operation
     *    counterparty-messages → discriminator = sat.message_type   */
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
    getSelectClause(type) {
        const baseClause = `
      MIN(b.height) AS minHeight,
      MAX(b.height) AS maxHeight,
      MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
      MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime
    `;
        switch (type) {
            case 'mints':
                return `
          ${baseClause},
          SUM(bos.amounts_cat21_mint) AS cat21Mints,
          SUM(bos.amounts_inscription_mint) AS inscriptionMints,
          SUM(bos.amounts_rune_mint) AS runeMints,
          SUM(bos.amounts_brc20_mint) AS brc20Mints,
          SUM(bos.amounts_src20_mint) AS src20Mints
        `;
            case 'new-tokens':
                return `
          ${baseClause},
          SUM(bos.amounts_rune_etch) AS runeEtchings,
          SUM(bos.amounts_brc20_deploy) AS brc20Deploys,
          SUM(bos.amounts_src20_deploy) AS src20Deploys
        `;
            case 'fees':
                return `
          ${baseClause},
          SUM(bos.fees_rune_mints) AS feesRuneMints,
          SUM(bos.fees_non_uncommon_rune_mints) AS feesNonUncommonRuneMints,
          SUM(bos.fees_brc20_mints) AS feesBrc20Mints,
          SUM(bos.fees_src20_mints) AS feesSrc20Mints,
          SUM(bos.fees_cat21_mints) AS feesCat21Mints,
          SUM(bos.fees_atomicals) AS feesAtomicals,
          SUM(bos.fees_inscription_mints) AS feesInscriptionMints
        `;
            case 'inscription-sizes':
                return `
          ${baseClause},
          SUM(bos.inscriptions_total_envelope_size) AS totalEnvelopeSize,
          SUM(bos.inscriptions_total_content_size) AS totalContentSize,
          MAX(bos.inscriptions_largest_envelope_size) AS largestEnvelopeSize,
          MAX(bos.inscriptions_largest_content_size) AS largestContentSize,
          AVG(bos.inscriptions_average_envelope_size) AS avgEnvelopeSize,
          AVG(bos.inscriptions_average_content_size) AS avgContentSize
        `;
            case 'protocols':
                return `
          ${baseClause},
          SUM(bos.amounts_counterparty) AS counterparty,
          SUM(bos.amounts_stamp) AS stamp,
          SUM(bos.amounts_src721) AS src721,
          SUM(bos.amounts_src101) AS src101
        `;
            case 'inscription-types':
                return `
          ${baseClause},
          SUM(bos.amounts_inscription_image) AS inscriptionImages,
          SUM(bos.amounts_inscription_text) AS inscriptionTexts,
          SUM(bos.amounts_inscription_json) AS inscriptionJsons
        `;
            case 'inscription-type-sizes':
                return `
          ${baseClause},
          SUM(bos.inscriptions_image_total_envelope_size) AS imageTotalEnvelopeSize,
          SUM(bos.inscriptions_image_total_content_size)  AS imageTotalContentSize,
          AVG(bos.inscriptions_image_average_envelope_size) AS imageAvgEnvelopeSize,
          AVG(bos.inscriptions_image_average_content_size)  AS imageAvgContentSize,
          SUM(bos.inscriptions_text_total_envelope_size)  AS textTotalEnvelopeSize,
          SUM(bos.inscriptions_text_total_content_size)   AS textTotalContentSize,
          AVG(bos.inscriptions_text_average_envelope_size) AS textAvgEnvelopeSize,
          AVG(bos.inscriptions_text_average_content_size)  AS textAvgContentSize,
          SUM(bos.inscriptions_json_total_envelope_size)  AS jsonTotalEnvelopeSize,
          SUM(bos.inscriptions_json_total_content_size)   AS jsonTotalContentSize,
          AVG(bos.inscriptions_json_average_envelope_size) AS jsonAvgEnvelopeSize,
          AVG(bos.inscriptions_json_average_content_size)  AS jsonAvgContentSize
        `;
            case 'inscription-type-fees':
                return `
          ${baseClause},
          SUM(bos.fees_inscription_image_mints) AS feesInscriptionImageMints,
          SUM(bos.fees_inscription_text_mints)  AS feesInscriptionTextMints,
          SUM(bos.fees_inscription_json_mints)  AS feesInscriptionJsonMints
        `;
            case 'inscription-compression':
                return `
          ${baseClause},
          SUM(bos.inscriptions_brotli_count)             AS brotliCount,
          SUM(bos.inscriptions_gzip_count)               AS gzipCount,
          SUM(bos.inscriptions_compressed_envelope_bytes) AS compressedEnvelopeBytes
        `;
            case 'cat21-stats':
                return `
          ${baseClause},
          SUM(bos.amounts_cat21_mint)  AS cat21Mints,
          SUM(bos.cat21_genesis_count) AS cat21GenesisCount,
          AVG(bos.cat21_avg_fee_rate)  AS cat21AvgFeeRate,
          MIN(bos.cat21_min_fee_rate)  AS cat21MinFeeRate,
          MAX(bos.cat21_max_fee_rate)  AS cat21MaxFeeRate
        `;
            case 'rune-activity':
                // Returns both overall and non-uncommon series in one response so the
                // chart shows both lines together — UNCOMMON•GOODS dominance is real
                // and worth surfacing alongside the "what other runes are happening"
                // signal.
                return `
          ${baseClause},
          SUM(bos.runes_unique_mints_count)              AS uniqueMints,
          SUM(bos.runes_unique_mints_count_non_uncommon) AS uniqueMintsNonUncommon,
          MAX(bos.runes_top_mint_count)                  AS topMintCount,
          MAX(bos.runes_top_mint_count_non_uncommon)     AS topMintCountNonUncommon
        `;
            default:
                throw new Error('Invalid chart type: ' + type);
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
