"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PRICES = void 0;
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const config_1 = __importDefault(require("../config"));
const price_updater_1 = __importDefault(require("../tasks/price-updater"));
const ApiPriceFields = config_1.default.FIAT_PRICE.API_KEY ?
    `
      UNIX_TIMESTAMP(time) as time,
      USD,
      EUR,
      GBP,
      CAD,
      CHF,
      AUD,
      JPY,
      BGN,
      BRL,
      CNY,
      CZK,
      DKK,
      HKD,
      HRK,
      HUF,
      IDR,
      ILS,
      INR,
      ISK,
      KRW,
      MXN,
      MYR,
      NOK,
      NZD,
      PHP,
      PLN,
      RON,
      RUB,
      SEK,
      SGD,
      THB,
      TRY,
      ZAR
    ` :
    `
      UNIX_TIMESTAMP(time) as time,
      USD,
      EUR,
      GBP,
      CAD,
      CHF,
      AUD,
      JPY
    `;
exports.MAX_PRICES = {
    USD: 100000000,
    EUR: 100000000,
    GBP: 100000000,
    CAD: 100000000,
    CHF: 100000000,
    AUD: 100000000,
    JPY: 10000000000,
    BGN: 1000000000,
    BRL: 1000000000,
    CNY: 1000000000,
    CZK: 10000000000,
    DKK: 1000000000,
    HKD: 1000000000,
    HRK: 1000000000,
    HUF: 10000000000,
    IDR: 100000000000,
    ILS: 1000000000,
    INR: 10000000000,
    ISK: 10000000000,
    KRW: 100000000000,
    MXN: 1000000000,
    MYR: 1000000000,
    NOK: 1000000000,
    NZD: 1000000000,
    PHP: 10000000000,
    PLN: 1000000000,
    RON: 1000000000,
    RUB: 10000000000,
    SEK: 1000000000,
    SGD: 100000000,
    THB: 10000000000,
    TRY: 10000000000,
    ZAR: 10000000000,
};
class PricesRepository {
    async $savePrices(time, prices) {
        if (prices.USD === -1) {
            // Some historical price entries have no USD prices, so we just ignore them to avoid future UX issues
            // As of today there are only 4 (on 2013-09-05, 2013-0909, 2013-09-12 and 2013-09-26) so that's fine
            return;
        }
        // Sanity check
        for (const currency of Object.keys(prices)) {
            if (prices[currency] < -1 || prices[currency] > exports.MAX_PRICES[currency]) { // We use -1 to mark a "missing data, so it's a valid entry"
                logger_1.default.info(`Ignore BTC${currency} price of ${prices[currency]}`);
                prices[currency] = 0;
            }
        }
        try {
            if (!config_1.default.FIAT_PRICE.API_KEY) { // Store only the 7 main currencies
                await database_1.default.query(`
          INSERT INTO prices(time,             USD, EUR, GBP, CAD, CHF, AUD, JPY)
          VALUE             (FROM_UNIXTIME(?), ?,   ?,   ?,   ?,   ?,   ?,   ?  )`, [time, prices.USD, prices.EUR, prices.GBP, prices.CAD, prices.CHF, prices.AUD, prices.JPY]);
            }
            else { // Store all 7 main currencies + all the currencies obtained with the external API
                await database_1.default.query(`
          INSERT INTO prices(time,             USD, EUR, GBP, CAD, CHF, AUD, JPY, BGN, BRL, CNY, CZK, DKK, HKD, HRK, HUF, IDR, ILS, INR, ISK, KRW, MXN, MYR, NOK, NZD, PHP, PLN, RON, RUB, SEK, SGD, THB, TRY, ZAR)
          VALUE             (FROM_UNIXTIME(?), ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?  , ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?  , ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?,   ?  , ?  )`, [time, prices.USD, prices.EUR, prices.GBP, prices.CAD, prices.CHF, prices.AUD, prices.JPY, prices.BGN, prices.BRL, prices.CNY, prices.CZK, prices.DKK,
                    prices.HKD, prices.HRK, prices.HUF, prices.IDR, prices.ILS, prices.INR, prices.ISK, prices.KRW, prices.MXN, prices.MYR, prices.NOK, prices.NZD,
                    prices.PHP, prices.PLN, prices.RON, prices.RUB, prices.SEK, prices.SGD, prices.THB, prices.TRY, prices.ZAR]);
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot save exchange rate into db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $saveAdditionalCurrencyPrices(time, prices, legacyCurrencies) {
        try {
            await database_1.default.query(`
        UPDATE prices
        SET BGN = ?, BRL = ?, CNY = ?, CZK = ?, DKK = ?, HKD = ?, HRK = ?, HUF = ?, IDR = ?, ILS = ?, INR = ?, ISK = ?, KRW = ?, MXN = ?, MYR = ?, NOK = ?, NZD = ?, PHP = ?, PLN = ?, RON = ?, RUB = ?, SEK = ?, SGD = ?, THB = ?, TRY = ?, ZAR = ?
        WHERE UNIX_TIMESTAMP(time) = ?`, [prices.BGN, prices.BRL, prices.CNY, prices.CZK, prices.DKK, prices.HKD, prices.HRK, prices.HUF, prices.IDR, prices.ILS, prices.INR, prices.ISK, prices.KRW, prices.MXN, prices.MYR, prices.NOK, prices.NZD, prices.PHP, prices.PLN, prices.RON, prices.RUB, prices.SEK, prices.SGD, prices.THB, prices.TRY, prices.ZAR, time]);
            for (const currency of legacyCurrencies) {
                await database_1.default.query(`
          UPDATE prices
          SET ${currency} = ?
          WHERE UNIX_TIMESTAMP(time) = ?`, [prices[currency], time]);
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot update exchange rate into db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /** @asyncUnsafe */
    async $getOldestPriceTime() {
        const [oldestRow] = await database_1.default.query(`
      SELECT UNIX_TIMESTAMP(time) AS time
      FROM prices
      ORDER BY time
      LIMIT 1
    `);
        return oldestRow[0] ? oldestRow[0].time : 0;
    }
    /** @asyncUnsafe */
    async $getLatestPriceId() {
        const [oldestRow] = await database_1.default.query(`
      SELECT id
      FROM prices
      ORDER BY time DESC
      LIMIT 1`);
        return oldestRow[0] ? oldestRow[0].id : null;
    }
    /** @asyncUnsafe */
    async $getLatestPriceTime() {
        const [oldestRow] = await database_1.default.query(`
      SELECT UNIX_TIMESTAMP(time) AS time
      FROM prices
      ORDER BY time DESC
      LIMIT 1`);
        return oldestRow[0] ? oldestRow[0].time : 0;
    }
    /** @asyncUnsafe */
    async $getPricesTimes() {
        const [times] = await database_1.default.query(`
      SELECT UNIX_TIMESTAMP(time) AS time
      FROM prices
      WHERE USD != -1
      ORDER BY time
    `);
        if (!Array.isArray(times)) {
            return [];
        }
        return times.map(time => time.time);
    }
    /** @asyncUnsafe */
    async $getPricesTimesWithMissingFields() {
        const [times] = await database_1.default.query(`
      SELECT UNIX_TIMESTAMP(time) AS time, 
             USD, 
             CASE WHEN EUR = -1 THEN TRUE ELSE FALSE END AS eur_missing,
             CASE WHEN GBP = -1 THEN TRUE ELSE FALSE END AS gbp_missing,
             CASE WHEN CAD = -1 THEN TRUE ELSE FALSE END AS cad_missing,
             CASE WHEN CHF = -1 THEN TRUE ELSE FALSE END AS chf_missing,
             CASE WHEN AUD = -1 THEN TRUE ELSE FALSE END AS aud_missing,
             CASE WHEN JPY = -1 THEN TRUE ELSE FALSE END AS jpy_missing
      FROM prices
      WHERE USD != -1 
      AND -1 IN (EUR, GBP, CAD, CHF, AUD, JPY, BGN, BRL, CNY, CZK, DKK, HKD, HRK, HUF, IDR, ILS, INR, ISK, KRW, 
                 MXN, MYR, NOK, NZD, PHP, PLN, RON, RUB, SEK, SGD, THB, TRY, ZAR)
      ORDER BY time DESC
    `);
        if (!Array.isArray(times)) {
            return [];
        }
        return times;
    }
    /** @asyncUnsafe */
    async $getPricesTimesAndId() {
        const [times] = await database_1.default.query(`
      SELECT
        UNIX_TIMESTAMP(time) AS time,
        id,
        USD
      FROM prices
      WHERE USD >= 0
      ORDER BY time
    `);
        return times;
    }
    /** @asyncUnsafe */
    async $getLatestConversionRates() {
        const [rates] = await database_1.default.query(`
      SELECT ${ApiPriceFields}
      FROM prices
      WHERE USD >= 0
      ORDER BY time DESC
      LIMIT 1`);
        if (!Array.isArray(rates) || rates.length === 0) {
            return price_updater_1.default.getEmptyPricesObj();
        }
        return rates[0];
    }
    /** @asyncSafe */
    async $getNearestHistoricalPrice(timestamp, currency) {
        try {
            const [rates] = await database_1.default.query(`
        SELECT ${ApiPriceFields}
        FROM prices
        WHERE UNIX_TIMESTAMP(time) <= ?
          AND USD >= 0
        ORDER BY time DESC
        LIMIT 1`, [timestamp]);
            if (!Array.isArray(rates)) {
                throw Error(`Cannot get single historical price from the database`);
            }
            const [latestPrices] = await database_1.default.query(`
        SELECT ${ApiPriceFields}
        FROM prices
        WHERE USD >= 0
        ORDER BY time DESC
        LIMIT 1
      `);
            if (!Array.isArray(latestPrices)) {
                throw Error(`Cannot get single historical price from the database`);
            }
            // Compute fiat exchange rates
            let latestPrice = latestPrices[0];
            if (!latestPrice || latestPrice.USD === -1) {
                latestPrice = price_updater_1.default.getEmptyPricesObj();
            }
            const computeFx = (usd, other) => usd <= 0.05 ? 0 : Math.round(Math.max(other, 0) / usd * 100) / 100;
            const exchangeRates = config_1.default.FIAT_PRICE.API_KEY ?
                {
                    USDEUR: computeFx(latestPrice.USD, latestPrice.EUR),
                    USDGBP: computeFx(latestPrice.USD, latestPrice.GBP),
                    USDCAD: computeFx(latestPrice.USD, latestPrice.CAD),
                    USDCHF: computeFx(latestPrice.USD, latestPrice.CHF),
                    USDAUD: computeFx(latestPrice.USD, latestPrice.AUD),
                    USDJPY: computeFx(latestPrice.USD, latestPrice.JPY),
                    USDBGN: computeFx(latestPrice.USD, latestPrice.BGN),
                    USDBRL: computeFx(latestPrice.USD, latestPrice.BRL),
                    USDCNY: computeFx(latestPrice.USD, latestPrice.CNY),
                    USDCZK: computeFx(latestPrice.USD, latestPrice.CZK),
                    USDDKK: computeFx(latestPrice.USD, latestPrice.DKK),
                    USDHKD: computeFx(latestPrice.USD, latestPrice.HKD),
                    USDHRK: computeFx(latestPrice.USD, latestPrice.HRK),
                    USDHUF: computeFx(latestPrice.USD, latestPrice.HUF),
                    USDIDR: computeFx(latestPrice.USD, latestPrice.IDR),
                    USDILS: computeFx(latestPrice.USD, latestPrice.ILS),
                    USDINR: computeFx(latestPrice.USD, latestPrice.INR),
                    USDISK: computeFx(latestPrice.USD, latestPrice.ISK),
                    USDKRW: computeFx(latestPrice.USD, latestPrice.KRW),
                    USDMXN: computeFx(latestPrice.USD, latestPrice.MXN),
                    USDMYR: computeFx(latestPrice.USD, latestPrice.MYR),
                    USDNOK: computeFx(latestPrice.USD, latestPrice.NOK),
                    USDNZD: computeFx(latestPrice.USD, latestPrice.NZD),
                    USDPHP: computeFx(latestPrice.USD, latestPrice.PHP),
                    USDPLN: computeFx(latestPrice.USD, latestPrice.PLN),
                    USDRON: computeFx(latestPrice.USD, latestPrice.RON),
                    USDRUB: computeFx(latestPrice.USD, latestPrice.RUB),
                    USDSEK: computeFx(latestPrice.USD, latestPrice.SEK),
                    USDSGD: computeFx(latestPrice.USD, latestPrice.SGD),
                    USDTHB: computeFx(latestPrice.USD, latestPrice.THB),
                    USDTRY: computeFx(latestPrice.USD, latestPrice.TRY),
                    USDZAR: computeFx(latestPrice.USD, latestPrice.ZAR),
                } : {
                USDEUR: computeFx(latestPrice.USD, latestPrice.EUR),
                USDGBP: computeFx(latestPrice.USD, latestPrice.GBP),
                USDCAD: computeFx(latestPrice.USD, latestPrice.CAD),
                USDCHF: computeFx(latestPrice.USD, latestPrice.CHF),
                USDAUD: computeFx(latestPrice.USD, latestPrice.AUD),
                USDJPY: computeFx(latestPrice.USD, latestPrice.JPY),
            };
            if (currency) {
                if (!latestPrice[currency]) {
                    return null;
                }
                const filteredRates = rates.map((rate) => {
                    return {
                        time: rate.time,
                        [currency]: rate[currency],
                        ['USD']: rate['USD']
                    };
                });
                if (filteredRates.length === 0) { // No price data before 2010-07-19: add a fake entry
                    filteredRates.push({
                        time: 1279497600,
                        [currency]: 0,
                        ['USD']: 0
                    });
                }
                return {
                    prices: filteredRates,
                    exchangeRates: exchangeRates
                };
            }
            return {
                prices: rates,
                exchangeRates: exchangeRates
            };
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch single historical prices from the db. Reason ${e instanceof Error ? e.message : e}`);
            return null;
        }
    }
    /** @asyncSafe */
    async $getHistoricalPrices(currency) {
        try {
            const [rates] = await database_1.default.query(`
        SELECT ${ApiPriceFields}
        FROM prices
        WHERE USD >= 0
        ORDER BY time DESC
      `);
            if (!Array.isArray(rates)) {
                throw Error(`Cannot get average historical price from the database`);
            }
            // Compute fiat exchange rates
            let latestPrice = rates[0];
            if (latestPrice.USD === -1) {
                latestPrice = price_updater_1.default.getEmptyPricesObj();
            }
            const computeFx = (usd, other) => usd <= 0 ? 0 : Math.round(Math.max(other, 0) / usd * 100) / 100;
            const exchangeRates = config_1.default.FIAT_PRICE.API_KEY ?
                {
                    USDEUR: computeFx(latestPrice.USD, latestPrice.EUR),
                    USDGBP: computeFx(latestPrice.USD, latestPrice.GBP),
                    USDCAD: computeFx(latestPrice.USD, latestPrice.CAD),
                    USDCHF: computeFx(latestPrice.USD, latestPrice.CHF),
                    USDAUD: computeFx(latestPrice.USD, latestPrice.AUD),
                    USDJPY: computeFx(latestPrice.USD, latestPrice.JPY),
                    USDBGN: computeFx(latestPrice.USD, latestPrice.BGN),
                    USDBRL: computeFx(latestPrice.USD, latestPrice.BRL),
                    USDCNY: computeFx(latestPrice.USD, latestPrice.CNY),
                    USDCZK: computeFx(latestPrice.USD, latestPrice.CZK),
                    USDDKK: computeFx(latestPrice.USD, latestPrice.DKK),
                    USDHKD: computeFx(latestPrice.USD, latestPrice.HKD),
                    USDHRK: computeFx(latestPrice.USD, latestPrice.HRK),
                    USDHUF: computeFx(latestPrice.USD, latestPrice.HUF),
                    USDIDR: computeFx(latestPrice.USD, latestPrice.IDR),
                    USDILS: computeFx(latestPrice.USD, latestPrice.ILS),
                    USDINR: computeFx(latestPrice.USD, latestPrice.INR),
                    USDISK: computeFx(latestPrice.USD, latestPrice.ISK),
                    USDKRW: computeFx(latestPrice.USD, latestPrice.KRW),
                    USDMXN: computeFx(latestPrice.USD, latestPrice.MXN),
                    USDMYR: computeFx(latestPrice.USD, latestPrice.MYR),
                    USDNOK: computeFx(latestPrice.USD, latestPrice.NOK),
                    USDNZD: computeFx(latestPrice.USD, latestPrice.NZD),
                    USDPHP: computeFx(latestPrice.USD, latestPrice.PHP),
                    USDPLN: computeFx(latestPrice.USD, latestPrice.PLN),
                    USDRON: computeFx(latestPrice.USD, latestPrice.RON),
                    USDRUB: computeFx(latestPrice.USD, latestPrice.RUB),
                    USDSEK: computeFx(latestPrice.USD, latestPrice.SEK),
                    USDSGD: computeFx(latestPrice.USD, latestPrice.SGD),
                    USDTHB: computeFx(latestPrice.USD, latestPrice.THB),
                    USDTRY: computeFx(latestPrice.USD, latestPrice.TRY),
                    USDZAR: computeFx(latestPrice.USD, latestPrice.ZAR),
                } : {
                USDEUR: computeFx(latestPrice.USD, latestPrice.EUR),
                USDGBP: computeFx(latestPrice.USD, latestPrice.GBP),
                USDCAD: computeFx(latestPrice.USD, latestPrice.CAD),
                USDCHF: computeFx(latestPrice.USD, latestPrice.CHF),
                USDAUD: computeFx(latestPrice.USD, latestPrice.AUD),
                USDJPY: computeFx(latestPrice.USD, latestPrice.JPY),
            };
            if (currency) {
                if (!latestPrice[currency]) {
                    return null;
                }
                const filteredRates = rates.map((rate) => {
                    return {
                        time: rate.time,
                        [currency]: rate[currency],
                        ['USD']: rate['USD']
                    };
                });
                return {
                    prices: filteredRates,
                    exchangeRates: exchangeRates
                };
            }
            return {
                prices: rates,
                exchangeRates: exchangeRates
            };
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch historical prices from the db. Reason ${e instanceof Error ? e.message : e}`);
            return null;
        }
    }
}
exports.default = new PricesRepository();
