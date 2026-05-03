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
const logger_1 = __importDefault(require("../logger"));
const WebSocket = __importStar(require("ws"));
const blocks_1 = __importDefault(require("./blocks"));
const mempool_1 = __importDefault(require("./mempool"));
const backend_info_1 = __importDefault(require("./backend-info"));
const mempool_blocks_1 = __importDefault(require("./mempool-blocks"));
const common_1 = require("./common");
const loading_indicators_1 = __importDefault(require("./loading-indicators"));
const config_1 = __importDefault(require("../config"));
const transaction_utils_1 = __importDefault(require("./transaction-utils"));
const rbf_cache_1 = __importDefault(require("./rbf-cache"));
const difficulty_adjustment_1 = __importDefault(require("./difficulty-adjustment"));
const fee_api_1 = __importDefault(require("./fee-api"));
const price_updater_1 = __importDefault(require("../tasks/price-updater"));
const acceleration_1 = __importDefault(require("./services/acceleration"));
const mempool_2 = __importDefault(require("./mempool"));
const bitcoin_api_factory_1 = __importDefault(require("./bitcoin/bitcoin-api-factory"));
const wallets_1 = __importDefault(require("./services/wallets"));
const cpfp_1 = require("./cpfp");
const stratum_1 = __importDefault(require("./services/stratum"));
const OrdpoolBlocksRepository_helper_1 = require("../repositories/OrdpoolBlocksRepository.helper");
// valid 'want' subscriptions
const wantable = [
    'blocks',
    'mempool-blocks',
    'live-2h-chart',
    'stats',
    'tomahawk',
];
class WebsocketHandler {
    webSocketServers = [];
    extraInitProperties = {};
    numClients = 0;
    numConnected = 0;
    numDisconnected = 0;
    socketData = {};
    serializedInitData = '{}';
    lastRbfSummary = null;
    mempoolSequence = 0;
    accelerations = {};
    MAX_BUFFERED_AMOUNT = 10_000_000;
    MAX_MESSAGE_SIZE = 50_000;
    MAX_TRACKED_TXS = 100;
    MSG_RATE_LIMIT = 100;
    MSG_RATE_WINDOW = 10_000;
    constructor() { }
    addWebsocketServer(wss) {
        this.webSocketServers.push(wss);
    }
    setExtraInitData(property, value) {
        this.extraInitProperties[property] = value;
        this.updateSocketDataFields(this.extraInitProperties);
    }
    updateSocketDataFields(data) {
        for (const property of Object.keys(data)) {
            if (data[property] != null) {
                this.socketData[property] = JSON.stringify(data[property]);
            }
            else {
                delete this.socketData[property];
            }
        }
        this.serializedInitData = '{'
            + Object.keys(this.socketData).map(key => `"${key}": ${this.socketData[key]}`).join(', ')
            + '}';
    }
    updateSocketData() {
        const _blocks = blocks_1.default.getBlocks().slice(-config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT);
        const da = difficulty_adjustment_1.default.getDifficultyAdjustment();
        this.updateSocketDataFields({
            'backend': config_1.default.MEMPOOL.BACKEND,
            'mempoolInfo': mempool_1.default.getMempoolInfo(),
            'vBytesPerSecond': mempool_1.default.getVBytesPerSecond(),
            'blocks': (0, OrdpoolBlocksRepository_helper_1.mapCat21MintsToMinimal)(_blocks),
            'conversions': price_updater_1.default.getLatestPrices(),
            'mempool-blocks': mempool_blocks_1.default.getMempoolBlocks(),
            'transactions': mempool_1.default.getLatestTransactions(),
            'backendInfo': backend_info_1.default.getBackendInfo(),
            'loadingIndicators': loading_indicators_1.default.getLoadingIndicators(),
            'da': da?.previousTime ? da : undefined,
            'fees': fee_api_1.default.getPreciseRecommendedFee(),
        });
    }
    getSerializedInitData() {
        return this.serializedInitData;
    }
    setupConnectionHandling() {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.on('connection', (client, req) => {
                this.numConnected++;
                client['remoteAddress'] = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
                client['msgTimestamps'] = [];
                client.on('error', (e) => {
                    logger_1.default.info(`websocket client error from ${client['remoteAddress']}: ` + (e instanceof Error ? e.message : e));
                    client.close();
                });
                client.on('close', () => {
                    this.numDisconnected++;
                });
                client.on('message', async (message) => {
                    try {
                        const msgLength = Buffer.isBuffer(message) ? message.byteLength
                            : message instanceof ArrayBuffer ? message.byteLength
                                : message.reduce((sum, buf) => sum + buf.byteLength, 0);
                        if (msgLength > this.MAX_MESSAGE_SIZE) {
                            logger_1.default.debug(`Dropping oversized websocket message from ${client['remoteAddress']}: ${msgLength} bytes`);
                            client.terminate();
                            return;
                        }
                        const now = Date.now();
                        const timestamps = client['msgTimestamps'];
                        timestamps.push(now);
                        while (timestamps.length && timestamps[0] <= now - this.MSG_RATE_WINDOW) {
                            timestamps.shift();
                        }
                        if (timestamps.length > this.MSG_RATE_LIMIT) {
                            logger_1.default.debug(`Rate limiting websocket client ${client['remoteAddress']}`);
                            client.close();
                            return;
                        }
                        const parsedMessage = JSON.parse(message);
                        const response = {};
                        const wantNow = {};
                        if (parsedMessage && parsedMessage.action === 'want' && Array.isArray(parsedMessage.data)) {
                            for (const sub of wantable) {
                                const key = `want-${sub}`;
                                const wants = parsedMessage.data.includes(sub);
                                if (wants && !client[key]) {
                                    wantNow[key] = true;
                                }
                                client[key] = wants;
                            }
                            client['wants'] = true;
                        }
                        // send initial data when a client first starts a subscription
                        if (wantNow['want-blocks'] || (parsedMessage && parsedMessage['refresh-blocks'])) {
                            response['blocks'] = this.socketData['blocks'];
                        }
                        if (wantNow['want-mempool-blocks']) {
                            response['mempool-blocks'] = this.socketData['mempool-blocks'];
                        }
                        if (wantNow['want-stats']) {
                            response['mempoolInfo'] = this.socketData['mempoolInfo'];
                            response['vBytesPerSecond'] = this.socketData['vBytesPerSecond'];
                            response['fees'] = this.socketData['fees'];
                            response['da'] = this.socketData['da'];
                        }
                        if (wantNow['want-tomahawk']) {
                            response['tomahawk'] = JSON.stringify(bitcoin_api_factory_1.default.getHealthStatus());
                        }
                        if (parsedMessage && parsedMessage['track-tx']) {
                            if (/^[a-fA-F0-9]{64}$/.test(parsedMessage['track-tx'])) {
                                client['track-tx'] = parsedMessage['track-tx'];
                                const trackTxid = client['track-tx'];
                                // Client is telling the transaction wasn't found
                                if (parsedMessage['watch-mempool']) {
                                    const rbfCacheTxid = rbf_cache_1.default.getReplacedBy(trackTxid);
                                    if (rbfCacheTxid) {
                                        response['txReplaced'] = JSON.stringify({
                                            txid: rbfCacheTxid,
                                        });
                                        client['track-tx'] = null;
                                    }
                                    else {
                                        // It might have appeared before we had the time to start watching for it
                                        const tx = mempool_1.default.getMempool()[trackTxid];
                                        if (tx) {
                                            if (config_1.default.MEMPOOL.BACKEND === 'esplora') {
                                                response['tx'] = JSON.stringify(tx);
                                            }
                                            else {
                                                // tx.prevout is missing from transactions when in bitcoind mode
                                                try {
                                                    const fullTx = await transaction_utils_1.default.$getMempoolTransactionExtended(tx.txid, true);
                                                    response['tx'] = JSON.stringify(fullTx);
                                                }
                                                catch (e) {
                                                    logger_1.default.debug('Error finding transaction: ' + (e instanceof Error ? e.message : e));
                                                }
                                            }
                                        }
                                        else {
                                            try {
                                                const fullTx = await transaction_utils_1.default.$getMempoolTransactionExtended(client['track-tx'], true);
                                                response['tx'] = JSON.stringify(fullTx);
                                            }
                                            catch (e) {
                                                logger_1.default.debug('Error finding transaction. ' + (e instanceof Error ? e.message : e));
                                                client['track-mempool-tx'] = parsedMessage['track-tx'];
                                            }
                                        }
                                    }
                                }
                                const tx = mempool_1.default.getMempool()[trackTxid];
                                if (tx && tx.position) {
                                    const position = {
                                        ...tx.position
                                    };
                                    if (tx.acceleration) {
                                        position.accelerated = tx.acceleration;
                                    }
                                    response['txPosition'] = JSON.stringify({
                                        txid: trackTxid,
                                        position,
                                        accelerationPositions: mempool_1.default.getAccelerationPositions(tx.txid),
                                    });
                                }
                            }
                            else {
                                client['track-tx'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-txs']) {
                            const txids = [];
                            if (Array.isArray(parsedMessage['track-txs'])) {
                                if (parsedMessage['track-txs'].length > this.MAX_TRACKED_TXS) {
                                    response['track-txs-error'] = `"too many txids requested, this connection supports tracking a maximum of ${this.MAX_TRACKED_TXS} transactions"`;
                                    this.send(client, this.serializeResponse(response));
                                    client['track-txs'] = null;
                                    client.close();
                                    return;
                                }
                                for (const txid of parsedMessage['track-txs']) {
                                    if (/^[a-fA-F0-9]{64}$/.test(txid)) {
                                        txids.push(txid);
                                    }
                                }
                            }
                            else {
                                response['track-txs-error'] = `"incorrect track-txs format"`;
                                this.send(client, this.serializeResponse(response));
                                client['track-txs'] = null;
                                client.close();
                                return;
                            }
                            const txs = {};
                            for (const txid of txids) {
                                const txInfo = {};
                                const rbfCacheTxid = rbf_cache_1.default.getReplacedBy(txid);
                                if (rbfCacheTxid) {
                                    txInfo.replacedBy = rbfCacheTxid;
                                    txInfo.confirmed = false;
                                    txs[txid] = txInfo;
                                }
                                const tx = mempool_1.default.getMempool()[txid];
                                if (tx) {
                                    if (tx.position) {
                                        txInfo.position = {
                                            ...tx.position
                                        };
                                        if (tx.acceleration) {
                                            txInfo.accelerated = tx.acceleration;
                                        }
                                    }
                                    txInfo.confirmed = false;
                                    txs[txid] = txInfo;
                                }
                            }
                            if (txids.length) {
                                client['track-txs'] = txids;
                                client['track-txs-updates'] = 0;
                            }
                            else {
                                client['track-txs'] = null;
                                client['track-txs-updates'] = 0;
                            }
                            if (Object.keys(txs).length) {
                                client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
                                response['tracked-txs'] = JSON.stringify(txs);
                            }
                        }
                        if (parsedMessage && parsedMessage['track-address']) {
                            const validAddress = this.testAddress(parsedMessage['track-address']);
                            if (validAddress) {
                                client['track-address'] = validAddress;
                            }
                            else {
                                client['track-address'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-addresses'] && Array.isArray(parsedMessage['track-addresses'])) {
                            const addressMap = {};
                            for (const address of parsedMessage['track-addresses']) {
                                const validAddress = this.testAddress(address);
                                if (validAddress) {
                                    addressMap[address] = validAddress;
                                }
                            }
                            if (Object.keys(addressMap).length > config_1.default.MEMPOOL.MAX_TRACKED_ADDRESSES) {
                                response['track-addresses-error'] = `"too many addresses requested, this connection supports tracking a maximum of ${config_1.default.MEMPOOL.MAX_TRACKED_ADDRESSES} addresses"`;
                                client['track-addresses'] = null;
                                client['track-addresses-updates'] = 0;
                            }
                            else if (Object.keys(addressMap).length > 0) {
                                client['track-addresses'] = addressMap;
                                client['track-addresses-updates'] = 0;
                            }
                            else {
                                client['track-addresses'] = null;
                                client['track-addresses-updates'] = 0;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-scriptpubkeys'] && Array.isArray(parsedMessage['track-scriptpubkeys'])) {
                            const spks = [];
                            for (const spk of parsedMessage['track-scriptpubkeys']) {
                                if (/^[a-fA-F0-9]+$/.test(spk)) {
                                    spks.push(spk.toLowerCase());
                                }
                            }
                            if (spks.length > config_1.default.MEMPOOL.MAX_TRACKED_ADDRESSES) {
                                response['track-scriptpubkeys-error'] = `"too many scriptpubkeys requested, this connection supports tracking a maximum of ${config_1.default.MEMPOOL.MAX_TRACKED_ADDRESSES} scriptpubkeys"`;
                                client['track-scriptpubkeys'] = null;
                            }
                            else if (spks.length) {
                                client['track-scriptpubkeys'] = spks;
                            }
                            else {
                                client['track-scriptpubkeys'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-wallet']) {
                            if (parsedMessage['track-wallet'] === 'stop') {
                                client['track-wallet'] = null;
                            }
                            else if (typeof parsedMessage['track-wallet'] === 'string' && wallets_1.default.getWallets().includes(parsedMessage['track-wallet'])) {
                                client['track-wallet'] = parsedMessage['track-wallet'];
                            }
                            else {
                                client['track-wallet'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-asset']) {
                            if (/^[a-fA-F0-9]{64}$/.test(parsedMessage['track-asset'])) {
                                client['track-asset'] = parsedMessage['track-asset'];
                            }
                            else {
                                client['track-asset'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-mempool-block'] !== undefined) {
                            if (Number.isInteger(parsedMessage['track-mempool-block']) && parsedMessage['track-mempool-block'] >= 0) {
                                const index = parsedMessage['track-mempool-block'];
                                client['track-mempool-block'] = index;
                                const mBlocksWithTransactions = mempool_blocks_1.default.getMempoolBlocksWithTransactions();
                                response['projected-block-transactions'] = JSON.stringify({
                                    index: index,
                                    sequence: this.mempoolSequence,
                                    blockTransactions: (mBlocksWithTransactions[index]?.transactions || []).map(mempool_blocks_1.default.compressTx),
                                });
                            }
                            else {
                                client['track-mempool-block'] = null;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-rbf'] !== undefined) {
                            if (['all', 'fullRbf'].includes(parsedMessage['track-rbf'])) {
                                client['track-rbf'] = parsedMessage['track-rbf'];
                                response['rbfLatest'] = JSON.stringify(rbf_cache_1.default.getRbfTrees(parsedMessage['track-rbf'] === 'fullRbf'));
                            }
                            else {
                                client['track-rbf'] = false;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-rbf-summary'] != null) {
                            if (parsedMessage['track-rbf-summary']) {
                                client['track-rbf-summary'] = true;
                                if (this.socketData['rbfSummary'] != null) {
                                    response['rbfLatestSummary'] = this.socketData['rbfSummary'];
                                }
                            }
                            else {
                                client['track-rbf-summary'] = false;
                            }
                        }
                        if (parsedMessage && parsedMessage['track-accelerations'] != null) {
                            if (parsedMessage['track-accelerations']) {
                                client['track-accelerations'] = true;
                                response['accelerations'] = JSON.stringify({
                                    accelerations: Object.values(mempool_1.default.getAccelerations()),
                                });
                            }
                            else {
                                client['track-accelerations'] = false;
                            }
                        }
                        if (parsedMessage.action === 'init') {
                            if (!this.socketData['blocks']?.length || !this.socketData['da'] || !this.socketData['backendInfo'] || !this.socketData['conversions']) {
                                this.updateSocketData();
                            }
                            if (!this.socketData['blocks']?.length) {
                                return;
                            }
                            this.send(client, this.serializedInitData);
                        }
                        if (parsedMessage.action === 'ping') {
                            response['pong'] = JSON.stringify(true);
                        }
                        if (typeof parsedMessage['track-donation'] === 'string' && parsedMessage['track-donation'].length === 22) {
                            client['track-donation'] = parsedMessage['track-donation'];
                        }
                        if (parsedMessage['track-mempool-txids'] === true) {
                            client['track-mempool-txids'] = true;
                        }
                        else if (parsedMessage['track-mempool-txids'] === false) {
                            delete client['track-mempool-txids'];
                        }
                        if (parsedMessage['track-mempool'] === true) {
                            client['track-mempool'] = true;
                        }
                        else if (parsedMessage['track-mempool'] === false) {
                            delete client['track-mempool'];
                        }
                        if (parsedMessage && parsedMessage['track-stratum'] != null) {
                            if (parsedMessage['track-stratum'] === 'all' || typeof parsedMessage['track-stratum'] === 'number') {
                                const sub = parsedMessage['track-stratum'];
                                client['track-stratum'] = sub;
                                response['stratumJobs'] = this.socketData['stratumJobs'];
                            }
                            else {
                                client['track-stratum'] = false;
                            }
                        }
                        if (Object.keys(response).length) {
                            this.send(client, this.serializeResponse(response));
                        }
                    }
                    catch (e) {
                        logger_1.default.debug(`Error parsing websocket message from ${client['remoteAddress']}: ` + (e instanceof Error ? e.message : e));
                        client.close();
                    }
                });
            });
        }
    }
    handleNewDonation(id) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (client['track-donation'] === id) {
                    this.send(client, JSON.stringify({ donationConfirmed: true }));
                }
            });
        }
    }
    handleLoadingChanged(indicators) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        this.updateSocketDataFields({ 'loadingIndicators': indicators });
        const response = JSON.stringify({ loadingIndicators: indicators });
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                this.send(client, response);
            });
        }
    }
    handleNewConversionRates(conversionRates) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        this.updateSocketDataFields({ 'conversions': conversionRates });
        const response = JSON.stringify({ conversions: conversionRates });
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                this.send(client, response);
            });
        }
    }
    handleNewStatistic(stats) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        this.printLogs();
        const response = JSON.stringify({
            'live-2h-chart': stats
        });
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (!client['want-live-2h-chart']) {
                    return;
                }
                this.send(client, response);
            });
        }
    }
    handleAccelerationsChanged(accelerations) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server has been set');
        }
        const websocketAccelerationDelta = acceleration_1.default.getAccelerationDelta(this.accelerations, accelerations);
        this.accelerations = accelerations;
        if (!websocketAccelerationDelta.length) {
            return;
        }
        // pre-compute acceleration delta
        const accelerationUpdate = {
            added: websocketAccelerationDelta.map(txid => accelerations[txid]).filter(acc => acc != null),
            removed: websocketAccelerationDelta.filter(txid => !accelerations[txid]),
        };
        try {
            const response = JSON.stringify({
                accelerations: accelerationUpdate,
            });
            for (const server of this.webSocketServers) {
                server.clients.forEach((client) => {
                    if (client.readyState !== WebSocket.OPEN) {
                        return;
                    }
                    this.send(client, response);
                });
            }
        }
        catch (e) {
            logger_1.default.debug(`Error sending acceleration update to websocket clients: ${e}`);
        }
    }
    handleReorg() {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        const da = difficulty_adjustment_1.default.getDifficultyAdjustment();
        // update init data
        this.updateSocketDataFields({
            'blocks': (0, OrdpoolBlocksRepository_helper_1.mapCat21MintsToMinimal)(blocks_1.default.getBlocks()),
            'da': da?.previousTime ? da : undefined,
        });
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                const response = {};
                if (client['want-blocks']) {
                    response['blocks'] = this.socketData['blocks'];
                }
                if (client['want-stats']) {
                    response['da'] = this.socketData['da'];
                }
                if (Object.keys(response).length) {
                    this.send(client, this.serializeResponse(response));
                }
            });
        }
    }
    /**
     *
     * @param newMempool
     * @param mempoolSize
     * @param newTransactions  array of transactions added this mempool update.
     * @param recentlyDeletedTransactions array of arrays of transactions removed in the last N mempool updates, most recent first.
     * @param accelerationDelta
     * @param candidates
     */
    async $handleMempoolChange(newMempool, mempoolSize, newTransactions, recentlyDeletedTransactions, accelerationDelta, candidates) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        this.printLogs();
        const deletedTransactions = recentlyDeletedTransactions.length ? recentlyDeletedTransactions[0] : [];
        const transactionIds = (mempool_1.default.limitGBT && candidates) ? Object.keys(candidates?.txs || {}) : Object.keys(newMempool);
        let added = newTransactions;
        let removed = deletedTransactions;
        if (mempool_1.default.limitGBT) {
            added = candidates?.added || [];
            removed = candidates?.removed || [];
        }
        if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL) {
            const cmBlocks = mempool_2.default.clusterMempool?.getBlocks(config_1.default.MEMPOOL.MEMPOOL_BLOCKS_AMOUNT) ?? [];
            mempool_blocks_1.default.processClusterMempoolBlocks(cmBlocks, newMempool, mempool_2.default.getAccelerations());
        }
        else if (config_1.default.MEMPOOL.RUST_GBT) {
            await mempool_blocks_1.default.$rustUpdateBlockTemplates(transactionIds, newMempool, added, removed, candidates, true);
        }
        else {
            await mempool_blocks_1.default.$updateBlockTemplates(transactionIds, newMempool, added, removed, candidates, accelerationDelta, true, true);
        }
        const mBlocks = mempool_blocks_1.default.getMempoolBlocks();
        const mBlockDeltas = mempool_blocks_1.default.getMempoolBlockDeltas();
        const mempoolInfo = mempool_1.default.getMempoolInfo();
        const vBytesPerSecond = mempool_1.default.getVBytesPerSecond();
        const rbfTransactions = common_1.Common.findRbfTransactions(newTransactions, recentlyDeletedTransactions.flat());
        const da = difficulty_adjustment_1.default.getDifficultyAdjustment();
        const accelerations = acceleration_1.default.getAccelerations();
        mempool_1.default.handleRbfTransactions(rbfTransactions);
        const rbfChanges = rbf_cache_1.default.getRbfChanges();
        let rbfReplacements;
        let fullRbfReplacements;
        let rbfSummary;
        if (Object.keys(rbfChanges.trees).length || !this.lastRbfSummary) {
            rbfReplacements = rbf_cache_1.default.getRbfTrees(false);
            fullRbfReplacements = rbf_cache_1.default.getRbfTrees(true);
            rbfSummary = rbf_cache_1.default.getLatestRbfSummary() || [];
            this.lastRbfSummary = rbfSummary;
        }
        for (const deletedTx of deletedTransactions) {
            rbf_cache_1.default.evict(deletedTx.txid);
        }
        mempool_1.default.removeFromSpendMap(deletedTransactions);
        mempool_1.default.addToSpendMap(newTransactions);
        const recommendedFees = fee_api_1.default.getPreciseRecommendedFee();
        const latestTransactions = mempool_1.default.getLatestTransactions();
        if (mempool_1.default.isInSync()) {
            this.mempoolSequence++;
        }
        const replacedTransactions = [];
        for (const tx of newTransactions) {
            if (rbfTransactions[tx.txid]) {
                for (const replaced of rbfTransactions[tx.txid].replaced) {
                    replacedTransactions.push({ replaced: replaced.txid, by: tx });
                }
            }
        }
        const mempoolDeltaTxids = {
            sequence: this.mempoolSequence,
            added: newTransactions.map(tx => tx.txid),
            removed: deletedTransactions.map(tx => tx.txid),
            mined: [],
            replaced: replacedTransactions.map(replacement => ({ replaced: replacement.replaced, by: replacement.by.txid })),
        };
        const mempoolDelta = {
            sequence: this.mempoolSequence,
            added: newTransactions,
            removed: deletedTransactions.map(tx => tx.txid),
            mined: [],
            replaced: replacedTransactions,
        };
        // update init data
        const socketDataFields = {
            'mempoolInfo': mempoolInfo,
            'vBytesPerSecond': vBytesPerSecond,
            'mempool-blocks': mBlocks,
            'transactions': latestTransactions,
            'loadingIndicators': loading_indicators_1.default.getLoadingIndicators(),
            'da': da?.previousTime ? da : undefined,
            'fees': recommendedFees,
        };
        if (rbfSummary) {
            socketDataFields['rbfSummary'] = rbfSummary;
        }
        this.updateSocketDataFields(socketDataFields);
        // cache serialized objects to avoid stringify-ing the same thing for every client
        const responseCache = { ...this.socketData };
        function getCachedResponse(key, data) {
            if (!responseCache[key]) {
                responseCache[key] = JSON.stringify(data);
            }
            return responseCache[key];
        }
        // pre-compute new tracked outspends
        const outspendCache = {};
        const trackedTxs = new Set();
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client['track-tx']) {
                    trackedTxs.add(client['track-tx']);
                }
                if (client['track-txs']) {
                    for (const txid of client['track-txs']) {
                        trackedTxs.add(txid);
                    }
                }
            });
        }
        if (trackedTxs.size > 0) {
            for (const tx of newTransactions) {
                for (let i = 0; i < tx.vin.length; i++) {
                    const vin = tx.vin[i];
                    if (trackedTxs.has(vin.txid)) {
                        if (!outspendCache[vin.txid]) {
                            outspendCache[vin.txid] = { [vin.vout]: { vin: i, txid: tx.txid } };
                        }
                        else {
                            outspendCache[vin.txid][vin.vout] = { vin: i, txid: tx.txid };
                        }
                    }
                }
            }
        }
        // pre-compute address transactions
        const addressCache = this.makeAddressCache(newTransactions);
        const removedAddressCache = this.makeAddressCache(deletedTransactions);
        const websocketAccelerationDelta = acceleration_1.default.getAccelerationDelta(this.accelerations, accelerations);
        this.accelerations = accelerations;
        // pre-compute acceleration delta
        const accelerationUpdate = {
            added: websocketAccelerationDelta.map(txid => accelerations[txid]).filter(acc => acc != null),
            removed: websocketAccelerationDelta.filter(txid => !accelerations[txid]),
        };
        const cpfpUpdatesSent = new Set();
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach(async (client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                const response = {};
                if (client['want-stats']) {
                    response['mempoolInfo'] = getCachedResponse('mempoolInfo', mempoolInfo);
                    response['vBytesPerSecond'] = getCachedResponse('vBytesPerSecond', vBytesPerSecond);
                    response['transactions'] = getCachedResponse('transactions', latestTransactions);
                    if (da?.previousTime) {
                        response['da'] = getCachedResponse('da', da);
                    }
                    response['fees'] = getCachedResponse('fees', recommendedFees);
                }
                if (client['want-mempool-blocks']) {
                    response['mempool-blocks'] = getCachedResponse('mempool-blocks', mBlocks);
                }
                if (client['want-tomahawk']) {
                    response['tomahawk'] = getCachedResponse('tomahawk', bitcoin_api_factory_1.default.getHealthStatus());
                }
                if (client['track-mempool-tx']) {
                    const tx = newTransactions.find((t) => t.txid === client['track-mempool-tx']);
                    if (tx) {
                        if (config_1.default.MEMPOOL.BACKEND !== 'esplora') {
                            try {
                                const fullTx = await transaction_utils_1.default.$getMempoolTransactionExtended(tx.txid, true);
                                response['tx'] = JSON.stringify(fullTx);
                            }
                            catch (e) {
                                logger_1.default.debug('Error finding transaction in mempool: ' + (e instanceof Error ? e.message : e));
                            }
                        }
                        else {
                            response['tx'] = JSON.stringify(tx);
                        }
                        client['track-mempool-tx'] = null;
                    }
                }
                if (client['track-address']) {
                    const newTransactions = Array.from(addressCache[client['track-address']]?.values() || []);
                    const removedTransactions = Array.from(removedAddressCache[client['track-address']]?.values() || []);
                    // txs may be missing prevouts in non-esplora backends
                    // so fetch the full transactions now
                    const fullTransactions = (config_1.default.MEMPOOL.BACKEND !== 'esplora') ? await this.getFullTransactions(newTransactions) : newTransactions;
                    if (removedTransactions.length) {
                        response['address-removed-transactions'] = JSON.stringify(removedTransactions);
                    }
                    if (fullTransactions.length) {
                        response['address-transactions'] = JSON.stringify(fullTransactions);
                    }
                }
                if (client['track-addresses']) {
                    const addressMap = {};
                    for (const [address, key] of Object.entries(client['track-addresses'] || {})) {
                        const newTransactions = Array.from(addressCache[key]?.values() || []);
                        const removedTransactions = Array.from(removedAddressCache[key]?.values() || []);
                        // txs may be missing prevouts in non-esplora backends
                        // so fetch the full transactions now
                        const fullTransactions = (config_1.default.MEMPOOL.BACKEND !== 'esplora') ? await this.getFullTransactions(newTransactions) : newTransactions;
                        if (fullTransactions?.length) {
                            addressMap[address] = {
                                mempool: fullTransactions,
                                confirmed: [],
                                removed: removedTransactions,
                            };
                        }
                    }
                    if (Object.keys(addressMap).length > 0) {
                        client['track-addresses-updates'] =
                            (client['track-addresses-updates'] || 0) + this.countAddressTransactions(addressMap);
                        response['multi-address-transactions'] = JSON.stringify(addressMap);
                    }
                }
                if (client['track-scriptpubkeys']) {
                    const spkMap = {};
                    for (const spk of client['track-scriptpubkeys'] || []) {
                        const newTransactions = Array.from(addressCache[spk]?.values() || []);
                        const removedTransactions = Array.from(removedAddressCache[spk]?.values() || []);
                        // txs may be missing prevouts in non-esplora backends
                        // so fetch the full transactions now
                        const fullTransactions = (config_1.default.MEMPOOL.BACKEND !== 'esplora') ? await this.getFullTransactions(newTransactions) : newTransactions;
                        if (fullTransactions?.length) {
                            spkMap[spk] = {
                                mempool: fullTransactions,
                                confirmed: [],
                                removed: removedTransactions,
                            };
                        }
                    }
                    if (Object.keys(spkMap).length > 0) {
                        response['multi-scriptpubkey-transactions'] = JSON.stringify(spkMap);
                    }
                }
                if (client['track-asset']) {
                    const foundTransactions = [];
                    newTransactions.forEach((tx) => {
                        if (client['track-asset'] === common_1.Common.nativeAssetId) {
                            if (tx.vin.some((vin) => !!vin.is_pegin)) {
                                foundTransactions.push(tx);
                                return;
                            }
                            if (tx.vout.some((vout) => !!vout.pegout)) {
                                foundTransactions.push(tx);
                            }
                        }
                        else {
                            if (tx.vin.some((vin) => !!vin.issuance && vin.issuance.asset_id === client['track-asset'])) {
                                foundTransactions.push(tx);
                                return;
                            }
                            if (tx.vout.some((vout) => !!vout.asset && vout.asset === client['track-asset'])) {
                                foundTransactions.push(tx);
                            }
                        }
                    });
                    if (foundTransactions.length) {
                        response['address-transactions'] = JSON.stringify(foundTransactions);
                    }
                }
                if (client['track-tx']) {
                    const trackTxid = client['track-tx'];
                    const outspends = outspendCache[trackTxid];
                    if (outspends && Object.keys(outspends).length) {
                        response['utxoSpent'] = JSON.stringify(outspends);
                    }
                    const rbfReplacedBy = rbfChanges.map[client['track-tx']] ? rbf_cache_1.default.getReplacedBy(client['track-tx']) : false;
                    if (rbfReplacedBy) {
                        response['rbfTransaction'] = JSON.stringify({
                            txid: rbfReplacedBy,
                        });
                    }
                    const rbfChange = rbfChanges.map[client['track-tx']];
                    if (rbfChange) {
                        response['rbfInfo'] = JSON.stringify(rbfChanges.trees[rbfChange]);
                    }
                    const mempoolTx = newMempool[trackTxid];
                    if (mempoolTx && mempoolTx.position) {
                        const positionData = {
                            txid: trackTxid,
                            position: {
                                ...mempoolTx.position,
                                accelerated: mempoolTx.acceleration || undefined,
                                acceleratedBy: mempoolTx.acceleratedBy || undefined,
                                acceleratedAt: mempoolTx.acceleratedAt || undefined,
                                feeDelta: mempoolTx.feeDelta || undefined,
                            },
                            accelerationPositions: mempool_1.default.getAccelerationPositions(mempoolTx.txid),
                        };
                        if (!mempoolTx.cpfpChecked && !mempoolTx.acceleration) {
                            (0, cpfp_1.calculateMempoolTxCpfp)(mempoolTx, newMempool);
                        }
                        if (mempoolTx.cpfpDirty) {
                            const cpfp = {
                                ancestors: mempoolTx.ancestors || [],
                                bestDescendant: mempoolTx.bestDescendant || null,
                                descendants: mempoolTx.descendants,
                                effectiveFeePerVsize: mempoolTx.effectiveFeePerVsize,
                                sigops: mempoolTx.sigops,
                                adjustedVsize: mempoolTx.adjustedVsize,
                                acceleration: mempoolTx.acceleration,
                            };
                            if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL && mempoolTx.clusterId != null) {
                                const cluster = mempool_2.default.clusterMempool?.getClusterForApi(mempoolTx.txid);
                                if (cluster) {
                                    cpfp.cluster = cluster;
                                }
                            }
                            positionData['cpfp'] = cpfp;
                            cpfpUpdatesSent.add(trackTxid);
                        }
                        response['txPosition'] = JSON.stringify(positionData);
                    }
                }
                if (client['track-txs']) {
                    const txids = client['track-txs'];
                    const txs = {};
                    for (const txid of txids) {
                        const txInfo = {};
                        let txHasInfo = false;
                        const outspends = outspendCache[txid];
                        if (outspends && Object.keys(outspends).length) {
                            txInfo.utxoSpent = outspends;
                            txHasInfo = true;
                        }
                        const replacedBy = rbfChanges.map[txid] ? rbf_cache_1.default.getReplacedBy(txid) : false;
                        if (replacedBy) {
                            txInfo.replacedBy = replacedBy;
                            txHasInfo = true;
                        }
                        const mempoolTx = newMempool[txid];
                        if (mempoolTx && mempoolTx.position) {
                            txInfo.position = {
                                ...mempoolTx.position,
                                accelerated: mempoolTx.acceleration || undefined,
                                acceleratedBy: mempoolTx.acceleratedBy || undefined,
                                acceleratedAt: mempoolTx.acceleratedAt || undefined,
                                feeDelta: mempoolTx.feeDelta || undefined,
                            };
                            if (!mempoolTx.cpfpChecked) {
                                (0, cpfp_1.calculateMempoolTxCpfp)(mempoolTx, newMempool);
                            }
                            if (mempoolTx.cpfpDirty) {
                                txInfo.cpfp = {
                                    ancestors: mempoolTx.ancestors,
                                    bestDescendant: mempoolTx.bestDescendant || null,
                                    descendants: mempoolTx.descendants,
                                    effectiveFeePerVsize: mempoolTx.effectiveFeePerVsize,
                                    sigops: mempoolTx.sigops,
                                    adjustedVsize: mempoolTx.adjustedVsize,
                                };
                                if (config_1.default.MEMPOOL.CLUSTER_MEMPOOL && mempoolTx.clusterId != null) {
                                    const cluster = mempool_2.default.clusterMempool?.getClusterForApi(mempoolTx.txid);
                                    if (cluster) {
                                        txInfo.cpfp.cluster = cluster;
                                    }
                                }
                                cpfpUpdatesSent.add(txid);
                            }
                            txHasInfo = true;
                        }
                        if (txHasInfo) {
                            txs[txid] = txInfo;
                        }
                    }
                    if (Object.keys(txs).length) {
                        client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
                        response['tracked-txs'] = JSON.stringify(txs);
                    }
                }
                if (client['track-mempool-block'] >= 0 && mempool_1.default.isInSync()) {
                    const index = client['track-mempool-block'];
                    if (mBlockDeltas[index]) {
                        response['projected-block-transactions'] = getCachedResponse(`projected-block-transactions-${index}`, {
                            index: index,
                            sequence: this.mempoolSequence,
                            delta: mBlockDeltas[index],
                        });
                    }
                }
                if (client['track-rbf'] === 'all' && rbfReplacements) {
                    response['rbfLatest'] = getCachedResponse('rbfLatest', rbfReplacements);
                }
                else if (client['track-rbf'] === 'fullRbf' && fullRbfReplacements) {
                    response['rbfLatest'] = getCachedResponse('fullrbfLatest', fullRbfReplacements);
                }
                if (client['track-rbf-summary'] && rbfSummary) {
                    response['rbfLatestSummary'] = getCachedResponse('rbfLatestSummary', rbfSummary);
                }
                if (client['track-mempool-txids']) {
                    response['mempool-txids'] = getCachedResponse('mempool-txids', mempoolDeltaTxids);
                }
                if (client['track-mempool']) {
                    response['mempool-transactions'] = getCachedResponse('mempool-transactions', mempoolDelta);
                }
                if (client['track-accelerations'] && (accelerationUpdate.added.length || accelerationUpdate.removed.length)) {
                    response['accelerations'] = getCachedResponse('accelerations', accelerationUpdate);
                }
                if (Object.keys(response).length) {
                    this.send(client, this.serializeResponse(response));
                }
            });
        }
        for (const txid of cpfpUpdatesSent) {
            if (newMempool[txid]) {
                newMempool[txid].cpfpDirty = false;
            }
        }
    }
    /** @asyncSafe */
    async handleNewBlock(block, txIds, transactions, rbfTransactions) {
        if (!this.webSocketServers.length) {
            throw new Error('No WebSocket.Server have been set');
        }
        this.printLogs();
        const _memPool = mempool_1.default.getMempool();
        const confirmedTxids = {};
        for (const txId of txIds) {
            confirmedTxids[txId] = true;
        }
        const mBlocks = mempool_blocks_1.default.getMempoolBlocks();
        const mBlockDeltas = mempool_blocks_1.default.getMempoolBlockDeltas();
        const da = difficulty_adjustment_1.default.getDifficultyAdjustment();
        const fees = fee_api_1.default.getPreciseRecommendedFee();
        const mempoolInfo = mempool_1.default.getMempoolInfo();
        // pre-compute address transactions
        const addressCache = this.makeAddressCache(transactions);
        // update init data
        this.updateSocketDataFields({
            'mempoolInfo': mempoolInfo,
            'blocks': (0, OrdpoolBlocksRepository_helper_1.mapCat21MintsToMinimal)([...blocks_1.default.getBlocks(), block].slice(-config_1.default.MEMPOOL.INITIAL_BLOCKS_AMOUNT)),
            'mempool-blocks': mBlocks,
            'loadingIndicators': loading_indicators_1.default.getLoadingIndicators(),
            'da': da?.previousTime ? da : undefined,
            'fees': fees,
        });
        const mBlocksWithTransactions = mempool_blocks_1.default.getMempoolBlocksWithTransactions();
        if (mempool_1.default.isInSync()) {
            this.mempoolSequence++;
        }
        const replacedTransactions = [];
        for (const txid of Object.keys(rbfTransactions)) {
            for (const replaced of rbfTransactions[txid].replaced) {
                replacedTransactions.push({ replaced: replaced.txid, by: rbfTransactions[txid].replacedBy });
            }
        }
        const mempoolDeltaTxids = {
            sequence: this.mempoolSequence,
            added: [],
            removed: [],
            mined: transactions.map(tx => tx.txid),
            replaced: replacedTransactions.map(replacement => ({ replaced: replacement.replaced, by: replacement.by.txid })),
        };
        const mempoolDelta = {
            sequence: this.mempoolSequence,
            added: [],
            removed: [],
            mined: transactions.map(tx => tx.txid),
            replaced: replacedTransactions,
        };
        // check for wallet transactions
        const walletTransactions = config_1.default.WALLETS.ENABLED ? wallets_1.default.processBlock(block, transactions) : [];
        const responseCache = { ...this.socketData };
        function getCachedResponse(key, data) {
            if (!responseCache[key]) {
                responseCache[key] = JSON.stringify(data);
            }
            return responseCache[key];
        }
        // TODO - Fix indentation after PR is merged
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                const response = {};
                if (client['want-blocks']) {
                    response['block'] = getCachedResponse('block', block);
                }
                if (client['want-stats']) {
                    response['mempoolInfo'] = getCachedResponse('mempoolInfo', mempoolInfo);
                    response['vBytesPerSecond'] = getCachedResponse('vBytesPerSecond', mempool_1.default.getVBytesPerSecond());
                    response['fees'] = getCachedResponse('fees', fees);
                    if (da?.previousTime) {
                        response['da'] = getCachedResponse('da', da);
                    }
                }
                if (mBlocks && client['want-mempool-blocks']) {
                    response['mempool-blocks'] = getCachedResponse('mempool-blocks', mBlocks);
                }
                if (client['want-tomahawk']) {
                    response['tomahawk'] = getCachedResponse('tomahawk', bitcoin_api_factory_1.default.getHealthStatus());
                }
                if (client['track-tx']) {
                    const trackTxid = client['track-tx'];
                    if (trackTxid && confirmedTxids[trackTxid]) {
                        response['txConfirmed'] = JSON.stringify(trackTxid);
                    }
                    else {
                        const mempoolTx = _memPool[trackTxid];
                        if (mempoolTx && mempoolTx.position) {
                            response['txPosition'] = JSON.stringify({
                                txid: trackTxid,
                                position: {
                                    ...mempoolTx.position,
                                    accelerated: mempoolTx.acceleration || undefined,
                                    acceleratedBy: mempoolTx.acceleratedBy || undefined,
                                    acceleratedAt: mempoolTx.acceleratedAt || undefined,
                                    feeDelta: mempoolTx.feeDelta || undefined,
                                },
                                accelerationPositions: mempool_1.default.getAccelerationPositions(mempoolTx.txid),
                            });
                        }
                    }
                }
                if (client['track-txs']) {
                    const txs = {};
                    for (const txid of client['track-txs']) {
                        if (confirmedTxids[txid]) {
                            txs[txid] = { confirmed: true };
                        }
                        else {
                            const mempoolTx = _memPool[txid];
                            if (mempoolTx && mempoolTx.position) {
                                txs[txid] = {
                                    position: {
                                        ...mempoolTx.position,
                                    },
                                    accelerated: mempoolTx.acceleration || undefined,
                                    acceleratedBy: mempoolTx.acceleratedBy || undefined,
                                    acceleratedAt: mempoolTx.acceleratedAt || undefined,
                                    feeDelta: mempoolTx.feeDelta || undefined,
                                };
                            }
                        }
                    }
                    if (Object.keys(txs).length) {
                        client['track-txs-updates'] = (client['track-txs-updates'] || 0) + Object.keys(txs).length;
                        response['tracked-txs'] = JSON.stringify(txs);
                    }
                }
                if (client['track-address']) {
                    const foundTransactions = Array.from(addressCache[client['track-address']]?.values() || []);
                    if (foundTransactions.length) {
                        foundTransactions.forEach((tx) => {
                            tx.status = {
                                confirmed: true,
                                block_height: block.height,
                                block_hash: block.id,
                                block_time: block.timestamp,
                            };
                        });
                        response['block-transactions'] = JSON.stringify(foundTransactions);
                    }
                }
                if (client['track-addresses']) {
                    const addressMap = {};
                    for (const [address, key] of Object.entries(client['track-addresses'] || {})) {
                        const fullTransactions = Array.from(addressCache[key]?.values() || []);
                        if (fullTransactions?.length) {
                            addressMap[address] = {
                                mempool: [],
                                confirmed: fullTransactions,
                                removed: [],
                            };
                        }
                    }
                    if (Object.keys(addressMap).length > 0) {
                        client['track-addresses-updates'] =
                            (client['track-addresses-updates'] || 0) + this.countAddressTransactions(addressMap);
                        response['multi-address-transactions'] = JSON.stringify(addressMap);
                    }
                }
                if (client['track-scriptpubkeys']) {
                    const spkMap = {};
                    for (const spk of client['track-scriptpubkeys'] || []) {
                        const fullTransactions = Array.from(addressCache[spk]?.values() || []);
                        if (fullTransactions?.length) {
                            spkMap[spk] = {
                                mempool: [],
                                confirmed: fullTransactions,
                                removed: [],
                            };
                        }
                    }
                    if (Object.keys(spkMap).length > 0) {
                        response['multi-scriptpubkey-transactions'] = JSON.stringify(spkMap);
                    }
                }
                if (client['track-asset']) {
                    const foundTransactions = [];
                    transactions.forEach((tx) => {
                        if (client['track-asset'] === common_1.Common.nativeAssetId) {
                            if (tx.vin && tx.vin.some((vin) => !!vin.is_pegin)) {
                                foundTransactions.push(tx);
                                return;
                            }
                            if (tx.vout && tx.vout.some((vout) => !!vout.pegout)) {
                                foundTransactions.push(tx);
                            }
                        }
                        else {
                            if (tx.vin && tx.vin.some((vin) => !!vin.issuance && vin.issuance.asset_id === client['track-asset'])) {
                                foundTransactions.push(tx);
                                return;
                            }
                            if (tx.vout && tx.vout.some((vout) => !!vout.asset && vout.asset === client['track-asset'])) {
                                foundTransactions.push(tx);
                            }
                        }
                    });
                    if (foundTransactions.length) {
                        foundTransactions.forEach((tx) => {
                            tx.status = {
                                confirmed: true,
                                block_height: block.height,
                                block_hash: block.id,
                                block_time: block.timestamp,
                            };
                        });
                        response['block-transactions'] = JSON.stringify(foundTransactions);
                    }
                }
                if (client['track-mempool-block'] >= 0 && mempool_1.default.isInSync()) {
                    const index = client['track-mempool-block'];
                    if (mBlockDeltas && mBlockDeltas[index] && mBlocksWithTransactions[index]?.transactions?.length) {
                        if (mBlockDeltas[index].added.length > (mBlocksWithTransactions[index]?.transactions.length / 2)) {
                            response['projected-block-transactions'] = getCachedResponse(`projected-block-transactions-full-${index}`, {
                                index: index,
                                sequence: this.mempoolSequence,
                                blockTransactions: mBlocksWithTransactions[index].transactions.map(mempool_blocks_1.default.compressTx),
                            });
                        }
                        else {
                            response['projected-block-transactions'] = getCachedResponse(`projected-block-transactions-delta-${index}`, {
                                index: index,
                                sequence: this.mempoolSequence,
                                delta: mBlockDeltas[index],
                            });
                        }
                    }
                }
                if (client['track-mempool-txids']) {
                    response['mempool-txids'] = getCachedResponse('mempool-txids', mempoolDeltaTxids);
                }
                if (client['track-mempool']) {
                    response['mempool-transactions'] = getCachedResponse('mempool-transactions', mempoolDelta);
                }
                if (client['track-wallet']) {
                    const trackedWallet = client['track-wallet'];
                    response['wallet-transactions'] = getCachedResponse(`wallet-transactions-${trackedWallet}`, walletTransactions[trackedWallet] ?? {});
                }
                if (Object.keys(response).length) {
                    this.send(client, this.serializeResponse(response));
                }
            });
        }
    }
    handleNewStratumJob(job) {
        this.updateSocketDataFields({ 'stratumJobs': stratum_1.default.getJobs() });
        for (const server of this.webSocketServers) {
            server.clients.forEach((client) => {
                if (client.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (client['track-stratum'] && (client['track-stratum'] === 'all' || client['track-stratum'] === job.pool)) {
                    this.send(client, JSON.stringify({
                        'stratumJob': job
                    }));
                }
            });
        }
    }
    send(client, data) {
        if (client.bufferedAmount > this.MAX_BUFFERED_AMOUNT) {
            client.terminate();
            return;
        }
        client.send(data);
    }
    // takes a dictionary of JSON serialized values
    // and zips it together into a valid JSON object
    serializeResponse(response) {
        return '{'
            + Object.keys(response).filter(key => response[key] != null).map(key => `"${key}": ${response[key]}`).join(', ')
            + '}';
    }
    // checks if an address conforms to a valid format
    // returns the canonical form:
    //  - lowercase for bech32(m)
    //  - lowercase scriptpubkey for P2PK
    // or false if invalid
    testAddress(address) {
        if (/^([a-km-zA-HJ-NP-Z1-9]{26,35}|[a-km-zA-HJ-NP-Z1-9]{80}|[a-z]{2,5}1[ac-hj-np-z02-9]{8,100}|[A-Z]{2,5}1[AC-HJ-NP-Z02-9]{8,100}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64})$/.test(address)) {
            if (/^[A-Z]{2,5}1[AC-HJ-NP-Z02-9]{8,100}|04[a-fA-F0-9]{128}|(02|03)[a-fA-F0-9]{64}$/.test(address)) {
                address = address.toLowerCase();
            }
            if (/^04[a-fA-F0-9]{128}$/.test(address)) {
                return '41' + address + 'ac';
            }
            else if (/^(02|03)[a-fA-F0-9]{64}$/.test(address)) {
                return '21' + address + 'ac';
            }
            else {
                return address;
            }
        }
        else {
            return false;
        }
    }
    makeAddressCache(transactions) {
        const addressCache = {};
        for (const tx of transactions) {
            for (const vin of tx.vin) {
                if (vin?.prevout?.scriptpubkey_address) {
                    if (!addressCache[vin.prevout.scriptpubkey_address]) {
                        addressCache[vin.prevout.scriptpubkey_address] = new Set();
                    }
                    addressCache[vin.prevout.scriptpubkey_address].add(tx);
                }
                if (vin?.prevout?.scriptpubkey) {
                    if (!addressCache[vin.prevout.scriptpubkey]) {
                        addressCache[vin.prevout.scriptpubkey] = new Set();
                    }
                    addressCache[vin.prevout.scriptpubkey].add(tx);
                }
            }
            for (const vout of tx.vout) {
                if (vout?.scriptpubkey_address) {
                    if (!addressCache[vout?.scriptpubkey_address]) {
                        addressCache[vout?.scriptpubkey_address] = new Set();
                    }
                    addressCache[vout?.scriptpubkey_address].add(tx);
                }
                if (vout?.scriptpubkey) {
                    if (!addressCache[vout.scriptpubkey]) {
                        addressCache[vout.scriptpubkey] = new Set();
                    }
                    addressCache[vout.scriptpubkey].add(tx);
                }
            }
        }
        return addressCache;
    }
    /** @asyncSafe */
    async getFullTransactions(transactions) {
        for (let i = 0; i < transactions.length; i++) {
            try {
                transactions[i] = await transaction_utils_1.default.$getMempoolTransactionExtended(transactions[i].txid, true);
            }
            catch (e) {
                logger_1.default.debug('Error finding transaction in mempool: ' + (e instanceof Error ? e.message : e));
            }
        }
        return transactions;
    }
    printLogs() {
        if (this.webSocketServers.length) {
            let numTxSubs = 0;
            let numTxsSubs = 0;
            let numAddressSubs = 0;
            let numAddressesSubs = 0;
            let numProjectedSubs = 0;
            let numRbfSubs = 0;
            let trackedTxsTotal = 0;
            let trackedAddressesTotal = 0;
            let trackedTxsMax = 0;
            let trackedAddressesMax = 0;
            let trackTxsTrackedTotal = 0;
            let trackTxsTrackedMax = 0;
            let trackAddressesTrackedTotal = 0;
            let trackAddressesTrackedMax = 0;
            let trackTxsUpdatesTotal = 0;
            let trackTxsUpdatesMax = 0;
            let trackAddressesUpdatesTotal = 0;
            let trackAddressesUpdatesMax = 0;
            for (const server of this.webSocketServers) {
                server.clients.forEach((client) => {
                    let trackedTxCount = 0;
                    let trackedAddressCount = 0;
                    if (client['track-tx']) {
                        numTxSubs++;
                        trackedTxCount += 1;
                    }
                    if (client['track-txs']) {
                        numTxsSubs++;
                        trackedTxCount += client['track-txs'].length;
                    }
                    if (client['track-address']) {
                        numAddressSubs++;
                        trackedAddressCount += 1;
                    }
                    if (client['track-addresses']) {
                        numAddressesSubs++;
                        const addressCount = Object.keys(client['track-addresses']).length;
                        trackedAddressCount += addressCount;
                        trackAddressesTrackedTotal += addressCount;
                        trackAddressesTrackedMax = Math.max(trackAddressesTrackedMax, addressCount);
                        const updates = client['track-addresses-updates'] || 0;
                        trackAddressesUpdatesTotal += updates;
                        trackAddressesUpdatesMax = Math.max(trackAddressesUpdatesMax, updates);
                        client['track-addresses-updates'] = 0;
                    }
                    if (client['track-mempool-block'] != null && client['track-mempool-block'] >= 0) {
                        numProjectedSubs++;
                    }
                    if (client['track-rbf']) {
                        numRbfSubs++;
                    }
                    if (client['track-txs']) {
                        const txCount = client['track-txs'].length;
                        trackTxsTrackedTotal += txCount;
                        trackTxsTrackedMax = Math.max(trackTxsTrackedMax, txCount);
                        const updates = client['track-txs-updates'] || 0;
                        trackTxsUpdatesTotal += updates;
                        trackTxsUpdatesMax = Math.max(trackTxsUpdatesMax, updates);
                        client['track-txs-updates'] = 0;
                    }
                    trackedTxsTotal += trackedTxCount;
                    trackedAddressesTotal += trackedAddressCount;
                    trackedTxsMax = Math.max(trackedTxsMax, trackedTxCount);
                    trackedAddressesMax = Math.max(trackedAddressesMax, trackedAddressCount);
                });
            }
            let count = 0;
            for (const server of this.webSocketServers) {
                count += server.clients?.size || 0;
            }
            const diff = count - this.numClients;
            this.numClients = count;
            const trackedTxsAvg = count > 0 ? trackedTxsTotal / count : 0;
            const trackedAddressesAvg = count > 0 ? trackedAddressesTotal / count : 0;
            const trackTxsTrackedAvg = numTxsSubs > 0 ? trackTxsTrackedTotal / numTxsSubs : 0;
            const trackAddressesTrackedAvg = numAddressesSubs > 0 ? trackAddressesTrackedTotal / numAddressesSubs : 0;
            const trackTxsUpdatesAvg = numTxsSubs > 0 ? trackTxsUpdatesTotal / numTxsSubs : 0;
            const trackAddressesUpdatesAvg = numAddressesSubs > 0 ? trackAddressesUpdatesTotal / numAddressesSubs : 0;
            logger_1.default.debug(`${count} websocket clients | ${this.numConnected} connected | ${this.numDisconnected} disconnected | (${diff >= 0 ? '+' : ''}${diff}) | tracked txs: total=${trackedTxsTotal}, avg=${trackedTxsAvg.toFixed(2)}, max=${trackedTxsMax} | tracked addresses: total=${trackedAddressesTotal}, avg=${trackedAddressesAvg.toFixed(2)}, max=${trackedAddressesMax} | ws-subscriptions: tx=${numTxSubs},txs=${numTxsSubs},address=${numAddressSubs},addresses=${numAddressesSubs},txs-tracked-avg=${trackTxsTrackedAvg.toFixed(2)},txs-tracked-max=${trackTxsTrackedMax},addresses-tracked-avg=${trackAddressesTrackedAvg.toFixed(2)},addresses-tracked-max=${trackAddressesTrackedMax},txs-updates-avg=${trackTxsUpdatesAvg.toFixed(2)},txs-updates-max=${trackTxsUpdatesMax},addresses-updates-avg=${trackAddressesUpdatesAvg.toFixed(2)},addresses-updates-max=${trackAddressesUpdatesMax}`);
            logger_1.default.debug(`websocket subscriptions: track-tx: ${numTxSubs}, track-txs: ${numTxsSubs}, track-address: ${numAddressSubs}, track-addresses: ${numAddressesSubs}, track-mempool-block: ${numProjectedSubs} track-rbf: ${numRbfSubs}`);
            this.numConnected = 0;
            this.numDisconnected = 0;
        }
    }
    countAddressTransactions(addressMap) {
        return Object.values(addressMap).reduce((total, transactions) => total
            + transactions.mempool.length
            + transactions.confirmed.length
            + transactions.removed.length, 0);
    }
}
exports.default = new WebsocketHandler();
