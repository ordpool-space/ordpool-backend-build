"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../api/common");
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class BlocksSummariesRepository {
    /** @asyncSafe */
    async $getByBlockId(id) {
        try {
            const [summary] = await database_1.default.query(`SELECT * from blocks_summaries WHERE id = ?`, [id]);
            if (summary.length > 0) {
                summary[0].transactions = JSON.parse(summary[0].transactions);
                return summary[0];
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summary for block id ${id}. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return undefined;
    }
    /** @asyncSafe */
    async $saveTransactions(blockHeight, blockId, transactions, version) {
        try {
            const transactionsStr = JSON.stringify(transactions);
            await database_1.default.query(`
        INSERT INTO blocks_summaries
        SET height = ?, transactions = ?, id = ?, version = ?
        ON DUPLICATE KEY UPDATE transactions = ?, version = ?`, [blockHeight, transactionsStr, blockId, version, transactionsStr, version]);
        }
        catch (e) {
            logger_1.default.debug(`Cannot save block summary transactions for ${blockId}. Reason: ${e instanceof Error ? e.message : e}`);
            throw e;
        }
    }
    /** @asyncSafe */
    async $saveTemplate(params) {
        const blockId = params.template?.id;
        try {
            const transactions = JSON.stringify(params.template?.transactions || []);
            await database_1.default.query(`
        INSERT INTO blocks_templates (id, template, version)
        VALUE (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          template = ?,
          version = ?
      `, [blockId, transactions, params.version, transactions, params.version]);
        }
        catch (e) {
            if (e.errno === 1062) { // ER_DUP_ENTRY - This scenario is possible upon node backend restart
                logger_1.default.debug(`Cannot save block template for ${blockId} because it has already been indexed, ignoring`);
            }
            else {
                logger_1.default.warn(`Cannot save block template for ${blockId}. Reason: ${e instanceof Error ? e.message : e}`);
            }
        }
    }
    /** @asyncSafe */
    async $getTemplate(id) {
        try {
            const [templates] = await database_1.default.query(`SELECT * from blocks_templates WHERE id = ?`, [id]);
            if (templates.length > 0) {
                return {
                    id: templates[0].id,
                    transactions: JSON.parse(templates[0].template),
                    version: templates[0].version,
                };
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot get block template for block id ${id}. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return undefined;
    }
    /** @asyncSafe */
    async $getIndexedSummariesId() {
        try {
            const [rows] = await database_1.default.query(`SELECT id from blocks_summaries`);
            return rows.map(row => row.id);
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries id list. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return [];
    }
    /** @asyncSafe */
    async $getSummariesWithVersion(version) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT
          height,
          id
        FROM blocks_summaries
        WHERE version = ?
        ORDER BY height DESC;`, [version]);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries with version. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return [];
    }
    /** @asyncSafe */
    async $getTemplatesWithVersion(version) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT
          blocks_summaries.height as height,
          blocks_templates.id as id
        FROM blocks_templates
        JOIN blocks_summaries ON blocks_templates.id = blocks_summaries.id
        WHERE blocks_templates.version = ?
        ORDER BY height DESC;`, [version]);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries with version. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return [];
    }
    /** @asyncSafe */
    async $getSummariesBelowVersion(version) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT
          height,
          id,
          version
        FROM blocks_summaries
        WHERE version < ?
        ORDER BY height DESC;`, [version]);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries below version. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return [];
    }
    /** @asyncSafe */
    async $getTemplatesBelowVersion(version) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT
          blocks_summaries.height as height,
          blocks_templates.id as id,
          blocks_templates.version as version
        FROM blocks_templates
        JOIN blocks_summaries ON blocks_templates.id = blocks_summaries.id
        WHERE blocks_templates.version < ?
        ORDER BY height DESC;`, [version]);
            return rows;
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries below version. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return [];
    }
    /**
     * Get the fee percentiles if the block has already been indexed, [] otherwise
     *
     * @param id
     * @asyncSafe
     */
    async $getFeePercentilesByBlockId(id) {
        try {
            const [rows] = await database_1.default.query(`
        SELECT transactions
        FROM blocks_summaries
        WHERE id = ?`, [id]);
            if (rows === null || rows.length === 0) {
                return null;
            }
            const transactions = JSON.parse(rows[0].transactions);
            if (transactions === null) {
                return null;
            }
            transactions.shift(); // Ignore coinbase
            transactions.sort((a, b) => a.fee - b.fee);
            const fees = transactions.map((t) => t.fee);
            return [
                fees[0] ?? 0,
                fees[Math.max(0, Math.floor(fees.length * 0.1) - 1)] ?? 0,
                fees[Math.max(0, Math.floor(fees.length * 0.25) - 1)] ?? 0,
                fees[Math.max(0, Math.floor(fees.length * 0.5) - 1)] ?? 0,
                fees[Math.max(0, Math.floor(fees.length * 0.75) - 1)] ?? 0,
                fees[Math.max(0, Math.floor(fees.length * 0.9) - 1)] ?? 0,
                fees[fees.length - 1] ?? 0, // max
            ];
        }
        catch (e) {
            logger_1.default.err(`Cannot get block summaries transactions. Reason: ` + (e instanceof Error ? e.message : e));
            return null;
        }
    }
    async $isSummaryIndexed(id) {
        if (!common_1.Common.blocksSummariesIndexingEnabled()) {
            return false;
        }
        try {
            const [rows] = await database_1.default.query(`SELECT id from blocks_summaries WHERE id = ?`, [id]);
            return rows.length > 0;
        }
        catch (e) {
            logger_1.default.err(`Cannot check if block summary is indexed. Reason: ` + (e instanceof Error ? e.message : e));
        }
        return false;
    }
}
exports.default = new BlocksSummariesRepository();
