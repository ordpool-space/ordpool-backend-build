"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../logger"));
const axios_1 = __importDefault(require("axios"));
const mempool_1 = __importDefault(require("../mempool"));
const websocket_handler_1 = __importDefault(require("../websocket-handler"));
const common_1 = require("../common");
;
;
class AccelerationApi {
    ws = null;
    useWebsocket = config_1.default.MEMPOOL.OFFICIAL && config_1.default.MEMPOOL_SERVICES.ACCELERATIONS;
    startedWebsocketLoop = false;
    websocketConnected = false;
    onDemandPollingEnabled = !config_1.default.MEMPOOL_SERVICES.ACCELERATIONS;
    apiPath = config_1.default.MEMPOOL.OFFICIAL ? (config_1.default.MEMPOOL_SERVICES.API + '/accelerator/accelerations') : (config_1.default.EXTERNAL_DATA_SERVER.MEMPOOL_API + '/accelerations');
    websocketPath = config_1.default.MEMPOOL_SERVICES?.API ? `${config_1.default.MEMPOOL_SERVICES.API.replace('https://', 'wss://').replace('http://', 'ws://')}/accelerator/ws` : '/';
    _accelerations = {};
    lastPoll = 0;
    lastPing = Date.now();
    lastPong = Date.now();
    forcePoll = false;
    myAccelerations = {};
    constructor() { }
    getAccelerations() {
        return this._accelerations;
    }
    countMyAccelerationsWithStatus(filter) {
        return Object.values(this.myAccelerations).reduce((count, { status }) => { return count + (status === filter ? 1 : 0); }, 0);
    }
    accelerationRequested(txid) {
        if (this.onDemandPollingEnabled) {
            this.myAccelerations[txid] = { status: 'requested', added: Date.now() };
        }
    }
    accelerationConfirmed() {
        this.forcePoll = true;
    }
    /** @asyncSafe */
    async $fetchAccelerations() {
        try {
            const response = await axios_1.default.get(this.apiPath, { responseType: 'json', timeout: 10000 });
            return response?.data || [];
        }
        catch (e) {
            logger_1.default.warn('Failed to fetch current accelerations from the mempool services backend: ' + (e instanceof Error ? e.message : e));
            return null;
        }
    }
    async $updateAccelerations() {
        if (this.useWebsocket && this.websocketConnected) {
            return this._accelerations;
        }
        if (!this.onDemandPollingEnabled) {
            const accelerations = await this.$fetchAccelerations();
            if (accelerations) {
                const latestAccelerations = {};
                for (const acc of accelerations) {
                    latestAccelerations[acc.txid] = acc;
                }
                this._accelerations = latestAccelerations;
                return this._accelerations;
            }
        }
        else {
            return this.$updateAccelerationsOnDemand();
        }
        return null;
    }
    async $updateAccelerationsOnDemand() {
        const shouldUpdate = this.forcePoll
            || this.countMyAccelerationsWithStatus('requested') > 0
            || (this.countMyAccelerationsWithStatus('accelerating') > 0 && this.lastPoll < (Date.now() - (10 * 60 * 1000)));
        // update accelerations if necessary
        if (shouldUpdate) {
            const accelerations = await this.$fetchAccelerations();
            this.lastPoll = Date.now();
            this.forcePoll = false;
            if (accelerations) {
                const latestAccelerations = {};
                // set relevant accelerations to 'accelerating'
                for (const acc of accelerations) {
                    if (this.myAccelerations[acc.txid]) {
                        latestAccelerations[acc.txid] = acc;
                        this.myAccelerations[acc.txid] = { status: 'accelerating', added: Date.now(), acceleration: acc };
                    }
                }
                // txs that are no longer accelerating are either confirmed or canceled, so mark for expiry
                for (const [txid, { status, acceleration }] of Object.entries(this.myAccelerations)) {
                    if (status === 'accelerating' && !latestAccelerations[txid]) {
                        this.myAccelerations[txid] = { status: 'done', added: Date.now(), acceleration };
                    }
                }
            }
        }
        // clear expired accelerations (confirmed / failed / not accepted) after 10 minutes
        for (const [txid, { status, added }] of Object.entries(this.myAccelerations)) {
            if (['requested', 'done'].includes(status) && added < (Date.now() - (1000 * 60 * 10))) {
                delete this.myAccelerations[txid];
            }
        }
        const latestAccelerations = {};
        for (const acc of Object.values(this.myAccelerations).map(({ acceleration }) => acceleration).filter(acc => acc)) {
            latestAccelerations[acc.txid] = acc;
        }
        this._accelerations = latestAccelerations;
        return this._accelerations;
    }
    async $fetchAccelerationHistory(page, status) {
        if (config_1.default.MEMPOOL_SERVICES.ACCELERATIONS) {
            try {
                const response = await axios_1.default.get(`${config_1.default.MEMPOOL_SERVICES.API}/accelerator/accelerations/history`, {
                    responseType: 'json',
                    timeout: 10000,
                    params: {
                        page,
                        status,
                    }
                });
                return response.data;
            }
            catch (e) {
                logger_1.default.warn('Failed to fetch acceleration history from the mempool services backend: ' + (e instanceof Error ? e.message : e));
                return null;
            }
        }
        else {
            return [];
        }
    }
    isAcceleratedBlock(block, accelerations) {
        let anyAccelerated = false;
        for (let i = 0; i < accelerations.length && !anyAccelerated; i++) {
            anyAccelerated = anyAccelerated || accelerations[i].pools?.includes(block.extras.pool.id);
        }
        return anyAccelerated;
    }
    // get a list of accelerations that have changed between two sets of accelerations
    getAccelerationDelta(oldAccelerationMap, newAccelerationMap) {
        const changed = [];
        const mempoolCache = mempool_1.default.getMempool();
        for (const acceleration of Object.values(newAccelerationMap)) {
            // skip transactions we don't know about
            if (!mempoolCache[acceleration.txid]) {
                continue;
            }
            if (oldAccelerationMap[acceleration.txid] == null) {
                // new acceleration
                changed.push(acceleration.txid);
            }
            else {
                if (oldAccelerationMap[acceleration.txid].feeDelta !== acceleration.feeDelta) {
                    // feeDelta changed
                    changed.push(acceleration.txid);
                }
                else if (oldAccelerationMap[acceleration.txid].pools?.length) {
                    let poolsChanged = false;
                    const pools = new Set();
                    oldAccelerationMap[acceleration.txid].pools.forEach(pool => {
                        pools.add(pool);
                    });
                    acceleration.pools.forEach(pool => {
                        if (!pools.has(pool)) {
                            poolsChanged = true;
                        }
                        else {
                            pools.delete(pool);
                        }
                    });
                    if (pools.size > 0) {
                        poolsChanged = true;
                    }
                    if (poolsChanged) {
                        // pools changed
                        changed.push(acceleration.txid);
                    }
                }
            }
        }
        for (const oldTxid of Object.keys(oldAccelerationMap)) {
            if (!newAccelerationMap[oldTxid]) {
                // removed
                changed.push(oldTxid);
            }
        }
        return changed;
    }
    handleWebsocketMessage(msg) {
        if (msg?.accelerations !== null) {
            const latestAccelerations = {};
            for (const acc of msg?.accelerations || []) {
                latestAccelerations[acc.txid] = acc;
            }
            this._accelerations = latestAccelerations;
            websocket_handler_1.default.handleAccelerationsChanged(this._accelerations);
        }
    }
    /** @asyncSafe */
    async connectWebsocket() {
        if (this.startedWebsocketLoop) {
            return;
        }
        while (this.useWebsocket) {
            this.startedWebsocketLoop = true;
            if (!this.ws) {
                this.ws = new ws_1.WebSocket(this.websocketPath);
                this.lastPing = 0;
                this.ws.on('open', () => {
                    logger_1.default.info(`Acceleration websocket opened to ${this.websocketPath}`);
                    this.websocketConnected = true;
                    this.ws?.send(JSON.stringify({
                        'watch-accelerations': true
                    }));
                });
                this.ws.on('error', (error) => {
                    let errMsg = `Acceleration websocket error on ${this.websocketPath}: ${error['code']}`;
                    if (error['errors']) {
                        errMsg += ' - ' + error['errors'].join(' - ');
                    }
                    logger_1.default.err(errMsg);
                    this.ws = null;
                    this.websocketConnected = false;
                });
                this.ws.on('close', () => {
                    logger_1.default.info('Acceleration websocket closed');
                    this.ws = null;
                    this.websocketConnected = false;
                });
                this.ws.on('message', (data, isBinary) => {
                    try {
                        const msg = (isBinary ? data : data.toString());
                        const parsedMsg = msg?.length ? JSON.parse(msg) : null;
                        this.handleWebsocketMessage(parsedMsg);
                    }
                    catch (e) {
                        logger_1.default.warn('Failed to parse acceleration websocket message: ' + (e instanceof Error ? e.message : e));
                    }
                });
                this.ws.on('ping', () => {
                    logger_1.default.debug('received ping from acceleration websocket server');
                });
                this.ws.on('pong', () => {
                    logger_1.default.debug('received pong from acceleration websocket server');
                    this.lastPong = Date.now();
                });
            }
            else if (this.websocketConnected) {
                if (this.lastPing && this.lastPing > this.lastPong && (Date.now() - this.lastPing > 10000)) {
                    logger_1.default.warn('No pong received within 10 seconds, terminating connection');
                    try {
                        this.ws?.terminate();
                    }
                    catch (e) {
                        logger_1.default.warn('failed to terminate acceleration websocket connection: ' + (e instanceof Error ? e.message : e));
                    }
                    finally {
                        this.ws = null;
                        this.websocketConnected = false;
                        this.lastPing = 0;
                    }
                }
                else if (!this.lastPing || (Date.now() - this.lastPing > 30000)) {
                    logger_1.default.debug('sending ping to acceleration websocket server');
                    if (this.ws?.readyState === ws_1.WebSocket.OPEN) {
                        try {
                            this.ws?.ping();
                            this.lastPing = Date.now();
                        }
                        catch (e) {
                            logger_1.default.warn('failed to send ping to acceleration websocket server: ' + (e instanceof Error ? e.message : e));
                        }
                    }
                }
            }
            await common_1.Common.sleep$(5000);
        }
    }
}
exports.default = new AccelerationApi();
