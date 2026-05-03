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
const fs = __importStar(require("fs"));
const fsPromises = fs.promises;
const cluster_1 = __importDefault(require("cluster"));
const mempool_1 = __importDefault(require("./mempool"));
const blocks_1 = __importDefault(require("./blocks"));
const logger_1 = __importDefault(require("../logger"));
const config_1 = __importDefault(require("../config"));
const common_1 = require("./common");
const rbf_cache_1 = __importDefault(require("./rbf-cache"));
class DiskCache {
    cacheSchemaVersion = 3;
    rbfCacheSchemaVersion = 1;
    static TMP_FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/tmp-cache.json';
    static TMP_FILE_NAMES = config_1.default.MEMPOOL.CACHE_DIR + '/tmp-cache{number}.json';
    static FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/cache.json';
    static FILE_NAMES = config_1.default.MEMPOOL.CACHE_DIR + '/cache{number}.json';
    static TMP_RBF_FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/tmp-rbfcache.json';
    static RBF_FILE_NAME = config_1.default.MEMPOOL.CACHE_DIR + '/rbfcache.json';
    static CHUNK_FILES = 25;
    isWritingCache = false;
    ignoreBlocksCache = false;
    semaphore = {
        resume: [],
        locks: 0,
    };
    constructor() {
        if (!cluster_1.default.isPrimary || !config_1.default.MEMPOOL.CACHE_ENABLED) {
            return;
        }
        process.on('SIGINT', (e) => {
            void this.$saveCacheToDisk(true);
            process.exit(0);
        });
    }
    /** @asyncSafe */
    async $saveCacheToDisk(sync = false) {
        if (!cluster_1.default.isPrimary || !config_1.default.MEMPOOL.CACHE_ENABLED) {
            return;
        }
        if (this.isWritingCache) {
            logger_1.default.debug('Saving cache already in progress. Skipping.');
            return;
        }
        try {
            logger_1.default.debug(`Writing mempool and blocks data to disk cache (${sync ? 'sync' : 'async'})...`);
            this.isWritingCache = true;
            const mempool = mempool_1.default.getMempool();
            const mempoolArray = [];
            for (const tx in mempool) {
                if (mempool[tx]) {
                    mempoolArray.push(mempool[tx]);
                }
            }
            common_1.Common.shuffleArray(mempoolArray);
            const chunkSize = Math.floor(mempoolArray.length / DiskCache.CHUNK_FILES);
            if (sync) {
                fs.writeFileSync(DiskCache.TMP_FILE_NAME, JSON.stringify({
                    network: config_1.default.MEMPOOL.NETWORK,
                    cacheSchemaVersion: this.cacheSchemaVersion,
                    blocks: blocks_1.default.getBlocks(),
                    blockSummaries: blocks_1.default.getBlockSummaries(),
                    mempool: {},
                    mempoolArray: mempoolArray.splice(0, chunkSize),
                }), { flag: 'w' });
                for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
                    fs.writeFileSync(DiskCache.TMP_FILE_NAMES.replace('{number}', i.toString()), JSON.stringify({
                        mempool: {},
                        mempoolArray: mempoolArray.splice(0, chunkSize),
                    }), { flag: 'w' });
                }
                fs.renameSync(DiskCache.TMP_FILE_NAME, DiskCache.FILE_NAME);
                for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
                    fs.renameSync(DiskCache.TMP_FILE_NAMES.replace('{number}', i.toString()), DiskCache.FILE_NAMES.replace('{number}', i.toString()));
                }
            }
            else {
                await this.$yield();
                await fsPromises.writeFile(DiskCache.TMP_FILE_NAME, JSON.stringify({
                    network: config_1.default.MEMPOOL.NETWORK,
                    cacheSchemaVersion: this.cacheSchemaVersion,
                    blocks: blocks_1.default.getBlocks(),
                    blockSummaries: blocks_1.default.getBlockSummaries(),
                    mempool: {},
                    mempoolArray: mempoolArray.splice(0, chunkSize),
                }), { flag: 'w' });
                for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
                    await this.$yield();
                    await fsPromises.writeFile(DiskCache.TMP_FILE_NAMES.replace('{number}', i.toString()), JSON.stringify({
                        mempool: {},
                        mempoolArray: mempoolArray.splice(0, chunkSize),
                    }), { flag: 'w' });
                }
                await fsPromises.rename(DiskCache.TMP_FILE_NAME, DiskCache.FILE_NAME);
                for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
                    await fsPromises.rename(DiskCache.TMP_FILE_NAMES.replace('{number}', i.toString()), DiskCache.FILE_NAMES.replace('{number}', i.toString()));
                }
            }
            logger_1.default.debug('Mempool and blocks data saved to disk cache');
            this.isWritingCache = false;
        }
        catch (e) {
            logger_1.default.warn('Error writing to cache file: ' + (e instanceof Error ? e.message : e));
            this.isWritingCache = false;
        }
        try {
            logger_1.default.debug('Writing rbf data to disk cache (async)...');
            this.isWritingCache = true;
            const rbfData = rbf_cache_1.default.dump();
            if (sync) {
                fs.writeFileSync(DiskCache.TMP_RBF_FILE_NAME, JSON.stringify({
                    network: config_1.default.MEMPOOL.NETWORK,
                    rbfCacheSchemaVersion: this.rbfCacheSchemaVersion,
                    rbf: rbfData,
                }), { flag: 'w' });
                fs.renameSync(DiskCache.TMP_RBF_FILE_NAME, DiskCache.RBF_FILE_NAME);
            }
            else {
                await fsPromises.writeFile(DiskCache.TMP_RBF_FILE_NAME, JSON.stringify({
                    network: config_1.default.MEMPOOL.NETWORK,
                    rbfCacheSchemaVersion: this.rbfCacheSchemaVersion,
                    rbf: rbfData,
                }), { flag: 'w' });
                await fsPromises.rename(DiskCache.TMP_RBF_FILE_NAME, DiskCache.RBF_FILE_NAME);
            }
            logger_1.default.debug('Rbf data saved to disk cache');
            this.isWritingCache = false;
        }
        catch (e) {
            logger_1.default.warn('Error writing rbf data to cache file: ' + (e instanceof Error ? e.message : e));
            this.isWritingCache = false;
        }
    }
    wipeCache() {
        logger_1.default.notice(`Wiping nodejs backend cache/cache*.json files`);
        try {
            fs.unlinkSync(DiskCache.FILE_NAME);
        }
        catch (e) {
            if (e?.code !== 'ENOENT') {
                logger_1.default.err(`Cannot wipe cache file ${DiskCache.FILE_NAME}. Exception ${JSON.stringify(e)}`);
            }
        }
        for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
            const filename = DiskCache.FILE_NAMES.replace('{number}', i.toString());
            try {
                fs.unlinkSync(filename);
            }
            catch (e) {
                if (e?.code !== 'ENOENT') {
                    logger_1.default.err(`Cannot wipe cache file ${filename}. Exception ${JSON.stringify(e)}`);
                }
            }
        }
    }
    wipeRbfCache() {
        logger_1.default.notice(`Wipping nodejs backend cache/rbfcache.json file`);
        try {
            fs.unlinkSync(DiskCache.RBF_FILE_NAME);
        }
        catch (e) {
            if (e?.code !== 'ENOENT') {
                logger_1.default.err(`Cannot wipe cache file ${DiskCache.RBF_FILE_NAME}. Exception ${JSON.stringify(e)}`);
            }
        }
    }
    /** @asyncSafe */
    async $loadMempoolCache() {
        if (!config_1.default.MEMPOOL.CACHE_ENABLED || !fs.existsSync(DiskCache.FILE_NAME)) {
            return;
        }
        try {
            const start = Date.now();
            let data = {};
            const cacheData = fs.readFileSync(DiskCache.FILE_NAME, 'utf8');
            if (cacheData) {
                logger_1.default.info('Restoring mempool and blocks data from disk cache');
                data = JSON.parse(cacheData);
                if (data.cacheSchemaVersion === undefined || data.cacheSchemaVersion !== this.cacheSchemaVersion) {
                    logger_1.default.notice('Disk cache contains an outdated schema version. Clearing it and skipping the cache loading.');
                    return this.wipeCache();
                }
                if (data.network && data.network !== config_1.default.MEMPOOL.NETWORK) {
                    logger_1.default.notice('Disk cache contains data from a different network. Clearing it and skipping the cache loading.');
                    return this.wipeCache();
                }
                if (data.mempoolArray) {
                    for (const tx of data.mempoolArray) {
                        delete tx.uid;
                        data.mempool[tx.txid] = tx;
                    }
                }
            }
            for (let i = 1; i < DiskCache.CHUNK_FILES; i++) {
                const fileName = DiskCache.FILE_NAMES.replace('{number}', i.toString());
                try {
                    if (fs.existsSync(fileName)) {
                        const cacheData2 = JSON.parse(fs.readFileSync(fileName, 'utf8'));
                        if (cacheData2.mempoolArray) {
                            for (const tx of cacheData2.mempoolArray) {
                                delete tx.uid;
                                data.mempool[tx.txid] = tx;
                            }
                        }
                        else {
                            Object.assign(data.mempool, cacheData2.mempool);
                        }
                    }
                }
                catch (e) {
                    logger_1.default.err('Error parsing ' + fileName + '. Skipping. Reason: ' + (e instanceof Error ? e.message : e));
                }
            }
            logger_1.default.info(`Loaded mempool from disk cache in ${Date.now() - start} ms`);
            await mempool_1.default.$setMempool(data.mempool);
            if (!this.ignoreBlocksCache) {
                blocks_1.default.setBlocks(data.blocks);
                blocks_1.default.setBlockSummaries(data.blockSummaries || []);
            }
            else {
                logger_1.default.info('Re-saving cache with empty recent blocks data');
                await this.$saveCacheToDisk(true);
            }
        }
        catch (e) {
            logger_1.default.warn('Failed to parse mempoool and blocks cache. Skipping. Reason: ' + (e instanceof Error ? e.message : e));
        }
        try {
            let rbfData = {};
            const rbfCacheData = fs.readFileSync(DiskCache.RBF_FILE_NAME, 'utf8');
            if (rbfCacheData) {
                logger_1.default.info('Restoring rbf data from disk cache');
                rbfData = JSON.parse(rbfCacheData);
                if (rbfData.rbfCacheSchemaVersion === undefined || rbfData.rbfCacheSchemaVersion !== this.rbfCacheSchemaVersion) {
                    logger_1.default.notice('Rbf disk cache contains an outdated schema version. Clearing it and skipping the cache loading.');
                    return this.wipeRbfCache();
                }
                if (rbfData.network && rbfData.network !== config_1.default.MEMPOOL.NETWORK) {
                    logger_1.default.notice('Rbf disk cache contains data from a different network. Clearing it and skipping the cache loading.');
                    return this.wipeRbfCache();
                }
            }
            if (rbfData?.rbf) {
                await rbf_cache_1.default.load({
                    txs: rbfData.rbf.txs.map(([txid, entry]) => ({ value: entry })),
                    trees: rbfData.rbf.trees,
                    expiring: rbfData.rbf.expiring.map(([txid, value]) => ({ key: txid, value })),
                    mempool: mempool_1.default.getMempool(),
                    spendMap: mempool_1.default.getSpendMap(),
                });
            }
        }
        catch (e) {
            logger_1.default.warn('Failed to parse rbf cache. Skipping. Reason: ' + (e instanceof Error ? e.message : e));
        }
    }
    $yield() {
        if (this.semaphore.locks) {
            logger_1.default.debug('Pause writing mempool and blocks data to disk cache (async)');
            return new Promise((resolve) => {
                this.semaphore.resume.push(resolve);
            });
        }
        else {
            return Promise.resolve();
        }
    }
    lock() {
        this.semaphore.locks++;
    }
    unlock() {
        this.semaphore.locks = Math.max(0, this.semaphore.locks - 1);
        if (!this.semaphore.locks && this.semaphore.resume.length) {
            const nextResume = this.semaphore.resume.shift();
            if (nextResume) {
                logger_1.default.debug('Resume writing mempool and blocks data to disk cache (async)');
                nextResume();
            }
        }
    }
    setIgnoreBlocksCache() {
        this.ignoreBlocksCache = true;
    }
}
exports.default = new DiskCache();
