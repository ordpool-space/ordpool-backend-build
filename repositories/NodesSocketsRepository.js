"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
class NodesSocketsRepository {
    /** @asyncSafe */
    async $saveSocket(socket) {
        try {
            await database_1.default.query(`
        INSERT INTO nodes_sockets(public_key, socket, type)
        VALUE (?, ?, ?)
      `, [socket.publicKey, socket.addr, socket.network], 'silent');
        }
        catch (e) {
            if (e.errno !== 1062) { // ER_DUP_ENTRY - Not an issue, just ignore this
                logger_1.default.err(`Cannot save node socket (${[socket.publicKey, socket.addr, socket.network]}) into db. Reason: ` + (e instanceof Error ? e.message : e));
                // We don't throw, not a critical issue if we miss some nodes sockets
            }
        }
    }
    /** @asyncSafe */
    async $deleteUnusedSockets(publicKey, addresses) {
        if (addresses.length === 0) {
            return 0;
        }
        try {
            const query = `
        DELETE FROM nodes_sockets
        WHERE public_key = ?
        AND socket NOT IN (${addresses.map(id => `"${id}"`).join(',')})
      `;
            const [result] = await database_1.default.query(query, [publicKey]);
            return result.affectedRows;
        }
        catch (e) {
            logger_1.default.err(`Cannot delete unused sockets for ${publicKey} from db. Reason: ` + (e instanceof Error ? e.message : e));
            return 0;
        }
    }
}
exports.default = new NodesSocketsRepository();
