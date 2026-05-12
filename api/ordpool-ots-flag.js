"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastOtsCommitFlippedToClients = exports.setIsOtsCommitByTxid = exports.attachIsOtsCommit = exports.getOtsFlag = void 0;
const WebSocket = __importStar(require("ws"));
const ordpool_parser_1 = require("ordpool-parser");
const ordpool_ots_txid_set_1 = __importDefault(require("./ordpool-ots-txid-set"));
/**
 * Returns the `ordpool_ots` bit (as a bigint) when the given txid is in
 * the in-memory `ordpoolOtsTxidSet`, otherwise `0n`. The caller OR's
 * the result into its running flags bigint:
 *
 *     flags |= getOtsFlag(tx.txid);
 *
 * Pure -- no mutation, no `_ordpoolFlags` side-channel. O(1) per call
 * (one `Set.has()` against the in-memory set hydrated by the OTS poller).
 *
 * See ORDPOOL-FLAGS-ARCHITECTURE.md §2.2 for the call-site context.
 */
function getOtsFlag(txid) {
    return ordpool_ots_txid_set_1.default.has(txid) ? ordpool_parser_1.OrdpoolTransactionFlags.ordpool_ots : 0n;
}
exports.getOtsFlag = getOtsFlag;
/**
 * Strip-wire helper: writes the tristate `isOtsCommit` onto a tx object
 * before it ships over a strip surface (REST `/api/v1/tx/:txId`, WS
 * track-tx, WS track-txs). The frontend's OtsKnowledgeService consumes
 * the field, sparing it the lazy backend probe.
 *
 *   - `true`  -- this txid is in `ordpoolOtsTxidSet`.
 *   - `false` -- it's not.
 *
 * Mutates the passed object in place and also returns it for fluent
 * chaining. O(1) per call.
 *
 * See ORDPOOL-FLAGS-ARCHITECTURE.md §4.
 */
function attachIsOtsCommit(tx) {
    tx.isOtsCommit = ordpool_ots_txid_set_1.default.has(tx.txid);
    return tx;
}
exports.attachIsOtsCommit = attachIsOtsCommit;
/**
 * Variant for the WS track-txs (plural) initial-subscribe payload. The
 * `TxTrackingInfo` shape has no `txid` field (the txid is the key in
 * the outer map), so we attach by txid argument instead of by tx-object
 * field. O(1).
 */
function setIsOtsCommitByTxid(txid, info) {
    info.isOtsCommit = ordpool_ots_txid_set_1.default.has(txid);
    return info;
}
exports.setIsOtsCommitByTxid = setIsOtsCommitByTxid;
/**
 * Push `{otsCommitFlipped: <txid>}` to every connected client across
 * the given servers that is tracking `txid` via `track-tx` or
 * `track-txs`. Skips clients whose socket is not OPEN. Send failures
 * are swallowed silently (a degraded socket should not block the rest
 * of the broadcast).
 *
 * Extracted from websocket-handler.broadcastOtsCommitFlipped so the
 * broadcast logic is unit-testable without dragging in the full
 * upstream dependency chain (blocks, pools-parser, mining...). The
 * caller wires it to the OTS poller via
 * `ordpoolOtsTxidSet.subscribe(...)`.
 */
function broadcastOtsCommitFlippedToClients(servers, txid) {
    for (const server of servers) {
        for (const client of server.clients) {
            if (client.readyState !== WebSocket.OPEN)
                continue;
            const tracking = client['track-tx'] === txid
                || (Array.isArray(client['track-txs']) && client['track-txs'].includes(txid));
            if (!tracking)
                continue;
            try {
                client.send(JSON.stringify({ otsCommitFlipped: txid }));
            }
            catch {
                /* swallow -- one degraded socket must not block the rest */
            }
        }
    }
}
exports.broadcastOtsCommitFlippedToClients = broadcastOtsCommitFlippedToClients;
