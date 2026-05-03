"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const statistics_api_1 = __importDefault(require("./statistics-api"));
const api_1 = require("../../utils/api");
class StatisticsRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/2h', this.$getStatisticsByTime.bind(this, '2h'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/24h', this.$getStatisticsByTime.bind(this, '24h'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/1w', this.$getStatisticsByTime.bind(this, '1w'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/1m', this.$getStatisticsByTime.bind(this, '1m'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/3m', this.$getStatisticsByTime.bind(this, '3m'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/6m', this.$getStatisticsByTime.bind(this, '6m'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/1y', this.$getStatisticsByTime.bind(this, '1y'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/2y', this.$getStatisticsByTime.bind(this, '2y'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/3y', this.$getStatisticsByTime.bind(this, '3y'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/4y', this.$getStatisticsByTime.bind(this, '4y'))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'statistics/all', this.$getStatisticsByTime.bind(this, 'all'));
    }
    async $getStatisticsByTime(time, req, res) {
        res.header('Pragma', 'public');
        res.header('Cache-control', 'public');
        res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
        try {
            let result;
            switch (time) {
                case '24h':
                    result = await statistics_api_1.default.$list24H();
                    res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
                    break;
                case '1w':
                    result = await statistics_api_1.default.$list1W();
                    break;
                case '1m':
                    result = await statistics_api_1.default.$list1M();
                    break;
                case '3m':
                    result = await statistics_api_1.default.$list3M();
                    break;
                case '6m':
                    result = await statistics_api_1.default.$list6M();
                    break;
                case '1y':
                    result = await statistics_api_1.default.$list1Y();
                    break;
                case '2y':
                    result = await statistics_api_1.default.$list2Y();
                    break;
                case '3y':
                    result = await statistics_api_1.default.$list3Y();
                    break;
                case '4y':
                    result = await statistics_api_1.default.$list4Y();
                    break;
                case 'all':
                    result = await statistics_api_1.default.$listAll();
                    break;
                default:
                    result = await statistics_api_1.default.$list2H();
                    res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
                    break;
            }
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get statistics');
        }
    }
}
exports.default = new StatisticsRoutes();
