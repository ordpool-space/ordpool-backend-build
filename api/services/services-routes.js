"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const wallets_1 = __importDefault(require("./wallets"));
const api_1 = require("../../utils/api");
class ServicesRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'wallet/:walletId', this.$getWallet)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'treasuries', this.$getTreasuries);
    }
    async $getWallet(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 5).toUTCString());
            const walletId = req.params.walletId;
            const wallet = await wallets_1.default.getWallet(walletId);
            if (wallet === null) {
                res.status(404).send('No such wallet');
            }
            else {
                res.status(200).send(wallet);
            }
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get wallet');
        }
    }
    async $getTreasuries(req, res) {
        try {
            const treasuries = await wallets_1.default.getTreasuries();
            res.status(200).send(treasuries);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get treasuries');
        }
    }
}
exports.default = new ServicesRoutes();
