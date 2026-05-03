"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = void 0;
const axios_1 = __importDefault(require("axios"));
const socks_proxy_agent_1 = require("socks-proxy-agent");
const backend_info_1 = __importDefault(require("../api/backend-info"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../logger"));
/** @asyncUnsafe */
async function query(path, throwOnFail = false) {
    const setDelay = (secs = 1) => new Promise(resolve => setTimeout(() => resolve(), secs * 1000));
    const axiosOptions = {
        headers: {
            'User-Agent': (config_1.default.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backend_info_1.default.getBackendInfo().version}` : `${config_1.default.MEMPOOL.USER_AGENT}`
        },
        timeout: config_1.default.SOCKS5PROXY.ENABLED ? 30000 : 20000
    };
    let retry = 0;
    let lastError = null;
    while (retry < config_1.default.MEMPOOL.EXTERNAL_MAX_RETRY) {
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
                else {
                    // Retry with different tor circuits https://stackoverflow.com/a/64960234
                    socksOptions.username = `circuit${retry}`;
                }
                axiosOptions.httpsAgent = new socks_proxy_agent_1.SocksProxyAgent(socksOptions);
            }
            const data = await axios_1.default.get(path, axiosOptions);
            if (data.statusText === 'error' || !data.data) {
                throw new Error(`Could not fetch data from ${path}, Error: ${data.status}`);
            }
            return data.data;
        }
        catch (e) {
            lastError = e;
            logger_1.default.warn(`Could not connect to ${path} (Attempt ${retry + 1}/${config_1.default.MEMPOOL.EXTERNAL_MAX_RETRY}). Reason: ` + (e instanceof Error ? e.message : e));
            retry++;
        }
        if (retry < config_1.default.MEMPOOL.EXTERNAL_MAX_RETRY) {
            await setDelay(config_1.default.MEMPOOL.EXTERNAL_RETRY_INTERVAL);
        }
    }
    logger_1.default.err(`Could not connect to ${path}. All ${config_1.default.MEMPOOL.EXTERNAL_MAX_RETRY} attempts failed`);
    if (throwOnFail && lastError) {
        throw lastError;
    }
    return undefined;
}
exports.query = query;
