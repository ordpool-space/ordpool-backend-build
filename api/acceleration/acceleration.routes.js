"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../logger"));
const mempool_1 = __importDefault(require("../mempool"));
const AccelerationRepository_1 = __importDefault(require("../../repositories/AccelerationRepository"));
class AccelerationRoutes {
    tag = 'Accelerator';
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/accelerations', this.$getAcceleratorAccelerations.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/accelerations/:txid', this.$getAcceleratorAcceleration.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/accelerations/history', this.$getAcceleratorAccelerationsHistory.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/accelerations/history/aggregated', this.$getAcceleratorAccelerationsHistoryAggregated.bind(this))
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/accelerations/stats', this.$getAcceleratorAccelerationsStats.bind(this))
            .post(config_1.default.MEMPOOL.API_URL_PREFIX + 'services/accelerator/estimate', this.$getAcceleratorEstimate.bind(this));
    }
    async $getAcceleratorAccelerations(req, res) {
        const accelerations = mempool_1.default.getAccelerations();
        res.status(200).send(Object.values(accelerations));
    }
    /** @asyncUnsafe */
    async $getAcceleratorAcceleration(req, res) {
        if (req.params.txid) {
            const acceleration = await AccelerationRepository_1.default.$getAccelerationInfoForTxid(req.params.txid);
            if (acceleration) {
                res.status(200).send(acceleration);
            }
            else {
                res.status(404).send('Acceleration not found');
            }
        }
        else {
            res.status(400).send('txid is required');
        }
    }
    /** @asyncUnsafe */
    async $getAcceleratorAccelerationsHistory(req, res) {
        const history = await AccelerationRepository_1.default.$getAccelerationInfo(null, req.query.blockHeight ? parseInt(req.query.blockHeight, 10) : null);
        res.status(200).send(history.map(accel => ({
            txid: accel.txid,
            added: accel.added,
            status: 'completed',
            effectiveFee: accel.effective_fee,
            effectiveVsize: accel.effective_vsize,
            boostRate: accel.boost_rate,
            boostCost: accel.boost_cost,
            blockHeight: accel.height,
            pools: [accel.pool],
        })));
    }
    async $getAcceleratorAccelerationsHistoryAggregated(req, res) {
        const url = `${config_1.default.MEMPOOL_SERVICES.API}/${req.originalUrl.replace('/api/v1/services/', '')}`;
        try {
            const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 10000 });
            for (const key in response.headers) {
                res.setHeader(key, response.headers[key]);
            }
            response.data.pipe(res);
        }
        catch (e) {
            logger_1.default.err(`Unable to get aggregated acceleration history from ${url} in $getAcceleratorAccelerationsHistoryAggregated(), ${e}`, this.tag);
            res.status(500).end();
        }
    }
    async $getAcceleratorAccelerationsStats(req, res) {
        const url = `${config_1.default.MEMPOOL_SERVICES.API}/${req.originalUrl.replace('/api/v1/services/', '')}`;
        try {
            const response = await axios_1.default.get(url, { responseType: 'stream', timeout: 10000 });
            for (const key in response.headers) {
                res.setHeader(key, response.headers[key]);
            }
            response.data.pipe(res);
        }
        catch (e) {
            logger_1.default.err(`Unable to get acceleration stats from ${url} in $getAcceleratorAccelerationsStats(), ${e}`, this.tag);
            res.status(500).end();
        }
    }
    async $getAcceleratorEstimate(req, res) {
        const url = `${config_1.default.MEMPOOL_SERVICES.API}/${req.originalUrl.replace('/api/v1/services/', '')}`;
        try {
            const response = await axios_1.default.post(url, req.body, { responseType: 'stream', timeout: 10000 });
            for (const key in response.headers) {
                res.setHeader(key, response.headers[key]);
            }
            response.data.pipe(res);
        }
        catch (e) {
            logger_1.default.err(`Unable to get acceleration estimate from ${url} in $getAcceleratorEstimate(), ${e}`, this.tag);
            res.status(500).end();
        }
    }
}
exports.default = new AccelerationRoutes();
