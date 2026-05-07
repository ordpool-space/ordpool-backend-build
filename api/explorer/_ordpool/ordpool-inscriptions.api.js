"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ordpool_parser_1 = require("ordpool-parser");
const bitcoin_api_factory_1 = __importDefault(require("../../bitcoin/bitcoin-api-factory"));
const mempool_1 = __importDefault(require("../../mempool"));
class OrdpoolInscriptionsApi {
    async $getInscriptionOrDelegeate(inscriptionId, recursiveLevel = 0) {
        // prevent endless loops via circular delegates
        if (recursiveLevel > 4) {
            throw new Error('Too many delegate levels. Stopping.');
        }
        const inscription = await this.$getInscriptionById(inscriptionId);
        if (!inscription) {
            return undefined;
        }
        const delegates = inscription.getDelegates();
        if (delegates.length) {
            return this.$getInscriptionOrDelegeate(delegates[0], recursiveLevel + 1);
        }
        return inscription;
    }
    async $getInscriptionById(inscriptionId) {
        if (!(0, ordpool_parser_1.isValidInscriptionId)(inscriptionId)) {
            throw new Error('Invalid inscription ID!');
        }
        const splitted = inscriptionId.split('i');
        const txId = splitted[0];
        const inscriptionIndex = parseInt(splitted[1]);
        const inscriptions = await this.$parseTxInscriptions(txId);
        return inscriptions?.[inscriptionIndex];
    }
    // Find the first image-bearing inscription in a tx. Used by the block-overview
    // atlas: the parser sets ordpool_inscription_image when ANY inscription in the tx
    // is an image, so a flat `<txid>i0` lookup hits the wrong index whenever the image
    // sits behind a JSON or text inscription in a batch reveal.
    async $getFirstImageInscription(txid, recursiveLevel = 0) {
        if (recursiveLevel > 4) {
            throw new Error('Too many delegate levels. Stopping.');
        }
        const inscriptions = await this.$parseTxInscriptions(txid);
        if (!inscriptions?.length) {
            return undefined;
        }
        const first = inscriptions.find((i) => (i.contentType || '').startsWith('image/'));
        if (!first) {
            return undefined;
        }
        const delegates = first.getDelegates();
        if (delegates.length) {
            // delegate ids are inscription-shaped (txid + iN); recurse via the existing resolver
            // so we walk the same chain as direct content lookups.
            return this.$getInscriptionOrDelegeate(delegates[0], recursiveLevel + 1);
        }
        return first;
    }
    async $parseTxInscriptions(txId) {
        const mempool = mempool_1.default.getMempool();
        let transaction = mempool[txId];
        if (!transaction) {
            try {
                // skipConversion=false so the bitcoind RPC shape (vin[].txinwitness) is
                // converted into the Esplora shape (vin[].witness) that the parser
                // reads. With skipConversion=true the parser sees no witness array
                // and returns []; that's how every preview/content lookup silently
                // 404'd until the tx happened to be in mempool (which is already
                // stored in Esplora shape on this code path's other branch).
                transaction = await bitcoin_api_factory_1.default.$getRawTransaction(txId, false, false, false);
            }
            catch (error) {
                if (error.response && error.response.status === 404) {
                    return undefined;
                }
                throw error;
            }
        }
        return ordpool_parser_1.InscriptionParserService.parse(transaction);
    }
}
exports.default = new OrdpoolInscriptionsApi();
