"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_parser_1 = require("ordpool-parser");
const ordpool_tx_fetch_helper_1 = require("./ordpool-tx-fetch.helper");
/**
 * Atomicals carry their CBOR-decoded files as a list. The atlas / preview
 * consumers need a single renderable image, so we expose a "first image" API
 * that mirrors $getFirstImageInscription on the inscriptions side.
 *
 * The list of files is set by the operation type (NFT/FT/DFT/DAT/etc.) — see
 * the Atomicals parser for the details. We don't filter on operation here;
 * any file with an image MIME counts.
 */
class OrdpoolAtomicalsApi {
    async $getFirstAtomicalImage(txid) {
        const transaction = await (0, ordpool_tx_fetch_helper_1.$fetchTxByTxid)(txid);
        if (!transaction) {
            return undefined;
        }
        const atomical = ordpool_parser_1.AtomicalParserService.parse(transaction);
        if (!atomical) {
            return undefined;
        }
        return atomical.getFiles().find((f) => (0, ordpool_parser_1.isImageContentType)(f.contentType));
    }
}
exports.default = new OrdpoolAtomicalsApi();
