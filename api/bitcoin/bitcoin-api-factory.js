"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bitcoinCoreApi = void 0;
const config_1 = __importDefault(require("../../config"));
const esplora_api_1 = __importDefault(require("./esplora-api"));
const bitcoin_api_1 = __importDefault(require("./bitcoin-api"));
const electrum_api_1 = __importDefault(require("./electrum-api"));
const bitcoin_client_1 = __importDefault(require("./bitcoin-client"));
function bitcoinApiFactory() {
    switch (config_1.default.MEMPOOL.BACKEND) {
        case 'esplora':
            return new esplora_api_1.default();
        case 'electrum':
            return new electrum_api_1.default(bitcoin_client_1.default);
        case 'none':
        default:
            return new bitcoin_api_1.default(bitcoin_client_1.default);
    }
}
exports.bitcoinCoreApi = new bitcoin_api_1.default(bitcoin_client_1.default);
exports.default = bitcoinApiFactory();
