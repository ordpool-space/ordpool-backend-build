"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../../logger"));
const database_1 = __importDefault(require("../../database"));
const common_1 = require("../common");
class StatisticsApi {
    async $getStatistics(interval = null) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `SELECT UNIX_TIMESTAMP(added) AS added, channel_count, total_capacity,
      tor_nodes, clearnet_nodes, unannounced_nodes, clearnet_tor_nodes
      FROM lightning_stats`;
        if (interval) {
            query += ` WHERE added BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        query += ` ORDER BY added DESC`;
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err('$getStatistics error: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $getLatestStatistics() {
        try {
            const [rows] = await database_1.default.query(`SELECT * FROM lightning_stats ORDER BY added DESC LIMIT 1`);
            const [rows2] = await database_1.default.query(`SELECT * FROM lightning_stats WHERE DATE(added) = DATE(NOW() - INTERVAL 7 DAY)`);
            return {
                latest: rows[0],
                previous: rows2[0],
            };
        }
        catch (e) {
            logger_1.default.err('$getLatestStatistics error: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $getStatisticsCount() {
        try {
            const [rows] = await database_1.default.query(`SELECT count(*) as count FROM lightning_stats`);
            return rows[0].count;
        }
        catch (e) {
            logger_1.default.err('$getLatestStatistics error: ' + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
}
exports.default = new StatisticsApi();
