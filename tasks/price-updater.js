"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../logger"));
const PricesRepository_1 = __importStar(require("../repositories/PricesRepository"));
const bitfinex_api_1 = __importDefault(require("./price-feeds/bitfinex-api"));
const bitflyer_api_1 = __importDefault(require("./price-feeds/bitflyer-api"));
const coinbase_api_1 = __importDefault(require("./price-feeds/coinbase-api"));
const gemini_api_1 = __importDefault(require("./price-feeds/gemini-api"));
const kraken_api_1 = __importDefault(require("./price-feeds/kraken-api"));
const free_currency_api_1 = __importDefault(require("./price-feeds/free-currency-api"));
function getMedian(arr) {
    const sortedArr = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sortedArr.length / 2);
    return sortedArr.length % 2 !== 0
        ? sortedArr[mid]
        : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}
class PriceUpdater {
    historyInserted = false;
    additionalCurrenciesHistoryInserted = false;
    additionalCurrenciesHistoryRunning = false;
    lastFailedHistoricalRun = 0;
    timeBetweenUpdatesMs = 360_0000 / config_1.default.MEMPOOL.PRICE_UPDATES_PER_HOUR;
    cyclePosition = -1;
    firstRun = true;
    lastTime = -1;
    lastHistoricalRun = 0;
    running = false;
    feeds = [];
    currencies = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];
    latestPrices;
    latestGoodPrices;
    currencyConversionFeed;
    newCurrencies = ['BGN', 'BRL', 'CNY', 'CZK', 'DKK', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR'];
    lastTimeConversionsRatesFetched = 0;
    latestConversionsRatesFromFeed = { USD: -1 };
    ratesChangedCallback;
    constructor() {
        this.latestPrices = this.getEmptyPricesObj();
        this.latestGoodPrices = this.getEmptyPricesObj();
        this.feeds.push(new bitflyer_api_1.default()); // Does not have historical endpoint
        this.feeds.push(new kraken_api_1.default());
        this.feeds.push(new coinbase_api_1.default());
        this.feeds.push(new bitfinex_api_1.default());
        this.feeds.push(new gemini_api_1.default());
        this.currencyConversionFeed = new free_currency_api_1.default();
        this.setCyclePosition();
    }
    getLatestPrices() {
        return this.latestGoodPrices;
    }
    getEmptyPricesObj() {
        return {
            time: 0,
            USD: -1,
            EUR: -1,
            GBP: -1,
            CAD: -1,
            CHF: -1,
            AUD: -1,
            JPY: -1,
            BGN: -1,
            BRL: -1,
            CNY: -1,
            CZK: -1,
            DKK: -1,
            HKD: -1,
            HRK: -1,
            HUF: -1,
            IDR: -1,
            ILS: -1,
            INR: -1,
            ISK: -1,
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
            ZAR: -1,
        };
    }
    setRatesChangedCallback(fn) {
        this.ratesChangedCallback = fn;
    }
    /**
     * We execute this function before the websocket initialization since
     * the websocket init is not done asyncronously
     *
     * @asyncUnsafe
     */
    async $initializeLatestPriceWithDb() {
        this.latestPrices = await PricesRepository_1.default.$getLatestConversionRates();
        this.latestGoodPrices = JSON.parse(JSON.stringify(this.latestPrices));
    }
    /** @asyncSafe */
    async $run() {
        if (['testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
            // Coins have no value on testnet/signet, so we want to always show 0
            return;
        }
        if (this.running === true) {
            return;
        }
        this.running = true;
        if ((Math.round(new Date().getTime() / 1000) - this.lastHistoricalRun) > 3600 * 24) {
            // Once a day, look for missing prices (could happen due to network connectivity issues)
            this.historyInserted = false;
            this.additionalCurrenciesHistoryInserted = false;
        }
        if (this.lastFailedHistoricalRun > 0 && (Math.round(new Date().getTime() / 1000) - this.lastFailedHistoricalRun) > 60) {
            // If the last attempt to insert missing prices failed, we try again after 60 seconds
            this.additionalCurrenciesHistoryInserted = false;
        }
        if (config_1.default.FIAT_PRICE.API_KEY && this.currencyConversionFeed && (Math.round(new Date().getTime() / 1000) - this.lastTimeConversionsRatesFetched) > 3600 * 24) {
            // Once a day, fetch conversion rates from api: we don't need more granularity for fiat currencies and have a limited number of requests
            try {
                this.latestConversionsRatesFromFeed = await this.currencyConversionFeed.$fetchLatestConversionRates();
                this.lastTimeConversionsRatesFetched = Math.round(new Date().getTime() / 1000);
                logger_1.default.debug(`Fetched currencies conversion rates from conversions API: ${JSON.stringify(this.latestConversionsRatesFromFeed)}`);
            }
            catch (e) {
                logger_1.default.err(`Cannot fetch conversion rates from conversions API. Reason: ${(e instanceof Error ? e.message : e)}`);
            }
        }
        try {
            await this.$updatePrice();
            if (this.historyInserted === false && config_1.default.DATABASE.ENABLED === true) {
                await this.$insertHistoricalPrices();
            }
            if (this.additionalCurrenciesHistoryInserted === false && config_1.default.DATABASE.ENABLED === true && config_1.default.FIAT_PRICE.API_KEY && !this.additionalCurrenciesHistoryRunning) {
                await this.$insertMissingAdditionalPrices();
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot save BTC prices in db. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
        }
        this.running = false;
    }
    setLatestPrice(currency, price) {
        this.latestPrices[currency] = price;
        if (price > 0) {
            this.latestGoodPrices[currency] = price;
            this.latestGoodPrices.time = Math.round(new Date().getTime() / 1000);
        }
    }
    getMillisecondsSinceBeginningOfHour() {
        const now = new Date();
        const beginningOfHour = new Date(now);
        beginningOfHour.setMinutes(0, 0, 0);
        return now.getTime() - beginningOfHour.getTime();
    }
    setCyclePosition() {
        const millisecondsSinceBeginningOfHour = this.getMillisecondsSinceBeginningOfHour();
        for (let i = 0; i < config_1.default.MEMPOOL.PRICE_UPDATES_PER_HOUR; i++) {
            if (this.timeBetweenUpdatesMs * i > millisecondsSinceBeginningOfHour) {
                this.cyclePosition = i;
                return;
            }
        }
        this.cyclePosition = config_1.default.MEMPOOL.PRICE_UPDATES_PER_HOUR;
    }
    /**
     * Fetch last BTC price from exchanges, average them, and save it in the database once every hour
     * @asyncUnsafe
     */
    async $updatePrice() {
        let forceUpdate = false;
        if (this.firstRun === true && config_1.default.DATABASE.ENABLED === true) {
            const lastUpdate = await PricesRepository_1.default.$getLatestPriceTime();
            if (new Date().getTime() / 1000 - lastUpdate > this.timeBetweenUpdatesMs / 1000) {
                forceUpdate = true;
            }
            this.firstRun = false;
        }
        const millisecondsSinceBeginningOfHour = this.getMillisecondsSinceBeginningOfHour();
        // Reset the cycle on new hour
        if (this.lastTime > millisecondsSinceBeginningOfHour) {
            this.cyclePosition = 0;
        }
        this.lastTime = millisecondsSinceBeginningOfHour;
        if (millisecondsSinceBeginningOfHour < this.timeBetweenUpdatesMs * this.cyclePosition && !forceUpdate && this.cyclePosition !== 0) {
            return;
        }
        for (const currency of this.currencies) {
            let prices = [];
            for (const feed of this.feeds) {
                // Fetch prices from API which supports `currency`
                if (feed.currencies.includes(currency)) {
                    try {
                        const price = await feed.$fetchPrice(currency);
                        if (price > -1 && price < PricesRepository_1.MAX_PRICES[currency]) {
                            prices.push(price);
                        }
                        logger_1.default.debug(`${feed.name} BTC/${currency} price: ${price}`, logger_1.default.tags.mining);
                    }
                    catch (e) {
                        logger_1.default.debug(`Could not fetch BTC/${currency} price at ${feed.name}. Reason: ${(e instanceof Error ? e.message : e)}`, logger_1.default.tags.mining);
                    }
                }
            }
            if (prices.length === 1) {
                logger_1.default.debug(`Only ${prices.length} feed available for BTC/${currency} price`, logger_1.default.tags.mining);
            }
            // Compute average price, non weighted
            prices = prices.filter(price => price > 0);
            if (prices.length === 0) {
                this.setLatestPrice(currency, -1);
            }
            else {
                this.setLatestPrice(currency, Math.round(getMedian(prices)));
            }
        }
        if (config_1.default.FIAT_PRICE.API_KEY && this.latestPrices.USD > 0 && Object.keys(this.latestConversionsRatesFromFeed).length > 0) {
            for (const conversionCurrency of this.newCurrencies) {
                if (this.latestConversionsRatesFromFeed[conversionCurrency] > 0 && this.latestPrices.USD * this.latestConversionsRatesFromFeed[conversionCurrency] < PricesRepository_1.MAX_PRICES[conversionCurrency]) {
                    this.setLatestPrice(conversionCurrency, Math.round(this.latestPrices.USD * this.latestConversionsRatesFromFeed[conversionCurrency]));
                }
            }
        }
        if (config_1.default.DATABASE.ENABLED === true && this.cyclePosition === 0) {
            // Save everything in db
            try {
                const p = 60 * 60 * 1000; // milliseconds in an hour
                const nowRounded = new Date(Math.round(new Date().getTime() / p) * p); // https://stackoverflow.com/a/28037042
                await PricesRepository_1.default.$savePrices(nowRounded.getTime() / 1000, this.latestPrices);
            }
            catch (e) {
                logger_1.default.err(`Cannot save latest prices into db. Trying again in 5 minutes. Reason: ${(e instanceof Error ? e.message : e)}`);
            }
        }
        this.latestPrices.time = Math.round(new Date().getTime() / 1000);
        if (!forceUpdate) {
            this.cyclePosition++;
        }
        if (this.latestPrices.USD === -1) {
            logger_1.default.warn(`No BTC price available, falling back to latest known price: ${JSON.stringify(this.latestGoodPrices)}`);
        }
        else {
            logger_1.default.info(`Latest BTC fiat averaged price: ${JSON.stringify(this.latestGoodPrices)}`);
        }
        if (this.ratesChangedCallback && this.latestGoodPrices.USD > 0) {
            this.ratesChangedCallback(this.latestGoodPrices);
        }
    }
    /**
     * Called once by the database migration to initialize historical prices data (weekly)
     * We use MtGox weekly price from July 19, 2010 to September 30, 2013
     * We use Kraken weekly price from October 3, 2013 up to last month
     * We use Kraken hourly price for the past month
     *
     * @asyncUnsafe
     */
    async $insertHistoricalPrices() {
        const existingPriceTimes = await PricesRepository_1.default.$getPricesTimes();
        // Insert MtGox weekly prices
        const pricesJson = JSON.parse(fs.readFileSync(path_1.default.join(__dirname, 'mtgox-weekly.json')).toString());
        const prices = this.getEmptyPricesObj();
        let insertedCount = 0;
        for (const price of pricesJson) {
            if (existingPriceTimes.includes(price['ct'])) {
                continue;
            }
            // From 1380758400 we will use Kraken price as it follows closely MtGox, but was not affected as much
            // by the MtGox exchange collapse a few months later
            if (price['ct'] > 1380758400) {
                break;
            }
            prices.USD = price['c'];
            await PricesRepository_1.default.$savePrices(price['ct'], prices);
            ++insertedCount;
        }
        if (insertedCount > 0) {
            logger_1.default.notice(`Inserted ${insertedCount} MtGox USD weekly price history into db`, logger_1.default.tags.mining);
        }
        else {
            logger_1.default.debug(`Inserted ${insertedCount} MtGox USD weekly price history into db`, logger_1.default.tags.mining);
        }
        // Insert Kraken weekly prices
        await new kraken_api_1.default().$insertHistoricalPrice();
        // Insert missing recent hourly prices
        await this.$insertMissingRecentPrices('day');
        await this.$insertMissingRecentPrices('hour');
        this.historyInserted = true;
        this.lastHistoricalRun = Math.round(new Date().getTime() / 1000);
    }
    /**
     * Find missing hourly prices and insert them in the database
     * It has a limited backward range and it depends on which API are available
     *
     * @asyncUnsafe
     */
    async $insertMissingRecentPrices(type) {
        const existingPriceTimes = await PricesRepository_1.default.$getPricesTimes();
        logger_1.default.debug(`Fetching ${type === 'day' ? 'dai' : 'hour'}ly price history from exchanges and saving missing ones into the database`, logger_1.default.tags.mining);
        const historicalPrices = [];
        // Fetch all historical hourly prices
        for (const feed of this.feeds) {
            try {
                historicalPrices.push(await feed.$fetchRecentPrice(this.currencies, type));
            }
            catch (e) {
                logger_1.default.err(`Cannot fetch hourly historical price from ${feed.name}. Ignoring this feed. Reason: ${e instanceof Error ? e.message : e}`, logger_1.default.tags.mining);
            }
        }
        // Group them by timestamp and currency, for example
        // grouped[123456789]['USD'] = [1, 2, 3, 4];
        const grouped = {};
        for (const historicalEntry of historicalPrices) {
            for (const time in historicalEntry) {
                if (existingPriceTimes.includes(parseInt(time, 10))) {
                    continue;
                }
                if (grouped[time] === undefined) {
                    grouped[time] = {
                        USD: [], EUR: [], GBP: [], CAD: [], CHF: [], AUD: [], JPY: []
                    };
                }
                for (const currency of this.currencies) {
                    const price = historicalEntry[time][currency];
                    if (price > -1 && price < PricesRepository_1.MAX_PRICES[currency]) {
                        grouped[time][currency].push(typeof price === 'string' ? parseInt(price, 10) : price);
                    }
                }
            }
        }
        // Average prices and insert everything into the db
        let totalInserted = 0;
        for (const time in grouped) {
            const prices = this.getEmptyPricesObj();
            for (const currency in grouped[time]) {
                if (grouped[time][currency].length === 0) {
                    continue;
                }
                prices[currency] = Math.round(getMedian(grouped[time][currency]));
            }
            await PricesRepository_1.default.$savePrices(parseInt(time, 10), prices);
            ++totalInserted;
        }
        if (totalInserted > 0) {
            logger_1.default.notice(`Inserted ${totalInserted} ${type === 'day' ? 'dai' : 'hour'}ly historical prices into the db`, logger_1.default.tags.mining);
        }
        else {
            logger_1.default.debug(`Inserted ${totalInserted} ${type === 'day' ? 'dai' : 'hour'}ly historical prices into the db`, logger_1.default.tags.mining);
        }
    }
    /**
     * Find missing prices for additional currencies and insert them in the database
     * We calculate the additional prices from the USD price and the conversion rates
     *
     * @asyncUnsafe
     */
    async $insertMissingAdditionalPrices() {
        this.lastFailedHistoricalRun = 0;
        const priceTimesToFill = await PricesRepository_1.default.$getPricesTimesWithMissingFields();
        if (priceTimesToFill.length === 0) {
            return;
        }
        try {
            const remainingQuota = await this.currencyConversionFeed?.$getQuota();
            if (remainingQuota['month']['remaining'] < 500) { // We need some calls left for the daily updates
                logger_1.default.debug(`Not enough conversions API credit to insert missing prices in ${priceTimesToFill.length} rows (${remainingQuota['month']['remaining']} calls left).`, logger_1.default.tags.mining);
                this.additionalCurrenciesHistoryInserted = true; // Do not try again until next day
                return;
            }
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch conversions API credit, insertion of missing prices aborted. Reason: ${(e instanceof Error ? e.message : e)}`);
            return;
        }
        this.additionalCurrenciesHistoryRunning = true;
        logger_1.default.debug(`Inserting missing historical conversion rates using conversions API to fill ${priceTimesToFill.length} rows`, logger_1.default.tags.mining);
        const conversionRates = {};
        let totalInserted = 0;
        for (let i = 0; i < priceTimesToFill.length; i++) {
            const priceTime = priceTimesToFill[i];
            const missingLegacyCurrencies = this.getMissingLegacyCurrencies(priceTime); // In the case a legacy currency (EUR, GBP, CAD, CHF, AUD, JPY)
            const year = new Date(priceTime.time * 1000).getFullYear(); // is missing, we use the same process as for the new currencies
            const month = new Date(priceTime.time * 1000).getMonth();
            const yearMonthTimestamp = new Date(year, month, 1).getTime() / 1000;
            if (conversionRates[yearMonthTimestamp] === undefined) {
                try {
                    if (year === new Date().getFullYear() && month === new Date().getMonth()) { // For rows in the current month, we use the latest conversion rates
                        conversionRates[yearMonthTimestamp] = this.latestConversionsRatesFromFeed;
                    }
                    else {
                        conversionRates[yearMonthTimestamp] = await this.currencyConversionFeed?.$fetchConversionRates(`${year}-${month + 1 < 10 ? `0${month + 1}` : `${month + 1}`}-15`) || { USD: -1 };
                    }
                    if (conversionRates[yearMonthTimestamp]['USD'] < 0) {
                        throw new Error('Incorrect USD conversion rate');
                    }
                }
                catch (e) {
                    if ((e instanceof Error ? e.message : '').includes('429')) { // Continue 60 seconds later if and only if error is 429
                        this.lastFailedHistoricalRun = Math.round(new Date().getTime() / 1000);
                        logger_1.default.info(`Got a 429 error from conversions API. This is expected to happen a few times during the initial historical price insertion, process will resume in 60 seconds.`, logger_1.default.tags.mining);
                    }
                    else {
                        logger_1.default.err(`Cannot fetch conversion rates from conversions API for ${year}-${month + 1 < 10 ? `0${month + 1}` : `${month + 1}`}-01, trying again next day. Error: ${(e instanceof Error ? e.message : e)}`, logger_1.default.tags.mining);
                    }
                    break;
                }
            }
            const prices = this.getEmptyPricesObj();
            let willInsert = false;
            for (const conversionCurrency of this.newCurrencies.concat(missingLegacyCurrencies)) {
                if (conversionRates[yearMonthTimestamp][conversionCurrency] > 0 && priceTime.USD * conversionRates[yearMonthTimestamp][conversionCurrency] < PricesRepository_1.MAX_PRICES[conversionCurrency]) {
                    prices[conversionCurrency] = year >= 2013 ? Math.round(priceTime.USD * conversionRates[yearMonthTimestamp][conversionCurrency]) : Math.round(priceTime.USD * conversionRates[yearMonthTimestamp][conversionCurrency] * 100) / 100;
                    willInsert = true;
                }
                else {
                    prices[conversionCurrency] = 0;
                }
            }
            if (willInsert) {
                await PricesRepository_1.default.$saveAdditionalCurrencyPrices(priceTime.time, prices, missingLegacyCurrencies);
                ++totalInserted;
            }
        }
        logger_1.default.debug(`Inserted ${totalInserted} missing additional currency prices into the db`, logger_1.default.tags.mining);
        this.additionalCurrenciesHistoryInserted = true;
        this.additionalCurrenciesHistoryRunning = false;
    }
    // Helper function to get legacy missing currencies in a row (EUR, GBP, CAD, CHF, AUD, JPY)
    getMissingLegacyCurrencies(priceTime) {
        const missingCurrencies = [];
        ['eur', 'gbp', 'cad', 'chf', 'aud', 'jpy'].forEach(currency => {
            if (priceTime[`${currency}_missing`]) {
                missingCurrencies.push(currency.toUpperCase());
            }
        });
        return missingCurrencies;
    }
}
exports.default = new PriceUpdater();
