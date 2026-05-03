"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../../logger"));
const PricesRepository_1 = __importDefault(require("../../repositories/PricesRepository"));
const axios_query_1 = require("../../utils/axios-query");
const price_updater_1 = __importDefault(require("../price-updater"));
class KrakenApi {
    name = 'Kraken';
    currencies = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];
    url = 'https://api.kraken.com/0/public/Ticker?pair=XBT';
    urlHist = 'https://api.kraken.com/0/public/OHLC?interval={GRANULARITY}&pair=XBT';
    constructor() {
    }
    getTicker(currency) {
        let ticker = `XXBTZ${currency}`;
        if (['CHF', 'AUD'].includes(currency)) {
            ticker = `XBT${currency}`;
        }
        return ticker;
    }
    /** @asyncUnsafe */
    async $fetchPrice(currency) {
        const response = await (0, axios_query_1.query)(this.url + currency);
        const ticker = this.getTicker(currency);
        if (response && response['result'] && response['result'][ticker] &&
            response['result'][ticker]['c'] && response['result'][ticker]['c'].length > 0) {
            return parseInt(response['result'][ticker]['c'][0], 10);
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
            const response = await (0, axios_query_1.query)(this.urlHist.replace('{GRANULARITY}', '60') + currency);
            const pricesRaw = response ? response['result'][this.getTicker(currency)] : [];
            for (const price of pricesRaw) {
                if (priceHistory[price[0]] === undefined) {
                    priceHistory[price[0]] = price_updater_1.default.getEmptyPricesObj();
                }
                priceHistory[price[0]][currency] = price[4];
            }
        }
        return priceHistory;
    }
    /**
     * Fetch weekly price and save it into the database
     * @asyncUnsafe
     */
    async $insertHistoricalPrice() {
        const existingPriceTimes = await PricesRepository_1.default.$getPricesTimes();
        // EUR weekly price history goes back to timestamp 1378339200 (September 5, 2013)
        // USD weekly price history goes back to timestamp 1380758400 (October 3, 2013)
        // GBP weekly price history goes back to timestamp 1415232000 (November 6, 2014)
        // JPY weekly price history goes back to timestamp 1415232000 (November 6, 2014)
        // CAD weekly price history goes back to timestamp 1436400000 (July 9, 2015)
        // CHF weekly price history goes back to timestamp 1575504000 (December 5, 2019)
        // AUD weekly price history goes back to timestamp 1591833600 (June 11, 2020)
        const priceHistory = {}; // map: timestamp -> Prices
        for (const currency of this.currencies) {
            const response = await (0, axios_query_1.query)(this.urlHist.replace('{GRANULARITY}', '10080') + currency);
            const priceHistoryRaw = response ? response['result'][this.getTicker(currency)] : [];
            for (const price of priceHistoryRaw) {
                if (existingPriceTimes.includes(parseInt(price[0]))) {
                    continue;
                }
                // prices[0] = kraken price timestamp
                // prices[4] = closing price
                if (priceHistory[price[0]] === undefined) {
                    priceHistory[price[0]] = price_updater_1.default.getEmptyPricesObj();
                }
                priceHistory[price[0]][currency] = price[4];
            }
        }
        for (const time in priceHistory) {
            if (priceHistory[time].USD === -1) {
                delete priceHistory[time];
                continue;
            }
            await PricesRepository_1.default.$savePrices(parseInt(time, 10), priceHistory[time]);
        }
        if (Object.keys(priceHistory).length > 0) {
            logger_1.default.info(`Inserted ${Object.keys(priceHistory).length} Kraken EUR, USD, GBP, JPY, CAD, CHF and AUD weekly price history into db`, logger_1.default.tags.mining);
        }
    }
}
exports.default = KrakenApi;
