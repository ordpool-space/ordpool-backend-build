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
const express_1 = __importDefault(require("express"));
const http = __importStar(require("http"));
const WebSocket = __importStar(require("ws"));
const bitcoin_api_factory_1 = __importDefault(require("./api/bitcoin/bitcoin-api-factory"));
const cluster_1 = __importDefault(require("cluster"));
const database_1 = __importDefault(require("./database"));
const config_1 = __importDefault(require("./config"));
const blocks_1 = __importDefault(require("./api/blocks"));
const mempool_1 = __importDefault(require("./api/mempool"));
const disk_cache_1 = __importDefault(require("./api/disk-cache"));
const statistics_1 = __importDefault(require("./api/statistics/statistics"));
const websocket_handler_1 = __importDefault(require("./api/websocket-handler"));
const logger_1 = __importDefault(require("./logger"));
const backend_info_1 = __importDefault(require("./api/backend-info"));
const loading_indicators_1 = __importDefault(require("./api/loading-indicators"));
const mempool_2 = __importDefault(require("./api/mempool"));
const elements_parser_1 = __importDefault(require("./api/liquid/elements-parser"));
const database_migration_1 = __importDefault(require("./api/database-migration"));
const electrs_proxy_middleware_1 = require("./electrs-proxy-middleware");
const inscription_assets_proxy_middleware_1 = require("./inscription-assets-proxy-middleware");
const sync_assets_1 = __importDefault(require("./sync-assets"));
const icons_1 = __importDefault(require("./api/liquid/icons"));
const common_1 = require("./api/common");
const pools_updater_1 = __importDefault(require("./tasks/pools-updater"));
const indexer_1 = __importDefault(require("./indexer"));
const nodes_routes_1 = __importDefault(require("./api/explorer/nodes.routes"));
const channels_routes_1 = __importDefault(require("./api/explorer/channels.routes"));
const general_routes_1 = __importDefault(require("./api/explorer/general.routes"));
const stats_updater_service_1 = __importDefault(require("./tasks/lightning/stats-updater.service"));
const network_sync_service_1 = __importDefault(require("./tasks/lightning/network-sync.service"));
const statistics_routes_1 = __importDefault(require("./api/statistics/statistics.routes"));
const prices_routes_1 = __importDefault(require("./api/prices/prices.routes"));
const mining_routes_1 = __importDefault(require("./api/mining/mining-routes"));
const liquid_routes_1 = __importDefault(require("./api/liquid/liquid.routes"));
const bitcoin_routes_1 = __importDefault(require("./api/bitcoin/bitcoin.routes"));
const services_routes_1 = __importDefault(require("./api/services/services-routes"));
const funding_tx_fetcher_1 = __importDefault(require("./tasks/lightning/sync-tasks/funding-tx-fetcher"));
const forensics_service_1 = __importDefault(require("./tasks/lightning/forensics.service"));
const price_updater_1 = __importDefault(require("./tasks/price-updater"));
const chain_tips_1 = __importDefault(require("./api/chain-tips"));
const axios_1 = require("axios");
const v8_1 = __importDefault(require("v8"));
const format_1 = require("./utils/format");
const redis_cache_1 = __importDefault(require("./api/redis-cache"));
const acceleration_1 = __importDefault(require("./api/services/acceleration"));
const bitcoin_core_routes_1 = __importDefault(require("./api/bitcoin/bitcoin-core.routes"));
const bitcoin_second_client_1 = __importDefault(require("./api/bitcoin/bitcoin-second-client"));
const acceleration_routes_1 = __importDefault(require("./api/acceleration/acceleration.routes"));
const about_routes_1 = __importDefault(require("./api/about.routes"));
const mempool_blocks_1 = __importDefault(require("./api/mempool-blocks"));
const wallets_1 = __importDefault(require("./api/services/wallets"));
const stratum_1 = __importDefault(require("./api/services/stratum"));
// HACK -- Ordpool imports
const ordpool_database_migration_1 = __importDefault(require("./api/ordpool-database-migration"));
const ordpool_ots_txid_set_1 = __importDefault(require("./api/ordpool-ots-txid-set"));
const ordpool_ots_poller_1 = __importDefault(require("./api/ordpool-ots-poller"));
const ordpool_routes_1 = __importDefault(require("./api/explorer/_ordpool/ordpool.routes"));
const ordpool_indexer_1 = __importDefault(require("./ordpool-indexer"));
class Server {
    wss;
    wssUnixSocket;
    server;
    serverUnixSocket;
    app;
    currentBackendRetryInterval = 1;
    backendRetryCount = 0;
    maxHeapSize = 0;
    heapLogInterval = 60;
    warnedHeapCritical = false;
    lastHeapLogTime = null;
    constructor() {
        this.app = (0, express_1.default)();
        if (!config_1.default.MEMPOOL.SPAWN_CLUSTER_PROCS) {
            void this.startServer();
            return;
        }
        if (cluster_1.default.isPrimary) {
            logger_1.default.notice(`Mempool Server (Master) is running on port ${config_1.default.MEMPOOL.HTTP_PORT} (${backend_info_1.default.getShortCommitHash()})`);
            const numCPUs = config_1.default.MEMPOOL.SPAWN_CLUSTER_PROCS;
            for (let i = 0; i < numCPUs; i++) {
                const env = { workerId: i };
                const worker = cluster_1.default.fork(env);
                worker.process['env'] = env;
            }
            cluster_1.default.on('exit', (worker, code, signal) => {
                const workerId = worker.process['env'].workerId;
                logger_1.default.warn(`Mempool Worker PID #${worker.process.pid} workerId: ${workerId} died. Restarting in 10 seconds... ${signal || code}`);
                setTimeout(() => {
                    const env = { workerId: workerId };
                    const newWorker = cluster_1.default.fork(env);
                    newWorker.process['env'] = env;
                }, 10000);
            });
        }
        else {
            void this.startServer(true);
        }
    }
    /** @asyncSafe */
    async startServer(worker = false) {
        logger_1.default.notice(`Starting Mempool Server${worker ? ' (worker)' : ''}... (${backend_info_1.default.getShortCommitHash()})`);
        // Register cleanup listeners for exit events
        ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2'].forEach(event => {
            process.on(event, () => { this.forceExit(event); });
        });
        process.on('exit', () => {
            logger_1.default.debug(`'exit' event triggered`);
            this.exitCleanup();
        });
        process.on('uncaughtException', (error) => {
            console.error(`uncaughtException:`, error);
            this.forceExit('uncaughtException', 1);
        });
        process.on('unhandledRejection', (reason, promise) => {
            console.error(`unhandledRejection:`, reason, promise);
            this.forceExit('unhandledRejection', 1);
        });
        if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
            bitcoin_api_factory_1.default.startHealthChecks();
        }
        if (config_1.default.DATABASE.ENABLED) {
            database_1.default.getPidLock();
            await database_1.default.checkDbConnection();
            try {
                if (process.env.npm_config_reindex_blocks === 'true') { // Re-index requests
                    await database_migration_1.default.$blocksReindexingTruncate();
                }
                await database_migration_1.default.$initializeOrMigrateDatabase();
                // HACK -- Ordpool database migration
                await ordpool_database_migration_1.default.$initializeOrMigrateDatabase();
                // HACK -- Ordpool: bootstrap the in-memory OTS txid set from the
                // ordpool_stats_ots satellite table, then start the poller so new
                // calendar commits land continuously. Per-tx OTS labelling
                // (`getOtsFlag` in `Common.getTransactionFlags`) reads this set.
                //
                // Bootstrap is fail-soft: a satellite-table outage at boot must
                // NOT abort backend startup. Worst case the set stays empty,
                // `getOtsFlag` returns 0n for every tx, no OTS badges appear --
                // and the poller's regular cycle (or a manual `bootstrap()`
                // retry from elsewhere) catches up once the DB is healthy. The
                // alternative -- coupling a non-critical feature to backend
                // liveness -- would be worse.
                try {
                    await ordpool_ots_txid_set_1.default.bootstrap();
                }
                catch (e) {
                    logger_1.default.warn('OTS txid-set bootstrap failed; continuing with empty set. Reason: ' + (e instanceof Error ? e.message : e), 'Ordpool');
                }
                ordpool_ots_poller_1.default.start();
            }
            catch (e) {
                throw new Error(e instanceof Error ? e.message : 'Error');
            }
        }
        this.app
            .use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Accept,Authorization,Cache-Control,Content-Type,DNT,If-Modified-Since,Keep-Alive,Origin,User-Agent,X-Requested-With');
            res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count,X-Mempool-Auth');
            next();
        })
            // HACK --- Ordpool: cheap nginx replacement (see electrs-proxy-middleware.ts).
            .use('/api', (0, electrs_proxy_middleware_1.createElectrsProxyMiddleware)(config_1.default.ESPLORA?.REST_API_URL))
            // HACK --- Ordpool: serve inscription-preview helper assets through the
            // backend so that iframes hosted at api.ordpool.space can resolve them.
            .use('/resources/inscription-assets', (0, inscription_assets_proxy_middleware_1.createInscriptionAssetsProxyMiddleware)())
            .use(express_1.default.urlencoded({ extended: true, limit: '10mb' }))
            .use(express_1.default.text({ type: ['text/plain', 'application/base64'], limit: '10mb' }))
            .use(express_1.default.json({ limit: '10mb' }));
        if (config_1.default.DATABASE.ENABLED && config_1.default.FIAT_PRICE.ENABLED) {
            /** @asyncUnsafe */
            await price_updater_1.default.$initializeLatestPriceWithDb();
        }
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server, maxPayload: websocket_handler_1.default.MAX_MESSAGE_SIZE });
        if (config_1.default.MEMPOOL.UNIX_SOCKET_PATH) {
            this.serverUnixSocket = http.createServer(this.app);
            this.wssUnixSocket = new WebSocket.Server({ server: this.serverUnixSocket, maxPayload: websocket_handler_1.default.MAX_MESSAGE_SIZE });
        }
        this.setUpWebsocketHandling();
        await pools_updater_1.default.updatePoolsJson(); // Needs to be done before loading the disk cache because we sometimes wipe it
        if (config_1.default.DATABASE.ENABLED === true && config_1.default.MEMPOOL.ENABLED && ['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config_1.default.MEMPOOL.NETWORK) && !pools_updater_1.default.currentSha) {
            logger_1.default.err(`Failed to retreive pools-v2.json sha, cannot run block indexing. Please make sure you've set valid urls in your mempool-config.json::MEMPOOL::POOLS_JSON_URL and mempool-config.json::MEMPOOL::POOLS_JSON_TREE_UR, aborting now`);
            return process.exit(1);
        }
        await sync_assets_1.default.syncAssets$();
        if (config_1.default.DATABASE.ENABLED) {
            /** @asyncUnsafe */
            await mempool_blocks_1.default.updatePools$();
        }
        if (config_1.default.MEMPOOL.ENABLED) {
            if (config_1.default.MEMPOOL.CACHE_ENABLED) {
                await disk_cache_1.default.$loadMempoolCache();
            }
            else if (config_1.default.REDIS.ENABLED) {
                /** @asyncUnsafe */
                await redis_cache_1.default.$loadCache();
            }
        }
        if (config_1.default.STATISTICS.ENABLED && config_1.default.DATABASE.ENABLED && cluster_1.default.isPrimary) {
            statistics_1.default.startStatistics();
        }
        if (common_1.Common.isLiquid()) {
            const refreshIcons = () => {
                try {
                    icons_1.default.loadIcons();
                }
                catch (e) {
                    logger_1.default.err('Cannot load liquid icons. Ignoring. Reason: ' + (e instanceof Error ? e.message : e));
                }
            };
            // Run once on startup.
            refreshIcons();
            // Matches crontab refresh interval for asset db.
            setInterval(refreshIcons, 3600_000);
        }
        if (config_1.default.FIAT_PRICE.ENABLED) {
            void price_updater_1.default.$run();
        }
        await chain_tips_1.default.updateOrphanedBlocks();
        this.setUpHttpApiRoutes();
        if (config_1.default.MEMPOOL.ENABLED) {
            void this.runMainUpdateLoop();
        }
        setInterval(() => { this.healthCheck(); }, 2500);
        if (config_1.default.LIGHTNING.ENABLED) {
            void this.$runLightningBackend();
        }
        this.server.listen(config_1.default.MEMPOOL.HTTP_PORT, () => {
            if (worker) {
                logger_1.default.info(`Mempool Server worker #${process.pid} started`);
            }
            else {
                logger_1.default.notice(`Mempool Server is running on port ${config_1.default.MEMPOOL.HTTP_PORT}`);
            }
        });
        if (this.serverUnixSocket) {
            this.serverUnixSocket.listen(config_1.default.MEMPOOL.UNIX_SOCKET_PATH, () => {
                if (worker) {
                    logger_1.default.info(`Mempool Server worker #${process.pid} started`);
                }
                else {
                    logger_1.default.notice(`Mempool Server is listening on ${config_1.default.MEMPOOL.UNIX_SOCKET_PATH}`);
                }
            });
        }
        void pools_updater_1.default.$startService();
    }
    /** @asyncSafe */
    async runMainUpdateLoop() {
        const start = Date.now();
        try {
            try {
                await mempool_1.default.$updateMemPoolInfo();
            }
            catch (e) {
                const msg = `updateMempoolInfo: ${(e instanceof Error ? e.message : e)}`;
                if (config_1.default.MEMPOOL.USE_SECOND_NODE_FOR_MINFEE) {
                    logger_1.default.warn(msg);
                }
                else {
                    logger_1.default.debug(msg);
                }
            }
            const newMempool = await bitcoin_api_factory_1.default.$getRawMempool();
            const minFeeMempool = mempool_1.default.limitGBT ? await bitcoin_second_client_1.default.getRawMemPool() : null;
            const minFeeTip = mempool_1.default.limitGBT ? await bitcoin_second_client_1.default.getBlockCount() : -1;
            const latestAccelerations = await acceleration_1.default.$updateAccelerations();
            const numHandledBlocks = await blocks_1.default.$updateBlocks();
            const pollRate = config_1.default.MEMPOOL.POLL_RATE_MS * (indexer_1.default.indexerIsRunning() ? 10 : 1);
            if (numHandledBlocks === 0) {
                await mempool_1.default.$updateMempool(newMempool, latestAccelerations, minFeeMempool, minFeeTip, pollRate);
            }
            void indexer_1.default.$run();
            // HACK -- Ordpool indexer (backfills ordpool stats for historical blocks)
            await ordpool_indexer_1.default.run();
            if (config_1.default.WALLETS.ENABLED) {
                // might take a while, so run in the background
                void wallets_1.default.$syncWallets();
            }
            if (config_1.default.FIAT_PRICE.ENABLED) {
                void price_updater_1.default.$run();
            }
            // rerun immediately if we skipped the mempool update, otherwise wait POLL_RATE_MS
            const elapsed = Date.now() - start;
            const remainingTime = Math.max(0, pollRate - elapsed);
            setTimeout(this.runMainUpdateLoop.bind(this), numHandledBlocks > 0 ? 0 : remainingTime);
            this.backendRetryCount = 0;
        }
        catch (e) {
            this.backendRetryCount++;
            let loggerMsg = `Exception in runMainUpdateLoop() (count: ${this.backendRetryCount}). Retrying in ${this.currentBackendRetryInterval} sec.`;
            loggerMsg += ` Reason: ${(e instanceof Error ? e.message : e)}.`;
            if (e?.stack) {
                loggerMsg += ` Stack trace: ${e.stack}`;
            }
            // When we get a first Exception, only `logger.debug` it and retry after 5 seconds
            // From the second Exception, `logger.warn` the Exception and increase the retry delay
            if (this.backendRetryCount >= 5) {
                logger_1.default.warn(loggerMsg);
                mempool_2.default.setOutOfSync();
            }
            else {
                logger_1.default.debug(loggerMsg);
            }
            if (e instanceof axios_1.AxiosError) {
                logger_1.default.debug(`AxiosError: ${e?.message}`);
            }
            setTimeout(this.runMainUpdateLoop.bind(this), 1000 * this.currentBackendRetryInterval);
        }
        finally {
            disk_cache_1.default.unlock();
        }
    }
    /** @asyncSafe */
    async $runLightningBackend() {
        try {
            await funding_tx_fetcher_1.default.$init();
            await network_sync_service_1.default.$startService();
            await stats_updater_service_1.default.$startService();
            await forensics_service_1.default.$startService();
        }
        catch (e) {
            logger_1.default.err(`Exception in $runLightningBackend. Restarting in 1 minute. Reason: ${(e instanceof Error ? e.message : e)}`);
            await common_1.Common.sleep$(1000 * 60);
            void this.$runLightningBackend();
        }
        ;
    }
    setUpWebsocketHandling() {
        if (this.wss) {
            websocket_handler_1.default.addWebsocketServer(this.wss);
        }
        if (this.wssUnixSocket) {
            websocket_handler_1.default.addWebsocketServer(this.wssUnixSocket);
        }
        if (common_1.Common.isLiquid() && config_1.default.DATABASE.ENABLED) {
            blocks_1.default.setNewBlockCallback(async () => {
                try {
                    await elements_parser_1.default.$parse();
                }
                catch (e) {
                    logger_1.default.warn('Elements parsing error: ' + (e instanceof Error ? e.message : e));
                }
            });
        }
        websocket_handler_1.default.setupConnectionHandling();
        // HACK -- Ordpool: register the WS broadcaster that pushes
        // `otsCommitFlipped` to clients tracking a txid the moment the OTS
        // poller learns about its calendar batch. See
        // ORDPOOL-FLAGS-ARCHITECTURE.md §4 and §7 item 1.
        websocket_handler_1.default.setupOtsCommitFlipBroadcasts();
        if (config_1.default.MEMPOOL.ENABLED) {
            statistics_1.default.setNewStatisticsEntryCallback(websocket_handler_1.default.handleNewStatistic.bind(websocket_handler_1.default));
            mempool_1.default.setAsyncMempoolChangedCallback(websocket_handler_1.default.$handleMempoolChange.bind(websocket_handler_1.default));
        }
        if (config_1.default.FIAT_PRICE.ENABLED) {
            price_updater_1.default.setRatesChangedCallback(websocket_handler_1.default.handleNewConversionRates.bind(websocket_handler_1.default));
        }
        loading_indicators_1.default.setProgressChangedCallback(websocket_handler_1.default.handleLoadingChanged.bind(websocket_handler_1.default));
        void acceleration_1.default.connectWebsocket();
        if (config_1.default.STRATUM.ENABLED) {
            void stratum_1.default.connectWebsocket();
        }
    }
    setUpHttpApiRoutes() {
        bitcoin_routes_1.default.initRoutes(this.app);
        if (config_1.default.MEMPOOL.OFFICIAL) {
            bitcoin_core_routes_1.default.initRoutes(this.app);
        }
        prices_routes_1.default.initRoutes(this.app);
        // HACK -- Ordpool: register statistics read-routes even when the sampler
        // is off (STATISTICS.ENABLED=false). Upstream's dashboard polls
        // /api/v1/statistics/2h unconditionally; without these routes, every
        // page load on prod emits a 404 to the browser console. The handler
        // just SELECTs from an empty `statistics` table and returns []. We
        // still gate on DATABASE.ENABLED + MEMPOOL.ENABLED so the routes only
        // come up when their backing storage exists.
        if (config_1.default.DATABASE.ENABLED && config_1.default.MEMPOOL.ENABLED) {
            statistics_routes_1.default.initRoutes(this.app);
        }
        if (common_1.Common.indexingEnabled() && config_1.default.MEMPOOL.ENABLED) {
            mining_routes_1.default.initRoutes(this.app);
        }
        if (common_1.Common.isLiquid()) {
            liquid_routes_1.default.initRoutes(this.app);
        }
        if (config_1.default.LIGHTNING.ENABLED) {
            general_routes_1.default.initRoutes(this.app);
            nodes_routes_1.default.initRoutes(this.app);
            channels_routes_1.default.initRoutes(this.app);
        }
        if (config_1.default.MEMPOOL_SERVICES.ACCELERATIONS) {
            acceleration_routes_1.default.initRoutes(this.app);
        }
        if (config_1.default.WALLETS.ENABLED) {
            services_routes_1.default.initRoutes(this.app);
        }
        if (!config_1.default.MEMPOOL.OFFICIAL) {
            about_routes_1.default.initRoutes(this.app);
        }
        // HACK -- Ordpool API routes
        ordpool_routes_1.default.initRoutes(this.app);
    }
    healthCheck() {
        const now = Date.now();
        const stats = v8_1.default.getHeapStatistics();
        this.maxHeapSize = Math.max(stats.used_heap_size, this.maxHeapSize);
        const warnThreshold = 0.8 * stats.heap_size_limit;
        const byteUnits = (0, format_1.getBytesUnit)(Math.max(this.maxHeapSize, stats.heap_size_limit));
        if (!this.warnedHeapCritical && this.maxHeapSize > warnThreshold) {
            this.warnedHeapCritical = true;
            logger_1.default.warn(`Used ${(this.maxHeapSize / stats.heap_size_limit * 100).toFixed(2)}% of heap limit (${(0, format_1.formatBytes)(this.maxHeapSize, byteUnits, true)} / ${(0, format_1.formatBytes)(stats.heap_size_limit, byteUnits)})!`);
        }
        if (this.lastHeapLogTime === null || (now - this.lastHeapLogTime) > (this.heapLogInterval * 1000)) {
            logger_1.default.debug(`Memory usage: ${(0, format_1.formatBytes)(this.maxHeapSize, byteUnits)} / ${(0, format_1.formatBytes)(stats.heap_size_limit, byteUnits)}`);
            this.warnedHeapCritical = false;
            this.maxHeapSize = 0;
            this.lastHeapLogTime = now;
        }
    }
    forceExit(exitEvent, code) {
        logger_1.default.debug(`triggering exit for signal: ${exitEvent}`);
        if (code != null) {
            // override the default exit code
            process.exitCode = code;
        }
        process.exit();
    }
    exitCleanup() {
        if (config_1.default.DATABASE.ENABLED) {
            database_1.default.releasePidLock();
        }
        this.server?.close();
        this.serverUnixSocket?.close();
        this.wss?.close();
        if (this.wssUnixSocket) {
            this.wssUnixSocket.close();
        }
    }
}
(() => new Server())();
