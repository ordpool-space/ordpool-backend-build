"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("../../config"));
const elements_parser_1 = __importDefault(require("./elements-parser"));
const icons_1 = __importDefault(require("./icons"));
const api_1 = require("../../utils/api");
const PricesRepository_1 = __importDefault(require("../../repositories/PricesRepository"));
class LiquidRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'assets/icons', this.getAllLiquidIcon)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'assets/featured', this.$getAllFeaturedLiquidAssets)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'asset/:assetId/icon', this.getLiquidIcon)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'assets/group/:id', this.$getAssetGroup);
        if (config_1.default.DATABASE.ENABLED) {
            app
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/pegs', this.$getElementsPegs)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/pegs/month', this.$getElementsPegsByMonth)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/pegs/list/:count', this.$getPegsList)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/pegs/volume', this.$getPegsVolumeDaily)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/pegs/count', this.$getPegsCount)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves', this.$getFederationReserves)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/month', this.$getFederationReservesByMonth)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/addresses', this.$getFederationAddresses)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/addresses/total', this.$getFederationAddressesNumber)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/utxos', this.$getFederationUtxos)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/utxos/total', this.$getFederationUtxosNumber)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/utxos/expired', this.$getExpiredUtxos)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/utxos/emergency-spent', this.$getEmergencySpentUtxos)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/utxos/emergency-spent/stats', this.$getEmergencySpentUtxosStats)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'liquid/reserves/status', this.$getFederationAuditStatus)
                .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'historical-price', this.$getHistoricalPrice);
        }
    }
    getLiquidIcon(req, res) {
        const result = icons_1.default.getIconByAssetId(req.params.assetId);
        if (result) {
            res.setHeader('content-type', 'image/png');
            res.setHeader('content-length', result.length);
            res.send(result);
        }
        else {
            (0, api_1.handleError)(req, res, 404, 'Asset icon not found');
        }
    }
    getAllLiquidIcon(req, res) {
        const result = icons_1.default.getAllIconIds();
        if (result) {
            res.json(result);
        }
        else {
            (0, api_1.handleError)(req, res, 404, 'Asset icons not found');
        }
    }
    async $getAllFeaturedLiquidAssets(req, res) {
        try {
            const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.LIQUID_API}/assets/featured`, { responseType: 'stream', timeout: 10000 });
            response.data.pipe(res);
        }
        catch (e) {
            res.status(500).end();
        }
    }
    async $getAssetGroup(req, res) {
        try {
            const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.LIQUID_API}/assets/group/${parseInt(req.params.id, 10)}`, { responseType: 'stream', timeout: 10000 });
            response.data.pipe(res);
        }
        catch (e) {
            res.status(500).end();
        }
    }
    async $getElementsPegsByMonth(req, res) {
        try {
            const pegs = await elements_parser_1.default.$getPegDataByMonth();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60 * 60).toUTCString());
            res.json(pegs);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pegs by month');
        }
    }
    async $getFederationReservesByMonth(req, res) {
        try {
            const reserves = await elements_parser_1.default.$getFederationReservesByMonth();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60 * 60).toUTCString());
            res.json(reserves);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get reserves by month');
        }
    }
    async $getElementsPegs(req, res) {
        try {
            const currentSupply = await elements_parser_1.default.$getCurrentLbtcSupply();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(currentSupply);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pegs');
        }
    }
    async $getFederationReserves(req, res) {
        try {
            const currentReserves = await elements_parser_1.default.$getCurrentFederationReserves();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(currentReserves);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get reserves');
        }
    }
    async $getFederationAuditStatus(req, res) {
        try {
            const auditStatus = await elements_parser_1.default.$getAuditStatus();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(auditStatus);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get federation audit status');
        }
    }
    async $getFederationAddresses(req, res) {
        try {
            const federationAddresses = await elements_parser_1.default.$getFederationAddresses();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(federationAddresses);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get federation addresses');
        }
    }
    async $getFederationAddressesNumber(req, res) {
        try {
            const federationAddresses = await elements_parser_1.default.$getFederationAddressesNumber();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(federationAddresses);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get federation addresses');
        }
    }
    async $getFederationUtxos(req, res) {
        try {
            const federationUtxos = await elements_parser_1.default.$getFederationUtxos();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(federationUtxos);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get federation utxos');
        }
    }
    async $getExpiredUtxos(req, res) {
        try {
            const expiredUtxos = await elements_parser_1.default.$getExpiredUtxos();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(expiredUtxos);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get expired utxos');
        }
    }
    async $getFederationUtxosNumber(req, res) {
        try {
            const federationUtxos = await elements_parser_1.default.$getFederationUtxosNumber();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(federationUtxos);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get federation utxos number');
        }
    }
    async $getEmergencySpentUtxos(req, res) {
        try {
            const emergencySpentUtxos = await elements_parser_1.default.$getEmergencySpentUtxos();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(emergencySpentUtxos);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get emergency spent utxos');
        }
    }
    async $getEmergencySpentUtxosStats(req, res) {
        try {
            const emergencySpentUtxos = await elements_parser_1.default.$getEmergencySpentUtxosStats();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(emergencySpentUtxos);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get emergency spent utxos stats');
        }
    }
    async $getPegsList(req, res) {
        try {
            const recentPegs = await elements_parser_1.default.$getPegsList(parseInt(req.params?.count));
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(recentPegs);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pegs list');
        }
    }
    async $getPegsVolumeDaily(req, res) {
        try {
            const pegsVolume = await elements_parser_1.default.$getPegsVolumeDaily();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(pegsVolume);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pegs volume daily');
        }
    }
    async $getPegsCount(req, res) {
        try {
            const pegsCount = await elements_parser_1.default.$getPegsCount();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 30).toUTCString());
            res.json(pegsCount);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get pegs count');
        }
    }
    async $getHistoricalPrice(req, res) {
        try {
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 300).toUTCString());
            if (['testnet', 'signet', 'liquidtestnet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK)) {
                (0, api_1.handleError)(req, res, 400, 'Prices are not available on testnets.');
                return;
            }
            const timestamp = parseInt(req.query.timestamp, 10) || 0;
            const currency = req.query.currency;
            let response;
            if (timestamp && currency) {
                response = await PricesRepository_1.default.$getNearestHistoricalPrice(timestamp, currency);
            }
            else if (timestamp) {
                response = await PricesRepository_1.default.$getNearestHistoricalPrice(timestamp);
            }
            else if (currency) {
                response = await PricesRepository_1.default.$getHistoricalPrices(currency);
            }
            else {
                response = await PricesRepository_1.default.$getHistoricalPrices();
            }
            res.status(200).send(response);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get historical prices');
        }
    }
}
exports.default = new LiquidRoutes();
