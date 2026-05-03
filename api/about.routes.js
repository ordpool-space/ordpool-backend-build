"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
class AboutRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/donations`, { responseType: 'stream', timeout: 10000 });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations/images/:id', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/donations/images/${req.params.id}`, {
                    responseType: 'stream', timeout: 10000
                });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/contributors`, { responseType: 'stream', timeout: 10000 });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors/images/:id', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/contributors/images/${req.params.id}`, {
                    responseType: 'stream', timeout: 10000
                });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/translators`, { responseType: 'stream', timeout: 10000 });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators/images/:id', async (req, res) => {
            try {
                const response = await axios_1.default.get(`${config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API}/translators/images/${req.params.id}`, {
                    responseType: 'stream', timeout: 10000
                });
                response.data.pipe(res);
            }
            catch (e) {
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/sponsors', async (req, res) => {
            const url = `${config_1.default.MEMPOOL_SERVICES.API}/${req.originalUrl.replace('/api/v1/services/', '')}`;
            try {
                const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 10000 });
                response.data.pipe(res);
            }
            catch (e) {
                logger_1.default.err(`Unable to fetch sponsors from ${url}. ${e}`, 'About Page');
                res.status(500).end();
            }
        })
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/account/images/:username/:md5', async (req, res) => {
            const url = `${config_1.default.MEMPOOL_SERVICES.API}/${req.originalUrl.replace('/api/v1/services/', '')}`;
            try {
                const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 10000 });
                response.data.pipe(res);
            }
            catch (e) {
                logger_1.default.err(`Unable to fetch sponsor profile image from ${url}. ${e}`, 'About Page');
                res.status(500).end();
            }
        });
    }
}
exports.default = new AboutRoutes();
