"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.$fetchTxByTxid = void 0;
const bitcoin_api_factory_1 = __importDefault(require("../../bitcoin/bitcoin-api-factory"));
const mempool_1 = __importDefault(require("../../mempool"));
/**
 * Resolve a txid to an Esplora-shape transaction, preferring the in-memory
 * mempool entry and falling back to bitcoind RPC. Returns undefined when the
 * tx is neither in the mempool nor on chain (404), and rethrows any other
 * RPC error.
 *
 * `skipConversion=false` is critical: with skipConversion=true the bitcoind
 * RPC shape (vin[].txinwitness, scriptSig as object) is left un-converted,
 * the parser reads vin[].witness and silently returns nothing. Every
 * /preview / /content lookup that fell through to the RPC fetch path used
 * to 404 because of this. Mempool entries are already stored in Esplora
 * shape, so the mempool branch is unaffected.
 */
async function $fetchTxByTxid(txId) {
    const mempool = mempool_1.default.getMempool();
    const inMempool = mempool[txId];
    if (inMempool) {
        return inMempool;
    }
    try {
        return await bitcoin_api_factory_1.default.$getRawTransaction(txId, false, false, false);
    }
    catch (error) {
        if (error.response && error.response.status === 404) {
            return undefined;
        }
        throw error;
    }
}
exports.$fetchTxByTxid = $fetchTxByTxid;
