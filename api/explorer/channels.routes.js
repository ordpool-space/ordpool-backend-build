"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const channels_api_1 = __importDefault(require("./channels.api"));
const api_1 = require("../../utils/api");
const TXID_REGEX = /^[a-f0-9]{64}$/i;
class ChannelsRoutes {
    constructor() { }
    initRoutes(app) {
        app
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels/txids', this.$getChannelsByTransactionIds)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels/search/:search', this.$searchChannelsById)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels/:short_id', this.$getChannel)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels', this.$getChannelsForNode)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/penalties', this.$getPenaltyClosedChannels)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels-geo', this.$getAllChannelsGeo)
            .get(config_1.default.MEMPOOL.API_URL_PREFIX + 'lightning/channels-geo/:publicKey', this.$getAllChannelsGeo);
    }
    async $searchChannelsById(req, res) {
        try {
            const channels = await channels_api_1.default.$searchChannelsById(req.params.search);
            res.json(channels);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to search channels by id');
        }
    }
    async $getChannel(req, res) {
        try {
            const channel = await channels_api_1.default.$getChannel(req.params.short_id);
            if (!channel) {
                res.status(404).send('Channel not found');
                return;
            }
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(channel);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get channel');
        }
    }
    async $getChannelsForNode(req, res) {
        try {
            if (typeof req.query.public_key !== 'string') {
                res.status(400).send('Missing parameter: public_key');
                return;
            }
            const index = parseInt(typeof req.query.index === 'string' ? req.query.index : '0', 10) || 0;
            const status = typeof req.query.status === 'string' ? req.query.status : '';
            if (index < -1) {
                (0, api_1.handleError)(req, res, 400, 'Invalid index');
                return;
            }
            if (['open', 'active', 'closed'].includes(status) === false) {
                (0, api_1.handleError)(req, res, 400, 'Invalid status');
                return;
            }
            const channels = await channels_api_1.default.$getChannelsForNode(req.query.public_key, index, 10, status);
            const channelsCount = await channels_api_1.default.$getChannelsCountForNode(req.query.public_key, status);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.header('X-Total-Count', channelsCount.toString());
            res.json(channels);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get channels for node');
        }
    }
    async $getChannelsByTransactionIds(req, res) {
        try {
            if (!req.query.txId || typeof req.query.txId !== 'object') {
                (0, api_1.handleError)(req, res, 400, 'invalid txId format');
                return;
            }
            const txIds = [];
            for (const txid of Object.values(req.query.txId)) {
                if (typeof txid === 'string' && TXID_REGEX.test(txid)) {
                    txIds.push(txid);
                }
            }
            const channels = await channels_api_1.default.$getChannelsByTransactionId(txIds);
            const result = [];
            for (const txid of txIds) {
                const inputs = {};
                const outputs = {};
                // Assuming that we only have one lightning close input in each transaction. This may not be true in the future
                const foundChannelsFromInput = channels.find((channel) => channel.closing_transaction_id === txid);
                if (foundChannelsFromInput) {
                    inputs[0] = foundChannelsFromInput;
                }
                const foundChannelsFromOutputs = channels.filter((channel) => channel.transaction_id === txid);
                for (const output of foundChannelsFromOutputs) {
                    outputs[output.transaction_vout] = output;
                }
                result.push({
                    inputs,
                    outputs,
                });
            }
            res.json(result);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get channels by transaction ids');
        }
    }
    async $getPenaltyClosedChannels(req, res) {
        try {
            const channels = await channels_api_1.default.$getPenaltyClosedChannels();
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(channels);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get penalty closed channels');
        }
    }
    async $getAllChannelsGeo(req, res) {
        try {
            const style = typeof req.query.style === 'string' ? req.query.style : '';
            const channels = await channels_api_1.default.$getAllChannelsGeo(req.params?.publicKey, style);
            res.header('Pragma', 'public');
            res.header('Cache-control', 'public');
            res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
            res.json(channels);
        }
        catch (e) {
            (0, api_1.handleError)(req, res, 500, 'Failed to get channel geodata');
        }
    }
}
exports.default = new ChannelsRoutes();
