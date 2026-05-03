"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_query_1 = require("../../utils/axios-query");
const price_updater_1 = __importDefault(require("../price-updater"));
class CoinbaseApi {
    name = 'Coinbase';
    currencies = ['USD', 'EUR', 'GBP'];
    url = 'https://api.coinbase.com/v2/prices/BTC-{CURRENCY}/spot';
    urlHist = 'https://api.exchange.coinbase.com/products/BTC-{CURRENCY}/candles?granularity={GRANULARITY}';
    constructor() {
    }
    /** @asyncUnsafe */
    async $fetchPrice(currency) {
        const response = await (0, axios_query_1.query)(this.url.replace('{CURRENCY}', currency));
        if (response && response['data'] && response['data']['amount']) {
            return parseInt(response['data']['amount'], 10);
        }
        else {
            return -1;
        }
    }
    /** @asyncUnsafe */
    async $fetchRecentPrice(currencies, type) {
        const priceHistory = {};
        for (const currency of currencies) {
            if (this.currencies.includes(currency) === false) {
                continue;
            }
            const response = await (0, axios_query_1.query)(this.urlHist.replace('{GRANULARITY}', type === 'hour' ? '3600' : '86400').replace('{CURRENCY}', currency));
            const pricesRaw = response ? response : [];
            for (const price of pricesRaw) {
                if (priceHistory[price[0]] === undefined) {
                    priceHistory[price[0]] = price_updater_1.default.getEmptyPricesObj();
                }
                priceHistory[price[0]][currency] = price[4];
            }
        }
        return priceHistory;
    }
}
exports.default = CoinbaseApi;
