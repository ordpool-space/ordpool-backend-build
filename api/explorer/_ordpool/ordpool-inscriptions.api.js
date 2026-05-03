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
        const mempool = mempool_1.default.getMempool();
        let transaction = mempool[txId];
        if (!transaction) {
            try {
                transaction = await bitcoin_api_factory_1.default.$getRawTransaction(txId, true, false, false);
            }
            catch (error) {
                if (error.response && error.response.status === 404) {
                    return undefined;
                }
                throw error;
            }
        }
        const parsedInscriptions = ordpool_parser_1.InscriptionParserService.parse(transaction);
        return parsedInscriptions[inscriptionIndex];
    }
}
exports.default = new OrdpoolInscriptionsApi();
