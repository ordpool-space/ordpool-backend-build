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
const config_1 = __importDefault(require("../../config"));
const axios_1 = __importStar(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const logger_1 = __importDefault(require("../../logger"));
const common_1 = require("../common");
const os_1 = __importDefault(require("os"));
const bitcoin_api_factory_1 = require("./bitcoin-api-factory");
class FailoverRouter {
    activeHost;
    fallbackHost;
    maxSlippage = config_1.default.ESPLORA.MAX_BEHIND_TIP ?? (common_1.Common.isLiquid() ? 8 : 2);
    maxHeight = 0;
    hosts;
    multihost;
    gitHashInterval = 60000; // 1 minute
    pollInterval = 60000; // 1 minute
    pollTimer = null;
    pollConnection = axios_1.default.create();
    localHostname = 'localhost';
    requestConnection = axios_1.default.create({
        httpAgent: new http_1.default.Agent({ keepAlive: true })
    });
    constructor() {
        try {
            this.localHostname = os_1.default.hostname();
        }
        catch (e) {
            logger_1.default.warn('Failed to set local hostname, using "localhost"');
        }
        // setup list of hosts
        this.hosts = (config_1.default.ESPLORA.FALLBACK || []).map(domain => {
            return {
                host: domain,
                checked: false,
                rtts: [],
                rtt: Infinity,
                failures: 0,
                publicDomain: 'https://' + this.extractPublicDomain(domain),
                hashes: {
                    lastUpdated: 0,
                },
            };
        });
        this.activeHost = {
            host: config_1.default.ESPLORA.UNIX_SOCKET_PATH || config_1.default.ESPLORA.REST_API_URL,
            rtts: [],
            rtt: 0,
            failures: 0,
            socket: !!config_1.default.ESPLORA.UNIX_SOCKET_PATH,
            preferred: true,
            checked: false,
            publicDomain: `http://${this.localHostname}`,
            hashes: {
                lastUpdated: 0,
            },
        };
        this.fallbackHost = this.activeHost;
        this.hosts.unshift(this.activeHost);
        this.multihost = this.hosts.length > 1;
    }
    startHealthChecks() {
        // use axios interceptors to measure request rtt
        this.pollConnection.interceptors.request.use((config) => {
            config['meta'] = { startTime: Date.now() };
            return config;
        });
        this.pollConnection.interceptors.response.use((response) => {
            response.config['meta'].rtt = Date.now() - response.config['meta'].startTime;
            return response;
        });
        if (this.multihost) {
            void this.pollHosts();
        }
    }
    // start polling hosts to measure availability & rtt
    /** @asyncSafe */
    async pollHosts() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        const start = Date.now();
        // update rtts & sync status
        for (const host of this.hosts) {
            try {
                const result = await (host.socket
                    ? this.pollConnection.get('http://api/blocks/tip/height', { socketPath: host.host, timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT })
                    : this.pollConnection.get(host.host + '/blocks/tip/height', { timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT }));
                if (result) {
                    const height = result.data;
                    host.latestHeight = height;
                    this.maxHeight = Math.max(height || 0, ...this.hosts.map(h => (!(h.unreachable || h.timedOut || h.outOfSync) ? h.latestHeight || 0 : 0)));
                    const rtt = result.config['meta'].rtt;
                    host.rtts.unshift(rtt);
                    host.rtts.slice(0, 5);
                    host.rtt = host.rtts.reduce((acc, l) => acc + l, 0) / host.rtts.length;
                    if (height == null || isNaN(height) || (this.maxHeight - height > this.maxSlippage)) {
                        host.outOfSync = true;
                    }
                    else {
                        host.outOfSync = false;
                    }
                    host.unreachable = false;
                    // update esplora git hash using the x-powered-by header from the height check
                    const poweredBy = result.headers['x-powered-by'];
                    if (poweredBy) {
                        const match = poweredBy.match(/([a-fA-F0-9]{5,40})/);
                        if (match && match[1]?.length) {
                            host.hashes.electrs = match[1];
                        }
                    }
                    await this.$updateLiquidAudit(host);
                    // Check front and backend git hashes less often
                    if (Date.now() - host.hashes.lastUpdated > this.gitHashInterval) {
                        await Promise.all([
                            this.$updateFrontendGitHash(host),
                            this.$updateBackendVersions(host),
                            this.$updateSSRGitHash(host),
                            config_1.default.MEMPOOL.OFFICIAL ? this.$updateHybridGitHash(host) : Promise.resolve(),
                        ]);
                        host.hashes.lastUpdated = Date.now();
                    }
                }
                else {
                    host.outOfSync = true;
                    host.unreachable = true;
                    host.rtts = [];
                    host.rtt = Infinity;
                }
                host.timedOut = false;
            }
            catch (e) {
                host.outOfSync = true;
                host.unreachable = true;
                host.rtts = [];
                host.rtt = Infinity;
                if ((0, axios_1.isAxiosError)(e) && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) {
                    host.timedOut = true;
                }
                else {
                    host.timedOut = false;
                }
            }
            host.checked = true;
            host.lastChecked = Date.now();
            const rankOrder = this.sortHosts();
            // switch if the current host is out of sync or significantly slower than the next best alternative
            if (this.activeHost.outOfSync || this.activeHost.unreachable || (this.activeHost !== rankOrder[0] && rankOrder[0].preferred) || (!this.activeHost.preferred && this.activeHost.rtt > (rankOrder[0].rtt * 2) + 50)) {
                if (this.activeHost.unreachable) {
                    logger_1.default.warn(`🚨🚨🚨 Unable to reach ${this.activeHost.host}, failing over to next best alternative 🚨🚨🚨`);
                }
                else if (this.activeHost.outOfSync) {
                    logger_1.default.warn(`🚨🚨🚨 ${this.activeHost.host} has fallen behind, failing over to next best alternative 🚨🚨🚨`);
                }
                else {
                    logger_1.default.debug(`🛠️ ${this.activeHost.host} is no longer the best esplora host 🛠️`);
                }
                this.electHost();
            }
            await common_1.Common.sleep$(50);
        }
        const rankOrder = this.updateFallback();
        logger_1.default.debug(`Tomahawk ranking:\n${rankOrder.map((host, index) => this.formatRanking(index, host, this.activeHost, this.maxHeight)).join('\n')}`);
        const elapsed = Date.now() - start;
        this.pollTimer = setTimeout(() => { void this.pollHosts(); }, Math.max(1, this.pollInterval - elapsed));
    }
    formatRanking(index, host, active, maxHeight) {
        const heightStatus = !host.checked ? '⏳' : (host.outOfSync ? '🚫' : (host.latestHeight && host.latestHeight < maxHeight ? '🟧' : '✅'));
        return `${host === active ? '⭐️' : '  '} ${host.rtt < Infinity ? Math.round(host.rtt).toString().padStart(5, ' ') + 'ms' : (host.timedOut ? '  ⌛️💥 ' : '    -  ')} ${!host.checked ? '⏳' : (host.unreachable ? '🔥' : '✅')} | block: ${host.latestHeight || '??????'} ${heightStatus} | ${host.host} ${host === active ? '⭐️' : '  '}`;
    }
    updateFallback() {
        const rankOrder = this.sortHosts();
        if (rankOrder.length > 1 && rankOrder[0] === this.activeHost) {
            this.fallbackHost = rankOrder[1];
        }
        else {
            this.fallbackHost = rankOrder[0];
        }
        return rankOrder;
    }
    // sort hosts by connection quality, and update default fallback
    sortHosts() {
        // sort by connection quality
        return this.hosts.slice().sort((a, b) => {
            if ((a.unreachable || a.outOfSync) === (b.unreachable || b.outOfSync)) {
                if (a.preferred === b.preferred) {
                    // lower rtt is best
                    return a.rtt - b.rtt;
                }
                else { // unless we have a preferred host
                    return a.preferred ? -1 : 1;
                }
            }
            else { // or the host is out of sync
                return (a.unreachable || a.outOfSync) ? 1 : -1;
            }
        });
    }
    // depose the active host and choose the next best replacement
    electHost() {
        this.activeHost.failures = 0;
        const rankOrder = this.sortHosts();
        this.activeHost = rankOrder[0];
        logger_1.default.warn(`Switching esplora host to ${this.activeHost.host}`);
    }
    addFailure(host) {
        host.failures++;
        if (host.failures > 5 && this.multihost) {
            logger_1.default.warn(`🚨🚨🚨 Too many esplora failures on ${this.activeHost.host}, falling back to next best alternative 🚨🚨🚨`);
            this.activeHost.unreachable = true;
            this.electHost();
            return this.activeHost;
        }
        else {
            return this.fallbackHost;
        }
    }
    // methods for retrieving git hashes by host
    async $updateFrontendGitHash(host) {
        try {
            const url = `${host.publicDomain}/resources/config.js`;
            const response = await this.pollConnection.get(url, {
                timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                headers: common_1.Common.isLiquid() ? { 'Host': 'liquid.network' } : undefined
            });
            const match = response.data.match(/GIT_COMMIT_HASH\s*=\s*['"](.*?)['"]/);
            if (match && match[1]?.length) {
                host.hashes.frontend = match[1];
            }
            const hybridMatch = response.data.match(/GIT_COMMIT_HASH_MEMPOOL_SPACE\s*=\s*['"](.*?)['"]/);
            if (hybridMatch && hybridMatch[1]?.length) {
                host.hashes.hybrid = hybridMatch[1];
            }
        }
        catch (e) {
            // failed to get frontend build hash - do nothing
        }
    }
    async $updateHybridGitHash(host) {
        try {
            const response = await new Promise((resolve, reject) => {
                const req = https_1.default.request({
                    hostname: host.publicDomain.replace('https://', '').replace('http://', ''),
                    port: 443,
                    path: '/en-US/resources/config.js',
                    method: 'GET',
                    headers: {
                        'Host': common_1.Common.isLiquid() ? 'liquid.network' : 'mempool.space'
                    },
                    timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(data);
                        }
                        else {
                            reject(new Error(`Failed to get hybrid git hash: ${res.statusCode}`));
                        }
                    });
                });
                req.on('error', (e) => {
                    reject(e);
                });
                req.end();
            });
            const match = response.match(/GIT_COMMIT_HASH_MEMPOOL_SPACE\s*=\s*['"](.*?)['"]/);
            if (match && match[1]?.length) {
                host.hashes.hybrid = match[1];
            }
        }
        catch (e) {
            // failed to get frontend build hash - do nothing
        }
    }
    async $updateBackendVersions(host) {
        try {
            const url = `${host.publicDomain}/api/v1/backend-info`;
            const response = await this.pollConnection.get(url, {
                timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                headers: common_1.Common.isLiquid() ? { 'Host': 'liquid.network' } : undefined
            });
            if (response.data?.gitCommit) {
                host.hashes.backend = response.data.gitCommit;
            }
            if (response.data?.coreVersion) {
                host.hashes.core = response.data.coreVersion;
            }
            if (response.data?.osVersion) {
                host.hashes.os = response.data.osVersion;
            }
        }
        catch (e) {
            // failed to get backend build hash - do nothing
        }
    }
    async $updateSSRGitHash(host) {
        try {
            const url = `${host.publicDomain}/ssr/api/status`;
            const response = await this.pollConnection.get(url, {
                timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                headers: common_1.Common.isLiquid() ? { 'Host': 'liquid.network' } : undefined
            });
            if (response.data?.gitHash) {
                host.hashes.ssr = response.data.gitHash;
            }
        }
        catch (e) {
            // failed to get ssr build hash - do nothing
        }
    }
    async $updateLiquidAudit(host) {
        if (config_1.default.MEMPOOL.NETWORK !== 'liquid') {
            return;
        }
        try {
            const [reservesResponse, pegsResponse] = await Promise.all([
                this.pollConnection.get(`${host.publicDomain}/api/v1/liquid/reserves`, {
                    timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                    headers: { 'Host': 'liquid.network' }
                }),
                this.pollConnection.get(`${host.publicDomain}/api/v1/liquid/pegs`, {
                    timeout: config_1.default.ESPLORA.FALLBACK_TIMEOUT,
                    headers: { 'Host': 'liquid.network' }
                }),
            ]);
            const reservesAmount = Number(reservesResponse.data?.amount);
            const pegsAmount = Number(pegsResponse.data?.amount);
            const bitcoinLastBlockUpdate = Number(reservesResponse.data?.lastBlockUpdate);
            const liquidLastBlockUpdate = Number(pegsResponse.data?.lastBlockUpdate);
            if (Number.isFinite(reservesAmount) && Number.isFinite(pegsAmount) && Number.isFinite(bitcoinLastBlockUpdate) && Number.isFinite(liquidLastBlockUpdate) && pegsAmount > 0) {
                host.liquidAudit = {
                    pegRatio: (reservesAmount / pegsAmount) * 100,
                    bitcoinLastBlockUpdate,
                    liquidLastBlockUpdate,
                };
            }
        }
        catch (e) {
            // failed to get liquid audit values - do nothing
        }
    }
    // returns the public mempool domain corresponding to an esplora server url
    // (a bit of a hack to avoid manually specifying frontend & backend URLs for each esplora server)
    extractPublicDomain(url) {
        // force the url to start with a valid protocol
        const urlWithProtocol = url.startsWith('http') ? url : `https://${url}`;
        // parse as URL and extract the hostname
        try {
            const parsed = new URL(urlWithProtocol);
            return parsed.hostname;
        }
        catch (e) {
            // fallback to the original url
            return url;
        }
    }
    async $query(method, path, data, responseType = 'json', host = this.activeHost, retry = true) {
        let axiosConfig;
        let url;
        if (host.socket) {
            axiosConfig = { socketPath: host.host, timeout: config_1.default.ESPLORA.REQUEST_TIMEOUT, responseType };
            url = 'http://api' + path;
        }
        else {
            axiosConfig = { timeout: config_1.default.ESPLORA.REQUEST_TIMEOUT, responseType };
            url = host.host + path;
        }
        if (data?.params) {
            axiosConfig.params = data.params;
        }
        return (method === 'post'
            ? this.requestConnection.post(url, data, axiosConfig)
            : this.requestConnection.get(url, axiosConfig)).then((response) => { host.failures = Math.max(0, host.failures - 1); return response.data; })
            .catch((e) => {
            let fallbackHost = this.fallbackHost;
            if (e?.response?.status !== 404) {
                logger_1.default.warn(`esplora request failed ${e?.response?.status} ${host.host}${path}`);
                logger_1.default.warn(e instanceof Error ? e.message : e);
                fallbackHost = this.addFailure(host);
            }
            if (retry && e?.code === 'ECONNREFUSED' && this.multihost) {
                // Retry immediately
                return this.$query(method, path, data, responseType, fallbackHost, false);
            }
            else {
                throw e;
            }
        });
    }
    async $get(path, responseType = 'json', params = null) {
        return this.$query('get', path, params ? { params } : null, responseType);
    }
    async $post(path, data, responseType = 'json') {
        return this.$query('post', path, data, responseType);
    }
}
class ElectrsApi {
    failoverRouter = new FailoverRouter();
    $getRawMempool() {
        return this.failoverRouter.$get('/mempool/txids');
    }
    $getRawTransaction(txId) {
        return this.failoverRouter.$get('/tx/' + txId);
    }
    async $getRawTransactions(txids) {
        return this.failoverRouter.$post('/internal/txs', txids, 'json');
    }
    async $getMempoolTransactions(txids) {
        return this.failoverRouter.$post('/internal/mempool/txs', txids, 'json');
    }
    async $getAllMempoolTransactions(lastSeenTxid, max_txs) {
        return this.failoverRouter.$get('/internal/mempool/txs' + (lastSeenTxid ? '/' + lastSeenTxid : ''), 'json', max_txs ? { max_txs } : null);
    }
    $getTransactionHex(txId) {
        return this.failoverRouter.$get('/tx/' + txId + '/hex');
    }
    $getTransactionMerkleProof(txId) {
        return this.failoverRouter.$get('/tx/' + txId + '/merkle-proof');
    }
    $getBlockHeightTip() {
        return this.failoverRouter.$get('/blocks/tip/height');
    }
    $getBlockHashTip() {
        return this.failoverRouter.$get('/blocks/tip/hash');
    }
    /** @asyncUnsafe */
    async $getTxIdsForBlock(hash, fallbackToCore = false) {
        try {
            const txids = await this.failoverRouter.$get('/block/' + hash + '/txids');
            return txids;
        }
        catch (e) {
            if (fallbackToCore && (0, axios_1.isAxiosError)(e) && e.response?.status === 404) {
                // might be a stale block, see if Core has it?
                const coreBlock = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash);
                if (coreBlock?.stale) {
                    return bitcoin_api_factory_1.bitcoinCoreApi.$getTxIdsForBlock(hash);
                }
            }
            throw e;
        }
    }
    /** @asyncUnsafe */
    async $getTxsForBlock(hash, fallbackToCore = false) {
        try {
            const txs = await this.failoverRouter.$get('/internal/block/' + hash + '/txs');
            return txs;
        }
        catch (e) {
            if (fallbackToCore && (0, axios_1.isAxiosError)(e) && e.response?.status === 404) {
                // might be a stale block, see if Core has it?
                const coreBlock = await bitcoin_api_factory_1.bitcoinCoreApi.$getBlock(hash);
                if (coreBlock?.stale) {
                    return bitcoin_api_factory_1.bitcoinCoreApi.$getTxsForBlock(hash);
                }
            }
            throw e;
        }
    }
    $getBlockHash(height) {
        return this.failoverRouter.$get('/block-height/' + height);
    }
    $getBlockHeader(hash) {
        return this.failoverRouter.$get('/block/' + hash + '/header');
    }
    $getBlock(hash) {
        return this.failoverRouter.$get('/block/' + hash);
    }
    $getRawBlock(hash) {
        return this.failoverRouter.$get('/block/' + hash + '/raw', 'arraybuffer')
            .then((response) => { return Buffer.from(response.data); });
    }
    $getAddress(address) {
        return this.failoverRouter.$get('/address/' + address);
    }
    $getAddressTransactions(address, txId) {
        throw new Error('Method getAddressTransactions not implemented.');
    }
    $getAddressUtxos(address) {
        return this.failoverRouter.$get('/address/' + address + '/utxo');
    }
    $getScriptHash(scripthash) {
        throw new Error('Method getScriptHash not implemented.');
    }
    $getScriptHashTransactions(scripthash, txId) {
        throw new Error('Method getScriptHashTransactions not implemented.');
    }
    $getScriptHashUtxos(scripthash) {
        throw new Error('Method getScriptHashUtxos not implemented.');
    }
    $getAddressPrefix(prefix) {
        throw new Error('Method not implemented.');
    }
    $sendRawTransaction(rawTransaction) {
        throw new Error('Method not implemented.');
    }
    $testMempoolAccept(rawTransactions, maxfeerate) {
        throw new Error('Method not implemented.');
    }
    $submitPackage(rawTransactions) {
        throw new Error('Method not implemented.');
    }
    $getOutspend(txId, vout) {
        return this.failoverRouter.$get('/tx/' + txId + '/outspend/' + vout);
    }
    $getOutspends(txId) {
        return this.failoverRouter.$get('/tx/' + txId + '/outspends');
    }
    async $getBatchedOutspends(txids) {
        throw new Error('Method not implemented.');
    }
    async $getBatchedOutspendsInternal(txids) {
        return this.failoverRouter.$post('/internal/txs/outspends/by-txid', txids, 'json');
    }
    async $getOutSpendsByOutpoint(outpoints) {
        return this.failoverRouter.$post('/internal/txs/outspends/by-outpoint', outpoints.map(out => `${out.txid}:${out.vout}`), 'json');
    }
    /** @asyncUnsafe */
    async $getCoinbaseTx(blockhash) {
        const txid = await this.failoverRouter.$get(`/block/${blockhash}/txid/0`);
        return this.failoverRouter.$get('/tx/' + txid);
    }
    async $getAddressTransactionSummary(address) {
        return this.failoverRouter.$get('/address/' + address + '/txs/summary');
    }
    startHealthChecks() {
        this.failoverRouter.startHealthChecks();
    }
    getHealthStatus() {
        if (config_1.default.MEMPOOL.OFFICIAL) {
            return this.failoverRouter.sortHosts().map(host => ({
                host: host.host,
                active: host === this.failoverRouter.activeHost,
                rtt: host.rtt,
                latestHeight: host.latestHeight || 0,
                socket: !!host.socket,
                outOfSync: !!host.outOfSync,
                unreachable: !!host.unreachable,
                checked: !!host.checked,
                lastChecked: host.lastChecked || 0,
                hashes: host.hashes,
                ...(config_1.default.MEMPOOL.NETWORK === 'liquid' ? { liquidAudit: host.liquidAudit } : {}),
            }));
        }
        else {
            return [];
        }
    }
}
exports.default = ElectrsApi;
