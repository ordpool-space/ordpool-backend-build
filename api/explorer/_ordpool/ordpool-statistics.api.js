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
