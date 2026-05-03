"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const nodes_api_1 = __importDefault(require("./nodes.api"));
const channels_api_1 = __importDefault(require("./channels.api"));
const statistics_api_1 = __importDefault(require("./statistics.api"));
const api_1 = require("../../utils/api");
class GeneralLightningRoutes {
    constructor() { }
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/search', this.$searchNodesAndChannels)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/statistics/latest', this.$getGeneralStats)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/statistics/:interval', this.$getStatistics);
    }
    async $searchNodesAndChannels(req, res) {
        if (typeof req.query.searchText !== 'string') {
            res.status(400).send('Missing parameter: searchText');
            return;
        }
        try {
            const nodes = await nodes_api_1.default.$searchNodeByPublicKeyOrAlias(req.query.searchText);
            const channels = await channels_api_1.default.$searchChannelsById(req.query.searchText);
            res.json({
                nodes: nodes,
                channels: channels,
            });
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to search for nodes and channels');
        }
    }
    async $getStatistics(req, res) {
        try {
            const statistics = await statistics_api_1.default.$getStatistics(req.params.interval);
            const statisticsCount = await statistics_api_1.default.$getStatisticsCount();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.header('X-total-count', statisticsCount.toString());
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(statistics);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get lightning statistics');
        }
    }
    async $getGeneralStats(req, res) {
        try {
            const statistics = await statistics_api_1.default.$getLatestStatistics();
            res.json(statistics);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get lightning statistics');
        }
    }
}
exports.default = new GeneralLightningRoutes();
