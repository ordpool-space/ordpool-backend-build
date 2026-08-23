"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_CALENDARS = void 0;
const logger_1 = __importDefault(require("../logger"));
const OrdpoolOtsRepository_1 = __importDefault(require("../repositories/OrdpoolOtsRepository"));
const ordpool_ots_txid_set_1 = __importDefault(require("./ordpool-ots-txid-set"));
const ordpool_ots_user_agent_1 = require("./ordpool-ots-user-agent");
const ots_calendars_config_1 = require("./explorer/_ordpool/ots-calendars-config");
const ordpool_fetch_1 = require("./ordpool-fetch");
const config_1 = __importDefault(require("../config"));
const ordpool_ots_backfill_1 = require("./ordpool-ots-backfill");
function withTrailingSlash(c) {
    return { nickname: c.nickname, url: c.url.endsWith('/') ? c.url : c.url + '/' };
}
function knownCalendars() {
    return (0, ots_calendars_config_1.getOtsCalendars)().map(withTrailingSlash);
}
/**
 * Backwards-compatible export so tests / callers can do
 *   `KNOWN_CALENDARS.find(c => c.nickname === 'alice')`.
 * Computed lazily on every property access; safe even before fs/JSON load
 * completes.
 */
exports.KNOWN_CALENDARS = new Proxy([], {
    get(_target, prop) {
        const arr = knownCalendars();
        const v = arr[prop];
        return typeof v === 'function' ? v.bind(arr) : v;
    },
});
/**
 * Default poll cadence. Calendars aggregate and commit on a far slower rhythm
 * than this, and they are unpaid third parties, so a tighter loop mostly buys
 * request volume: four calendars at one minute is ~5.7k requests/day each.
 *
 * The cost of the slower cadence is bounded. Confirmed commitments stay in the
 * calendar's confirmed batch and are picked up whenever we next look, so
 * nothing durable is missed. What can slip past is an unconfirmed commitment
 * that is RBF-replaced between two polls: the calendar exposes only the latest
 * via `most_recent_tx`, so an intermediate version is flagged only if a poll
 * lands while it is current. Those versions never confirm, so the loss is a
 * transient mempool flag, not on-chain data.
 */
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;
class OrdpoolOtsPoller {
    timer = null;
    running = false;
    intervalMs = DEFAULT_INTERVAL_MS;
    inFlight = false; // de-overlap if a poll runs long
    fetchImpl = (...args) => fetch(...args);
    /** Test-only: swap in a deterministic fetch. */
    setFetch(impl) {
        this.fetchImpl = impl;
    }
    /** Start the periodic polling loop. Idempotent: calling twice is a no-op. */
    start(intervalMs = DEFAULT_INTERVAL_MS) {
        if (this.running)
            return;
        this.intervalMs = intervalMs;
        this.running = true;
        logger_1.default.info(`OTS poller starting; interval=${this.intervalMs}ms; calendars=${exports.KNOWN_CALENDARS.length}`, 'Ordpool');
        // First poll immediately so we don't wait an interval on cold start.
        this.tick().catch(e => logger_1.default.err('OTS poll tick failed: ' + (e instanceof Error ? e.message : e), 'Ordpool'));
        this.timer = setInterval(() => {
            this.tick().catch(e => logger_1.default.err('OTS poll tick failed: ' + (e instanceof Error ? e.message : e), 'Ordpool'));
        }, this.intervalMs);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.running = false;
    }
    /** One poll across every calendar. Returns per-calendar stats. */
    async tick() {
        if (this.inFlight)
            return [];
        this.inFlight = true;
        try {
            const out = [];
            for (const cal of exports.KNOWN_CALENDARS) {
                out.push(await this.pollOne(cal));
            }
            // One unreachable calendar is routine: they are independent operators
            // and the set is redundant on purpose, so the others still hydrate the
            // txid set. Losing every calendar in the same tick is ours to care
            // about — no calendar means no new OTS commits observed at all.
            if (out.length > 0 && out.every(r => !r.ok)) {
                logger_1.default.warn(`OTS poll: no calendar responded (${out.length} tried)`, 'Ordpool');
            }
            return out;
        }
        finally {
            this.inFlight = false;
        }
    }
    async pollOne(cal) {
        let body;
        try {
            body = await this.fetchCalendarJson(cal.url);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            logger_1.default.debug(`OTS poll ${cal.nickname}: unreachable -- ${message}`, 'Ordpool');
            return { calendar: cal.nickname, ok: false, errorMessage: message, newConfirmed: 0, newPending: 0, upgraded: 0, totalSeen: 0 };
        }
        // The calendar's tip is the canonical 32-byte merkle root we'll attach to
        // every newly-seen tx in this poll cycle. Pre-existing rows already have a
        // merkle_root from when they were first inserted.
        const tipHex = body.tip && body.tip !== 'None' ? body.tip : null;
        let newConfirmed = 0;
        let newPending = 0;
        let upgraded = 0;
        const txList = Array.isArray(body.transactions) ? body.transactions : [];
        // Confirmed-only batch (server filters confirmations > 0).
        for (const tx of txList) {
            if (!tx.txid)
                continue;
            const inSet = ordpool_ots_txid_set_1.default.has(tx.txid);
            if (!inSet) {
                // Newly-seen tx that's already confirmed at the calendar.
                if (tx.blockheight !== undefined && tx.blockhash !== undefined && tx.blocktime !== undefined) {
                    // Read the tx's OWN committed root from its OP_RETURN; the calendar
                    // tip is only the LATEST root, so it is a best-effort fallback used
                    // only when the electrs fetch fails.
                    const merkleRoot = await this.resolveMerkleRoot(tx.txid, tipHex ?? tx.txid);
                    await OrdpoolOtsRepository_1.default.upsertConfirmed({
                        txid: tx.txid,
                        calendar: cal.nickname,
                        merkleRoot,
                        blockhash: tx.blockhash,
                        blockheight: tx.blockheight,
                        blocktime: tx.blocktime,
                        fee: Math.abs(typeof tx.fee === 'number' ? tx.fee : 0),
                        feerate: typeof tx.feerate === 'string' ? tx.feerate : (tx.feerate !== undefined ? String(tx.feerate) : '0'),
                    });
                    ordpool_ots_txid_set_1.default.add(tx.txid);
                    newConfirmed++;
                }
            }
            else {
                // Already in our set. If the row is still pending in the DB but the
                // calendar now reports confirmation data, upgrade it.
                if (tx.blockheight !== undefined && tx.blockhash !== undefined && tx.blocktime !== undefined) {
                    const existing = await OrdpoolOtsRepository_1.default.getByTxid(tx.txid);
                    if (existing && !existing.confirmedAt) {
                        await OrdpoolOtsRepository_1.default.upsertConfirmed({
                            txid: tx.txid,
                            calendar: cal.nickname,
                            merkleRoot: existing.merkleRoot,
                            blockhash: tx.blockhash,
                            blockheight: tx.blockheight,
                            blocktime: tx.blocktime,
                            fee: Math.abs(typeof tx.fee === 'number' ? tx.fee : 0),
                            feerate: typeof tx.feerate === 'string' ? tx.feerate : (tx.feerate !== undefined ? String(tx.feerate) : '0'),
                        });
                        upgraded++;
                    }
                }
            }
        }
        // Mempool: the server only surfaces the LATEST unconfirmed via most_recent_tx
        // (older RBF-replaced versions count via prior_versions, no txids exposed),
        // so a version is caught only if a poll lands while it is current. See
        // DEFAULT_INTERVAL_MS for why that is an accepted loss.
        const mr = body.most_recent_tx;
        if (mr && mr !== 'None' && !ordpool_ots_txid_set_1.default.has(mr)) {
            const merkleRoot = await this.resolveMerkleRoot(mr, tipHex ?? mr);
            await OrdpoolOtsRepository_1.default.upsertPending({ txid: mr, calendar: cal.nickname, merkleRoot });
            ordpool_ots_txid_set_1.default.add(mr);
            newPending++;
        }
        return { calendar: cal.nickname, ok: true, newConfirmed, newPending, upgraded, totalSeen: txList.length };
    }
    async fetchCalendarJson(url) {
        const res = await (0, ordpool_fetch_1.fetchWithTimeout)(url, {
            headers: {
                // Identify ourselves on every poll so calendar operators recognise
                // the traffic and have a path to contact us instead of rate-limiting
                // an anonymous Node fetch UA.
                'Accept': 'application/json',
                'User-Agent': ordpool_ots_user_agent_1.OTS_OUTBOUND_USER_AGENT,
            },
        }, FETCH_TIMEOUT_MS, this.fetchImpl);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }
    /**
     * The 32-byte Merkle root a calendar tx commits lives in its OWN OP_RETURN
     * (vout[1]), not in the calendar's current `tip` -- the tip is only the
     * latest root, so stamping every newly-seen tx with it is wrong for any tx
     * that is not the newest. Fetch the tx from electrs and read its real root,
     * matching the backfill (extractMerkleRoot). On a fetch / shape failure fall
     * back to `fallback` so the tx is still recorded this cycle.
     */
    async resolveMerkleRoot(txid, fallback) {
        try {
            const base = config_1.default.ESPLORA.REST_API_URL.replace(/\/$/, '');
            const res = await (0, ordpool_fetch_1.fetchWithTimeout)(`${base}/tx/${txid}`, {
                headers: { 'Accept': 'application/json' },
            }, FETCH_TIMEOUT_MS, this.fetchImpl);
            if (!res.ok)
                return fallback;
            const tx = await res.json();
            return (0, ordpool_ots_backfill_1.looksLikeCalendarCommit)(tx) ? (0, ordpool_ots_backfill_1.extractMerkleRoot)(tx) : fallback;
        }
        catch {
            return fallback;
        }
    }
}
exports.default = new OrdpoolOtsPoller();
