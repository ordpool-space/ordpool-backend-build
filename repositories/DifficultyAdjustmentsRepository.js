"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../api/common");
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class DifficultyAdjustmentsRepository {
    async $saveAdjustments(adjustment) {
        if (adjustment.height === 1) {
            return;
        }
        try {
            const query = `INSERT INTO difficulty_adjustments(time, height, difficulty, adjustment) VALUE (FROM_UNIXTIME(?), ?, ?, ?)`;
            const params = [
                adjustment.time,
                adjustment.height,
                adjustment.difficulty,
                adjustment.adjustment,
            ];
            await database_1.default.query(query, params);
        }
        catch (e) {
            if (e.errno === 1062) { // ER_DUP_ENTRY - This scenario is possible upon node backend restart
                logger_1.default.debug(`Cannot save difficulty adjustment at block ${adjustment.height}, already indexed, ignoring`, logger_1.default.tags.mining);
            }
            else {
                logger_1.default.err(`Cannot save difficulty adjustment at block ${adjustment.height}. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
                throw e;
            }
        }
    }
    async $getAdjustments(interval, descOrder = false) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `SELECT 
      CAST(AVG(UNIX_TIMESTAMP(time)) as INT) as time,
      CAST(AVG(height) AS INT) as height,
      CAST(AVG(difficulty) as DOUBLE) as difficulty,
      CAST(AVG(adjustment) as DOUBLE) as adjustment
      FROM difficulty_adjustments`;
        if (interval) {
            query += ` WHERE time BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        query += ` GROUP BY UNIX_TIMESTAMP(time) DIV ${86400}`;
        if (descOrder === true) {
            query += ` ORDER BY height DESC`;
        }
        else {
            query += ` ORDER BY height`;
        }
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get difficulty adjustments from the database. Reason: ` + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    async $getRawAdjustments(interval, descOrder = false) {
        interval = common_1.Common.getSqlInterval(interval);
        let query = `SELECT 
      UNIX_TIMESTAMP(time) as time,
      height as height,
      difficulty as difficulty,
      adjustment as adjustment
      FROM difficulty_adjustments`;
        if (interval) {
            query += ` WHERE time BETWEEN DATE_SUB(NOW(), INTERVAL ${interval}) AND NOW()`;
        }
        if (descOrder === true) {
            query += ` ORDER BY height DESC`;
        }
        else {
            query += ` ORDER BY height`;
        }
        try {
            const [rows] = await database_1.default.query(query);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get difficulty adjustments from the database. Reason: ` + (e instanceof Error ? e.message : e), logger_1.default.tags.mining);
            throw e;
        }
    }
    async $getAdjustmentsHeights() {
        try {
            const [rows] = await database_1.default.query(`SELECT height FROM difficulty_adjustments`);
            return rows.map(block => block.height);
        }
        catch (e) {
            logger_1.default.err(`Cannot get difficulty adjustment block heights. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
            throw e;
        }
    }
    async $deleteAdjustementsFromHeight(height) {
        try {
            logger_1.default.info(`Delete newer difficulty adjustments from height ${height} from the database`, logger_1.default.tags.mining);
            await database_1.default.query(`DELETE FROM difficulty_adjustments WHERE height >= ?`, [height]);
        }
        catch (e) {
            logger_1.default.err(`Cannot delete difficulty adjustments from the database. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
            throw e;
        }
    }
    async $deleteLastAdjustment() {
        try {
            logger_1.default.info(`Delete last difficulty adjustment from the database`, logger_1.default.tags.mining);
            await database_1.default.query(`DELETE FROM difficulty_adjustments ORDER BY time LIMIT 1`);
        }
        catch (e) {
            logger_1.default.err(`Cannot delete last difficulty adjustment from the database. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
            throw e;
        }
    }
}
exports.default = new DifficultyAdjustmentsRepository();
