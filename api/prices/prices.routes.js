"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const price_updater_1 = __importDefault(require("../../tasks/price-updater"));
class PricesRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'prices', this.$getCurrentPrices.bind(this));
    }
    $getCurrentPrices(req, res) {
        res.header('Pragma', 'public');
        res.header('Cache-control', 'public');
        res.setHeader('Expires', new Date(Date.now() + 360_0000 / config_1.default.MEMPOOL.PRICE_UPDATES_PER_HOUR).toUTCString());
        res.json(price_updater_1.default.getLatestPrices());
    }
}
exports.default = new PricesRoutes();
