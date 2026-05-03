"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const logger_1 = __importDefault(require("../../logger"));
const config_1 = __importDefault(require("../../config"));
const websocket_handler_1 = __importDefault(require("../websocket-handler"));
const common_1 = require("../common");
function isStratumJob(obj) {
    return obj
        && typeof obj === 'object'
        && 'pool' in obj
        && 'prevHash' in obj
        && 'height' in obj
        && 'received' in obj
        && 'version' in obj
        && 'timestamp' in obj
        && 'bits' in obj
        && 'merkleBranches' in obj
        && 'cleanJobs' in obj;
}
class StratumApi {
    ws = null;
    runWebsocketLoop = false;
    startedWebsocketLoop = false;
    websocketConnected = false;
    jobs = {};
    constructor() { }
    getJobs() {
        return this.jobs;
    }
    handleWebsocketMessage(msg) {
        if (isStratumJob(msg)) {
            this.jobs[msg.pool] = msg;
            websocket_handler_1.default.handleNewStratumJob(this.jobs[msg.pool]);
        }
    }
    /** @asyncSafe */
    async connectWebsocket() {
        if (!config_1.default.STRATUM.ENABLED) {
            return;
        }
        this.runWebsocketLoop = true;
        if (this.startedWebsocketLoop) {
            return;
        }
        while (this.runWebsocketLoop) {
            this.startedWebsocketLoop = true;
            if (!this.ws) {
                this.ws = new ws_1.WebSocket(`${config_1.default.STRATUM.API}`);
                this.websocketConnected = true;
                this.ws.on('open', () => {
                    logger_1.default.info('Stratum websocket opened');
                });
                this.ws.on('error', (error) => {
                    logger_1.default.err('Stratum websocket error: ' + error);
                    this.ws = null;
                    this.websocketConnected = false;
                });
                this.ws.on('close', () => {
                    logger_1.default.info('Stratum websocket closed');
                    this.ws = null;
                    this.websocketConnected = false;
                });
                this.ws.on('message', (data, isBinary) => {
                    try {
                        const parsedMsg = JSON.parse((isBinary ? data : data.toString()));
                        this.handleWebsocketMessage(parsedMsg);
                    }
                    catch (e) {
                        logger_1.default.warn('Failed to parse stratum websocket message: ' + (e instanceof Error ? e.message : e));
                    }
                });
            }
            await common_1.Common.sleep$(5000);
        }
    }
}
exports.default = new StratumApi();
