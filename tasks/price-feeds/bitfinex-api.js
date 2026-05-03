"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_query_1 = require("../../utils/axios-query");
const price_updater_1 = __importDefault(require("../price-updater"));
class BitfinexApi {
    name = 'Bitfinex';
    currencies = ['USD', 'EUR', 'GBP'];
    url = 'https://api.bitfinex.com/v1/pubticker/BTC';
    urlHist = 'https://api-pub.bitfinex.com/v2/candles/trade:{GRANULARITY}:tBTC{CURRENCY}/hist';
    /** @asyncUnsafe */
    async $fetchPrice(currency) {
        const response = await (0, axios_query_1.query)(this.url + currency);
        if (response && response['last_price']) {
            return parseInt(response['last_price'], 10);
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
            const response = await (0, axios_query_1.query)(this.urlHist.replace('{GRANULARITY}', type === 'hour' ? '1h' : '1D').replace('{CURRENCY}', currency));
            const pricesRaw = response ? response : [];
            for (const price of pricesRaw) {
                const time = Math.round(price[0] / 1000);
                if (priceHistory[time] === undefined) {
                    priceHistory[time] = price_updater_1.default.getEmptyPricesObj();
                }
                priceHistory[time][currency] = price[2];
            }
        }
        return priceHistory;
    }
}
exports.default = BitfinexApi;
