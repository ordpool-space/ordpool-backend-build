"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdpoolOtsBackfill = exports.extractMerkleRoot = exports.looksLikeCalendarCommit = void 0;
const logger_1 = __importDefault(require("../logger"));
const config_1 = __importDefault(require("../config"));
const OrdpoolOtsRepository_1 = __importDefault(require("../repositories/OrdpoolOtsRepository"));
const ordpool_ots_txid_set_1 = __importDefault(require("./ordpool-ots-txid-set"));
const ordpool_ots_poller_1 = require("./ordpool-ots-poller");
/** Hex of `OP_RETURN (0x6a) OP_PUSHBYTES_32 (0x20)`, i.e. the canonical OTS scriptPubKey prefix. */
const OTS_OP_RETURN_PREFIX = '6a20';
/**
 * Decide whether `tx` looks like a calendar commit. Cheap structural test
 * matching opentimestamps-server stamper.py output (1 input, 2 outputs,
 * vout[1] is the canonical OP_RETURN+32-byte payload). False negatives are
 * acceptable (we just stop walking) -- false positives are not, so the
 * test is conservative.
 */
function looksLikeCalendarCommit(tx) {
    if (tx.vin.length !== 1)
        return false;
    if (tx.vout.length !== 2)
        return false;
    const opReturn = tx.vout[1];
    if (opReturn.value !== 0)
        return false;
    if (!opReturn.scriptpubkey)
        return false;
    // exactly 0x6a 0x20 + 32 bytes (64 hex chars) = 68 hex chars total
    if (opReturn.scriptpubkey.length !== 68)
        return false;
    if (!opReturn.scriptpubkey.startsWith(OTS_OP_RETURN_PREFIX))
        return false;
    return true;
}
exports.looksLikeCalendarCommit = looksLikeCalendarCommit;
/** Extract the 32-byte Merkle root from a calendar-commit tx's OP_RETURN. */
function extractMerkleRoot(tx) {
    return tx.vout[1].scriptpubkey.slice(4); // strip the '6a20' prefix
}
exports.extractMerkleRoot = extractMerkleRoot;
/**
 * Module-level wrapper so unit tests can inject a deterministic fetch
 * implementation. Not exported as a singleton so tests can construct fresh
 * instances per test.
 */
class OrdpoolOtsBackfill {
    fetchImpl = (...args) => fetch(...args);
    esploraBase;
    constructor(esploraBase = config_1.default.ESPLORA.REST_API_URL) {
        this.esploraBase = esploraBase.replace(/\/$/, '');
    }
    setFetch(impl) {
        this.fetchImpl = impl;
    }
    /** Fetch the most-recent confirmed calendar tx from the calendar's own JSON. */
    async getSeedTxid(calendarUrl) {
        const res = await this.fetchImpl(calendarUrl, { headers: { Accept: 'application/json' } });
        if (!res.ok)
            return null;
        const body = await res.json();
        const txs = Array.isArray(body.transactions) ? body.transactions : [];
        // The calendar's transactions[] is newest-first AND server-filtered to
        // confirmations > 0. The OLDEST entry (last in the array) gives us the
        // furthest-back seed we can reach without electrs.
        for (let i = txs.length - 1; i >= 0; i--) {
            if (txs[i].txid)
                return txs[i].txid;
        }
        return null;
    }
    /** Fetch one tx from electrs in our minimal shape. */
    async fetchTx(txid) {
        try {
            const res = await this.fetchImpl(`${this.esploraBase}/tx/${txid}`);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch {
            return null;
        }
    }
    /** Walk backward from a seed tx, recording every calendar commit in the chain. */
    async walkBackward(calendar, seedTxid, maxDepth = 100_000) {
        const stats = { calendar, txsWalked: 0, txsRecorded: 0, stoppedReason: 'limit' };
        let currentTxid = seedTxid;
        while (currentTxid && stats.txsWalked < maxDepth) {
            // Idempotent short-circuit: if we already have this one, the chain
            // beyond it is already backfilled (each step's predecessor is fixed).
            if (ordpool_ots_txid_set_1.default.has(currentTxid)) {
                stats.stoppedReason = 'already-seen';
                break;
            }
            const tx = await this.fetchTx(currentTxid);
            if (!tx) {
                stats.stoppedReason = 'fetch-error';
                break;
            }
            stats.txsWalked++;
            if (!looksLikeCalendarCommit(tx)) {
                // We've reached the wallet's pre-calendar funding tx (or the chain
                // diverges into something we don't recognise). Stop, don't record.
                stats.stoppedReason = 'shape-mismatch';
                break;
            }
            const merkleRoot = extractMerkleRoot(tx);
            if (tx.status?.confirmed && tx.status?.block_hash && tx.status?.block_height !== undefined && tx.status?.block_time !== undefined) {
                const fee = tx.fee ?? 0;
                const feerate = tx.weight ? (fee / (tx.weight / 4)).toFixed(2) : '0';
                await OrdpoolOtsRepository_1.default.upsertConfirmed({
                    txid: tx.txid,
                    calendar,
                    merkleRoot,
                    blockhash: tx.status.block_hash,
                    blockheight: tx.status.block_height,
                    blocktime: tx.status.block_time,
                    fee,
                    feerate,
                });
            }
            else {
                // Unconfirmed historical tx is impossible (we only walk backward from
                // confirmed seeds). Record as pending defensively.
                await OrdpoolOtsRepository_1.default.upsertPending({ txid: tx.txid, calendar, merkleRoot });
            }
            ordpool_ots_txid_set_1.default.add(tx.txid);
            stats.txsRecorded++;
            // Move backward to the previous calendar tx (vin[0] is its change UTXO).
            currentTxid = tx.vin[0]?.txid ?? null;
            if (!currentTxid) {
                stats.stoppedReason = 'genesis';
                break;
            }
        }
        return stats;
    }
    /** Backfill every known calendar. */
    async run(maxDepth = 100_000) {
        if (!ordpool_ots_txid_set_1.default.isBootstrapped()) {
            await ordpool_ots_txid_set_1.default.bootstrap();
        }
        const out = [];
        for (const cal of ordpool_ots_poller_1.KNOWN_CALENDARS) {
            logger_1.default.info(`OTS backfill: starting ${cal.nickname} (${cal.url})`, 'Ordpool');
            const seed = await this.getSeedTxid(cal.url);
            if (!seed) {
                logger_1.default.warn(`OTS backfill: no seed txid for ${cal.nickname}; skipping`, 'Ordpool');
                out.push({ calendar: cal.nickname, txsWalked: 0, txsRecorded: 0, stoppedReason: 'fetch-error' });
                continue;
            }
            const stats = await this.walkBackward(cal.nickname, seed, maxDepth);
            logger_1.default.info(`OTS backfill: ${cal.nickname} walked=${stats.txsWalked} recorded=${stats.txsRecorded} stopped=${stats.stoppedReason}`, 'Ordpool');
            out.push(stats);
        }
        return out;
    }
}
exports.OrdpoolOtsBackfill = OrdpoolOtsBackfill;
