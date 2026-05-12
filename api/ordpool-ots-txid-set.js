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
 * Per-tx labelling (`getOtsFlag(txid)` in `Common.getTransactionFlags`) does
 * an O(1) `has()` call against this set, never an SQL round-trip. Memory:
 * ~16 MB worst case (~225k txids × ~70 bytes per V8 string).
 *
 * The set is also observable: a callback registered via `subscribe(cb)`
 * fires whenever a NEW txid is added. The websocket-handler uses this to
 * push `otsCommitFlipped` to clients tracking the txid the moment the
 * poller learns about a calendar batch.
 *
 * Why a singleton: the OTS poller and every flag pre-enrichment call site
 * read/write the same set. There's no use case for multiple instances and
 * the boot-time bootstrap is idempotent.
 */
class OrdpoolOtsTxidSet {
    set = new Set();
    bootstrapped = false;
    subscribers = new Set();
    /** Load every txid from the satellite table into memory. Idempotent.
     *
     *  Bootstrap uses the underlying native `Set.add` directly, NOT the
     *  public `add()` method, so the initial hydrate does not notify
     *  subscribers. (There are no subscribers at boot time anyway; this
     *  is defensive in case a future caller registers earlier.) */
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
    /** Insert a txid. Returns `true` if this was a NEW addition (and fires
     *  subscribers), `false` if the txid was already present. Subscribers
     *  receive the txid synchronously via callback. */
    add(txid) {
        if (this.set.has(txid))
            return false;
        this.set.add(txid);
        for (const cb of this.subscribers) {
            try {
                cb(txid);
            }
            catch (e) {
                logger_1.default.err('OTS txid-set subscriber threw: ' + (e instanceof Error ? e.message : e), 'Ordpool');
            }
        }
        return true;
    }
    size() {
        return this.set.size;
    }
    isBootstrapped() {
        return this.bootstrapped;
    }
    /** Register a listener called once per new txid addition. Returns an
     *  unsubscribe function. Subscriber exceptions are caught and logged
     *  so one bad listener can't poison the others. */
    subscribe(cb) {
        this.subscribers.add(cb);
        return () => { this.subscribers.delete(cb); };
    }
    /** Test-only: drop everything and reset bootstrap flag (subscribers too). */
    reset() {
        this.set.clear();
        this.bootstrapped = false;
        this.subscribers.clear();
    }
}
exports.default = new OrdpoolOtsTxidSet();
