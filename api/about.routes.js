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
// view. We unregister the axios calls entirely and return 200 with
// an empty array + a 1-day Cache-Control: the frontend renders the
// sections behind `*ngIf="list.length"` so empty lists vanish
// silently, no red rows in DevTools, no console errors.
class AboutRoutes {
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'donations/images/:id', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'contributors/images/:id', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'translators/images/:id', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/sponsors', AboutRoutes.emptyList)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/account/images/:username/:md5', AboutRoutes.emptyList);
    }
    static emptyList(req, res) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.status(200).json([]);
    }
}
exports.default = new AboutRoutes();
