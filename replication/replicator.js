"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.$sync = void 0;
const config_1 = __importDefault(require("../config"));
const backend_info_1 = __importDefault(require("../api/backend-info"));
const axios_1 = __importDefault(require("axios"));
const socks_proxy_agent_1 = require("socks-proxy-agent");
/** @asyncSafe */
async function $sync(path) {
    // start with a random server so load is uniformly spread
    let allMissing = true;
    const offset = Math.floor(Math.random() * config_1.default.REPLICATION.SERVERS.length);
    for (let i = 0; i < config_1.default.REPLICATION.SERVERS.length; i++) {
        const server = config_1.default.REPLICATION.SERVERS[(i + offset) % config_1.default.REPLICATION.SERVERS.length];
        // don't query ourself
        if (server === backend_info_1.default.getBackendInfo().hostname) {
            continue;
        }
        try {
            const result = await query(`https://${server}${path}`);
            if (result) {
                return { data: result, exists: true, server };
            }
        }
        catch (e) {
            if (e?.response?.status === 404) {
                // this server is also missing this data
            }
            else {
                // something else went wrong
                allMissing = false;
            }
        }
    }
    return { exists: !allMissing };
}
exports.$sync = $sync;
/** @asyncUnsafe */
async function query(path) {
    const axiosOptions = {
        headers: {
            'User-Agent': (config_1.default.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backend_info_1.default.getBackendInfo().version}` : `${config_1.default.MEMPOOL.USER_AGENT}`
        },
        timeout: config_1.default.SOCKS5PROXY.ENABLED ? 30000 : 10000
    };
    if (config_1.default.SOCKS5PROXY.ENABLED) {
        const socksOptions = {
            agentOptions: {
                keepAlive: true,
            },
            hostname: config_1.default.SOCKS5PROXY.HOST,
            port: config_1.default.SOCKS5PROXY.PORT,
            username: config_1.default.SOCKS5PROXY.USERNAME || 'circuit0',
            password: config_1.default.SOCKS5PROXY.PASSWORD,
        };
        axiosOptions.httpsAgent = new socks_proxy_agent_1.SocksProxyAgent(socksOptions);
    }
    const data = await axios_1.default.get(path, axiosOptions);
    if (data.statusText === 'error' || !data.data) {
        throw new Error(`${data.status}`);
    }
    return data.data;
}
exports.query = query;
