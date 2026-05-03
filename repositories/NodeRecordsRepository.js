"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class NodesRecordsRepository {
    /** @asyncSafe */
    async $saveRecord(record) {
        try {
            const payloadBytes = Buffer.from(record.payload, 'base64');
            await database_1.default.query(`
        INSERT INTO nodes_records(public_key, type, payload)
        VALUE (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload = ?
      `, [record.publicKey, record.type, payloadBytes, payloadBytes]);
        }
        catch (e) {
            if (e.errno !== 1062) { // ER_DUP_ENTRY - Not an issue, just ignore this
                logger_1.default.err(`Cannot save node record (${[record.publicKey, record.type, record.payload]}) into db. Reason: ` + (e instanceof Error ? e.message : e));
                // We don't throw, not a critical issue if we miss some nodes records
            }
        }
    }
    /** @asyncSafe */
    async $getRecordTypes(publicKey) {
        try {
            const query = `
        SELECT type FROM nodes_records
        WHERE public_key = ?
      `;
            const [rows] = await database_1.default.query(query, [publicKey]);
            return rows.map(row => row['type']);
        }
        catch (e) {
            logger_1.default.err(`Cannot retrieve custom records for ${publicKey} from db. Reason: ` + (e instanceof Error ? e.message : e));
            return [];
        }
    }
    /** @asyncSafe */
    async $deleteUnusedRecords(publicKey, recordTypes) {
        try {
            let query;
            if (recordTypes.length) {
                query = `
          DELETE FROM nodes_records
          WHERE public_key = ?
          AND type NOT IN (${recordTypes.map(type => `${type}`).join(',')})
        `;
            }
            else {
                query = `
          DELETE FROM nodes_records
          WHERE public_key = ?
        `;
            }
            const [result] = await database_1.default.query(query, [publicKey]);
            return result.affectedRows;
        }
        catch (e) {
            logger_1.default.err(`Cannot delete unused custom records for ${publicKey} from db. Reason: ` + (e instanceof Error ? e.message : e));
            return 0;
        }
    }
}
exports.default = new NodesRecordsRepository();
