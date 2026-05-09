"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../logger"));
const OrdpoolOtsRepository_1 = __importDefault(require("../repositories/OrdpoolOtsRepository"));
/**
 * In-memory set of every Bitcoin txid that's known to be an OpenTimestamps
 * calendar commit. Populated from `ordpool_stats_ots` on backend boot, kept
 * fresh by the poller after every successful insert.
 *
 * Per-tx labelling (the `addOtsFlag` pre-enrichment) does an O(1) `has()`
 * call against this set, never an SQL round-trip. Memory: ~16 MB worst case
 * (~225k txids × ~70 bytes per V8 string).
 *
 * Why a singleton: the OTS poller and every flag pre-enrichment call site
 * read/write the same set. There's no use case for multiple instances and
 * the boot-time bootstrap is idempotent.
 */
class OrdpoolOtsTxidSet {
    set = new Set();
    bootstrapped = false;
    /** Load every txid from the satellite table into memory. Idempotent. */
    async bootstrap() {
        if (this.bootstrapped)
            return;
        try {
            const txids = await OrdpoolOtsRepository_1.default.getAllTxids();
            for (const t of txids)
                this.set.add(t);
            this.bootstrapped = true;
            logger_1.default.info(`OTS txid set bootstrapped with ${txids.length} entries`, 'Ordpool');
        }
        catch (e) {
            logger_1.default.err('Failed to bootstrap OTS txid set: ' + (e instanceof Error ? e.message : e), 'Ordpool');
            throw e;
        }
    }
    has(txid) {
        return this.set.has(txid);
    }
    add(txid) {
        this.set.add(txid);
    }
    size() {
        return this.set.size;
    }
    isBootstrapped() {
        return this.bootstrapped;
    }
    /** Test-only: drop everything and reset bootstrap flag. */
    reset() {
        this.set.clear();
        this.bootstrapped = false;
    }
}
exports.default = new OrdpoolOtsTxidSet();
