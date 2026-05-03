"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const axios_query_1 = require("../../utils/axios-query");
const emptyRates = {
    AUD: -1,
    BGN: -1,
    BRL: -1,
    CAD: -1,
    CHF: -1,
    CNY: -1,
    CZK: -1,
    DKK: -1,
    EUR: -1,
    GBP: -1,
    HKD: -1,
    HRK: -1,
    HUF: -1,
    IDR: -1,
    ILS: -1,
    INR: -1,
    ISK: -1,
    JPY: -1,
    KRW: -1,
    MXN: -1,
    MYR: -1,
    NOK: -1,
    NZD: -1,
    PHP: -1,
    PLN: -1,
    RON: -1,
    RUB: -1,
    SEK: -1,
    SGD: -1,
    THB: -1,
    TRY: -1,
    USD: -1,
    ZAR: -1,
};
class FreeCurrencyApi {
    API_KEY = config_1.default.FIAT_PRICE.API_KEY;
    PAID = config_1.default.FIAT_PRICE.PAID;
    API_URL_PREFIX = this.PAID ? `https://api.currencyapi.com/v3/` : `https://api.freecurrencyapi.com/v1/`;
    constructor() { }
    /** @asyncUnsafe */
    async $getQuota() {
        const response = await (0, axios_query_1.query)(`${this.API_URL_PREFIX}status?apikey=${this.API_KEY}`);
        if (response && response['quotas']) {
            return response['quotas'];
        }
        return null;
    }
    /** @asyncUnsafe */
    async $fetchLatestConversionRates() {
        const response = await (0, axios_query_1.query)(`${this.API_URL_PREFIX}latest?apikey=${this.API_KEY}`);
        if (response && response['data']) {
            if (this.PAID) {
                response['data'] = this.convertData(response['data']);
            }
            return response['data'];
        }
        return emptyRates;
    }
    /** @asyncUnsafe */
    async $fetchConversionRates(date) {
        const response = await (0, axios_query_1.query)(`${this.API_URL_PREFIX}historical?date=${date}&apikey=${this.API_KEY}`, true);
        if (response && response['data'] && (response['data'][date] || this.PAID)) {
            if (this.PAID) {
                response['data'] = this.convertData(response['data']);
                response['data'][response['meta'].last_updated_at.substr(0, 10)] = response['data'];
            }
            return response['data'][date];
        }
        return emptyRates;
    }
    convertData(data) {
        const simplifiedData = {};
        for (const key in data) {
            simplifiedData[key] = data[key].value;
        }
        return simplifiedData;
    }
}
exports.default = FreeCurrencyApi;
