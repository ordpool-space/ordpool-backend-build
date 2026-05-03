"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios_query_1 = require("../../utils/axios-query");
class BitflyerApi {
    name = 'Bitflyer';
    currencies = ['USD', 'EUR', 'JPY'];
    url = 'https://api.bitflyer.com/v1/ticker?product_code=BTC_';
    urlHist = '';
    constructor() {
    }
    /** @asyncUnsafe */
    async $fetchPrice(currency) {
        const response = await (0, axios_query_1.query)(this.url + currency);
        if (response && response['ltp']) {
            return parseInt(response['ltp'], 10);
        }
        else {
            return -1;
        }
    }
    async $fetchRecentPrice(currencies, type) {
        return [];
    }
}
exports.default = BitflyerApi;
