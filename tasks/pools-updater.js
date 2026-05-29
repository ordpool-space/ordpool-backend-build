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
const path = __importStar(require("path"));
const pools_parser_1 = __importDefault(require("../api/pools-parser"));
const config_1 = __importDefault(require("../config"));
const database_1 = __importDefault(require("../database"));
const backend_info_1 = __importDefault(require("../api/backend-info"));
const logger_1 = __importDefault(require("../logger"));
const socks_proxy_agent_1 = require("socks-proxy-agent");
const common_1 = require("../api/common");
/**
 * Maintain the most recent version of pools-v2.json
 */
class PoolsUpdater {
    tag = 'PoolsUpdater';
    lastRun = 0;
    currentSha = null;
    poolsUrl = config_1.default.MEMPOOL.POOLS_JSON_URL;
    treeUrl = config_1.default.MEMPOOL.POOLS_JSON_TREE_URL;
    /**
     * HACK -- Ordpool: load the bundled pools-v2.json. The file ships
     * alongside the compiled JS at dist/tasks/_ordpool/pools-v2.json
     * (copied by the create-resources script in package.json).
     *
     * The bundled file is the only source of pool definitions; upstream's
     * live fetch (updatePoolsJson) and periodic refresh ($startService)
     * are neutralised at the call sites in index.ts. New pool data arrives
     * via .github/workflows/refresh-pools-v2.yml pushing an updated
     * bundle, which deploys on the next regular build. Pool icons (SVG
     * logos at frontend/src/resources/mining-pools/) are shipped from
     * upstream mempool/mempool, not from mempool/mining-pools, so newly
     * added pools fall back to default.svg until the next upstream merge.
     *
     * currentSha is left at its default null -- blocks.definition_hash is
     * nullable, so block inserts succeed; we just don't tag block rows
     * with a pools-list version.
     */
    async loadBundledPools() {
        const bundlePath = path.join(__dirname, '_ordpool', 'pools-v2.json');
        const raw = fs.readFileSync(bundlePath, 'utf8');
        const json = JSON.parse(raw);
        pools_parser_1.default.setMiningPools(json);
        if (config_1.default.DATABASE.ENABLED === true) {
            try {
                await database_1.default.query('START TRANSACTION;');
                await pools_parser_1.default.migratePoolsJson();
                await database_1.default.query('COMMIT;');
            }
            catch (e) {
                await database_1.default.query('ROLLBACK;');
                throw e;
            }
        }
    }
    /** @asyncSafe */
    async $startService() {
        while ('Bitcoin is still alive') {
            try {
                await this.updatePoolsJson();
            }
            catch (e) {
                logger_1.default.info(`Exception ${e} in PoolsUpdater::$startService. Code: ${e.code}. Message: ${e.message}`, this.tag);
            }
            await common_1.Common.sleep$(10000);
        }
    }
    /** @asyncSafe */
    async updatePoolsJson() {
        if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) === false ||
            config_1.default.MEMPOOL.ENABLED === false) {
            return;
        }
        const now = new Date().getTime() / 1000;
        if (now - this.lastRun < config_1.default.MEMPOOL.POOLS_UPDATE_DELAY) { // Execute the PoolsUpdate only once a week, or upon restart
            return;
        }
        this.lastRun = now;
        try {
            if (config_1.default.DATABASE.ENABLED === true) {
                this.currentSha = await this.getShaFromDb();
            }
            const githubSha = await this.fetchPoolsSha(); // Fetch pools-v2.json sha from github
            if (githubSha === null) {
                return;
            }
            logger_1.default.debug(`pools-v2.json sha | Current: ${this.currentSha} | Github: ${githubSha}`, this.tag);
            if (this.currentSha !== null && this.currentSha === githubSha) {
                return;
            }
            // See backend README for more details about the mining pools update process
            if (this.currentSha !== null && // If we don't have any mining pool, download it at least once
                config_1.default.MEMPOOL.AUTOMATIC_POOLS_UPDATE !== true && // Automatic pools update is disabled
                !process.env.npm_config_update_pools // We're not manually updating mining pool
            ) {
                logger_1.default.warn(`Updated mining pools data is available (${githubSha}) but AUTOMATIC_POOLS_UPDATE is disabled`, this.tag);
                logger_1.default.info(`You can update your mining pools using the --update-pools command flag. You may want to clear your nginx cache as well if applicable`, this.tag);
                return;
            }
            const network = config_1.default.SOCKS5PROXY.ENABLED ? 'tor' : 'clearnet';
            if (this.currentSha === null) {
                logger_1.default.info(`Downloading pools-v2.json for the first time from ${this.poolsUrl} over ${network}`, this.tag);
            }
            else {
                logger_1.default.warn(`pools-v2.json is outdated, fetching latest from ${this.poolsUrl} over ${network}`, this.tag);
            }
            const poolsJson = await this.query(this.poolsUrl);
            if (poolsJson === undefined) {
                return;
            }
            pools_parser_1.default.setMiningPools(poolsJson);
            if (config_1.default.DATABASE.ENABLED === false) { // Don't run db operations
                logger_1.default.info(`Mining pools-v2.json (${githubSha}) import completed (no database)`, this.tag);
                return;
            }
            try {
                await database_1.default.query('START TRANSACTION;');
                await this.updateDBSha(githubSha);
                await pools_parser_1.default.migratePoolsJson();
                await database_1.default.query('COMMIT;');
            }
            catch (e) {
                logger_1.default.err(`Could not migrate mining pools, rolling back. Exception: ${JSON.stringify(e)}`, this.tag);
                await database_1.default.query('ROLLBACK;');
            }
            logger_1.default.info(`Mining pools-v2.json (${githubSha}) import completed`, this.tag);
        }
        catch (e) {
            // fast-forward lastRun to 10 minutes before the next scheduled update
            this.lastRun = now - Math.max(config_1.default.MEMPOOL.POOLS_UPDATE_DELAY - 600, 600);
            logger_1.default.err(`PoolsUpdater failed. Will try again in 10 minutes. Exception: ${JSON.stringify(e)}`, this.tag);
        }
    }
    /**
     * Fetch our latest pools-v2.json sha from the db
     */
    async updateDBSha(githubSha) {
        this.currentSha = githubSha;
        if (config_1.default.DATABASE.ENABLED === true) {
            try {
                await database_1.default.query('DELETE FROM state where name="pools_json_sha"');
                await database_1.default.query(`INSERT INTO state VALUES('pools_json_sha', NULL, '${githubSha}')`);
            }
            catch (e) {
                logger_1.default.err('Cannot save github pools-v2.json sha into the db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
            }
        }
    }
    /**
     * Fetch our latest pools-v2.json sha from the db
     */
    async getShaFromDb() {
        try {
            const [rows] = await database_1.default.query('SELECT string FROM state WHERE name="pools_json_sha"');
            return (rows.length > 0 ? rows[0].string : null);
        }
        catch (e) {
            logger_1.default.err('Cannot fetch pools-v2.json sha from db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
            return null;
        }
    }
    /**
     * Fetch our latest pools-v2.json sha from github
     * @asyncUnsafe
     */
    async fetchPoolsSha() {
        const response = await this.query(this.treeUrl);
        if (response !== undefined) {
            for (const file of response['tree']) {
                if (file['path'] === 'pools-v2.json') {
                    return file['sha'];
                }
            }
        }
        logger_1.default.err(`Cannot find "pools-v2.json" in git tree (${this.treeUrl})`, this.tag);
        return null;
    }
    /**
     * Http request wrapper
     * @asyncUnsafe
     */
    async query(path) {
        const setDelay = (secs = 1) => new Promise(resolve => setTimeout(() => resolve(), secs * 1000));
        const axiosOptions = {
            headers: {
                'User-Agent': (config_1.default.MEMPOOL.USER_AGENT === 'mempool') ? `mempool/v${backend_info_1.default.getBackendInfo().version}` : `${config_1.default.MEMPOOL.USER_AGENT}`
            },
            timeout: config_1.default.SOCKS5PROXY.ENABLED ? 30000 : 10000
        };
        let retry = 0;
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
                logger_1.default.err('Could not connect to Github. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
                retry++;
            }
            await setDelay(config_1.default.MEMPOOL.EXTERNAL_RETRY_INTERVAL);
        }
        return undefined;
    }
}
exports.default = new PoolsUpdater();
