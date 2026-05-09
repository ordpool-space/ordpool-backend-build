"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addOtsFlagBatch = exports.addOtsFlag = void 0;
const ordpool_parser_1 = require("ordpool-parser");
const ordpool_ots_txid_set_1 = __importDefault(require("./ordpool-ots-txid-set"));
/**
 * Pre-enrichment helper that ORs the ordpool_ots flag into tx._ordpoolFlags
 * when the tx's txid is in the in-memory OrdpoolOtsTxidSet (populated from
 * the ordpool_stats_ots satellite table on backend boot, kept fresh by
 * OrdpoolOtsPoller).
 *
 * Mirrors the existing parser-side _ordpoolFlags HACK pattern: the parser
 * pre-enriches with witness/output-derived bits, then this function ORs
 * the indexer-derived bit, then upstream's sync Common.getTransactionFlags
 * reads tx._ordpoolFlags. Two pre-enrichment steps, one read.
 *
 * O(1) per tx (hash-set lookup). Does NOT do an SQL round-trip per tx --
 * the set is already in memory.
 */
function addOtsFlag(tx) {
    if (!ordpool_ots_txid_set_1.default.has(tx.txid))
        return;
    // BigInt arithmetic: JS bitwise OR truncates to int32 and would zero out
    // every ordpool bit (they all live above bit 47). The OR happens in
    // BigInt space; Number() back is exact for any combination of ordpool
    // bits (the spread bits 48-81 fits inside Number's 53-bit mantissa
    // when all set bits are within that window). Same pattern the parser
    // uses in DigitalArtifactAnalyserService.analyseTransaction.
    const existing = BigInt(tx._ordpoolFlags ?? 0);
    tx._ordpoolFlags = Number(existing | ordpool_parser_1.OrdpoolTransactionFlags.ordpool_ots);
}
exports.addOtsFlag = addOtsFlag;
/**
 * Bulk variant for the block path. Same semantics; saves the per-call
 * function-invocation overhead when iterating thousands of txs.
 */
function addOtsFlagBatch(txs) {
    for (const tx of txs)
        addOtsFlag(tx);
}
exports.addOtsFlagBatch = addOtsFlagBatch;
