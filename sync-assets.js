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
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const config_1 = __importDefault(require("./config"));
const backend_info_1 = __importDefault(require("./api/backend-info"));
const logger_1 = __importDefault(require("./logger"));
const socks_proxy_agent_1 = require("socks-proxy-agent");
const PATH = './';
class SyncAssets {
    constructor() { }
    /** @asyncSafe */
    async syncAssets$() {
        for (const url of config_1.default.MEMPOOL.EXTERNAL_ASSETS) {
            try {
                await this.downloadFile$(url);
            }
            catch (e) {
                throw new Error(`Failed to download external asset. ` + (e instanceof Error ? e.message : e));
            }
        }
    }
    async downloadFile$(url) {
        return new Promise((resolve, reject) => {
            const fileName = url.split('/').slice(-1)[0];
            try {
                if (config_1.default.SOCKS5PROXY.ENABLED) {
                    const socksOptions = {
                        agentOptions: {
                            keepAlive: true,
                        },
                        hostname: config_1.default.SOCKS5PROXY.HOST,
                        port: config_1.default.SOCKS5PROXY.PORT
                    };
                    if (config_1.default.SOCKS5PROXY.USERNAME && config_1.default.SOCKS5PROXY.PASSWORD) {
                        socksOptions.username = config_1.default.SOCKS5PROXY.USERNAME;
                        socksOptions.password = config_1.default.SOCKS5PROXY.PASSWORD;
                    }
                    const agent = new socks_proxy_agent_1.SocksProxyAgent(socksOptions);
                    logger_1.default.info(`Downloading external asset ${fileName} over the Tor network...`);
                    return axios_1.default.get(url, {
                        headers: {
                            'User-Agent': (config_1.default.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backend_info_1.default.getBackendInfo().version}` : `${config_1.default.MEMPOOL.USER_AGENT}`
                        },
                        httpAgent: agent,
                        httpsAgent: agent,
                        responseType: 'stream',
                        timeout: 30000
                    }).then(function (response) {
                        const writer = fs.createWriteStream(PATH + fileName);
                        writer.on('finish', () => {
                            logger_1.default.info(`External asset ${fileName} saved to ${PATH + fileName}`);
                            resolve(0);
                        });
                        response.data.pipe(writer);
                    });
                }
                else {
                    logger_1.default.info(`Downloading external asset ${fileName} over clearnet...`);
                    return axios_1.default.get(url, {
                        headers: {
                            'User-Agent': (config_1.default.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backend_info_1.default.getBackendInfo().version}` : `${config_1.default.MEMPOOL.USER_AGENT}`
                        },
                        responseType: 'stream',
                        timeout: 30000
                    }).then(function (response) {
                        const writer = fs.createWriteStream(PATH + fileName);
                        writer.on('finish', () => {
                            logger_1.default.info(`External asset ${fileName} saved to ${PATH + fileName}`);
                            resolve(0);
                        });
                        response.data.pipe(writer);
                    });
                }
            }
            catch (e) {
                reject(e);
            }
        });
    }
}
exports.default = new SyncAssets();
