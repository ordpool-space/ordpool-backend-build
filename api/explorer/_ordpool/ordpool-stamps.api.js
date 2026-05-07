"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_parser_1 = require("ordpool-parser");
const ordpool_tx_fetch_helper_1 = require("./ordpool-tx-fetch.helper");
/**
 * Resolve a txid to its parsed stamp, if any.
 *
 * Stamps are tx-level (one stamp per tx), so the lookup is keyed by txid only —
 * no inscription-style index suffix. Returns undefined for txs that aren't
 * stamps and for txs that aren't on chain.
 *
 * No content-type filtering at this layer: the route serves whatever the stamp
 * carries (image/png, image/svg+xml, text/html, …). Same posture as
 * /content/<inscriptionId>: the consumer asked for this specific stamp, give
 * them the bytes.
 */
class OrdpoolStampsApi {
    async $getStamp(txid) {
        const transaction = await (0, ordpool_tx_fetch_helper_1.$fetchTxByTxid)(txid);
        if (!transaction) {
            return undefined;
        }
        // StampParserService can also return ParsedSrc20/Src721/Src101 protocol
        // wrappers when the stamp's payload is one of those formats. Those don't
        // carry raw renderable bytes (their getDataRaw is the protocol payload,
        // not the underlying image), so we only accept ParsedStamp here.
        const parsed = ordpool_parser_1.StampParserService.parse(transaction);
        if (parsed && parsed.type === ordpool_parser_1.DigitalArtifactType.Stamp) {
            return parsed;
        }
        return undefined;
    }
}
exports.default = new OrdpoolStampsApi();
