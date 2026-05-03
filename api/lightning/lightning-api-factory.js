"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const clightning_client_1 = __importDefault(require("./clightning/clightning-client"));
const lnd_api_1 = __importDefault(require("./lnd/lnd-api"));
function lightningApiFactory() {
    switch (config_1.default.LIGHTNING.ENABLED === true && config_1.default.LIGHTNING.BACKEND) {
        case 'cln':
            return new clightning_client_1.default(config_1.default.CLIGHTNING.SOCKET);
        case 'lnd':
        default:
            return new lnd_api_1.default();
    }
}
exports.default = lightningApiFactory();
