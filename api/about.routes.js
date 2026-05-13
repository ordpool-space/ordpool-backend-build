"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
// HACK -- Ordpool: every endpoint in this file is an axios proxy to
// upstream mempool.space's external-data services (donations,
// contributors, translators, sponsor profile images). The lists are
// mempool's people, not ordpool's; proxying them on api.ordpool.space
// would also leak our origin IP to mempool's infra on every /about
// view. We unregister the axios calls entirely and return 410 Gone
// with a 1-day cache so well-behaved clients back off.
class AboutRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations/images/:id', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors/images/:id', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators/images/:id', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/sponsors', AboutRoutes.gone)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/account/images/:username/:md5', AboutRoutes.gone);
    }
    static gone(req, res) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.status(410).json({
            error: 'About-page proxy endpoints are disabled on ordpool.',
        });
    }
}
exports.default = new AboutRoutes();
