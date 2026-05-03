// Imported from https://github.com/shesek/lightning-client-js
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const methods = [
    'addgossip',
    'autocleaninvoice',
    'check',
    'checkmessage',
    'close',
    'connect',
    'createinvoice',
    'createinvoicerequest',
    'createoffer',
    'createonion',
    'decode',
    'decodepay',
    'delexpiredinvoice',
    'delinvoice',
    'delpay',
    'dev-listaddrs',
    'dev-rescan-outputs',
    'disableoffer',
    'disconnect',
    'estimatefees',
    'feerates',
    'fetchinvoice',
    'fundchannel',
    'fundchannel_cancel',
    'fundchannel_complete',
    'fundchannel_start',
    'fundpsbt',
    'getchaininfo',
    'getinfo',
    'getlog',
    'getrawblockbyheight',
    'getroute',
    'getsharedsecret',
    'getutxout',
    'help',
    'invoice',
    'keysend',
    'legacypay',
    'listchannels',
    'listconfigs',
    'listforwards',
    'listfunds',
    'listinvoices',
    'listnodes',
    'listoffers',
    'listpays',
    'listpeers',
    'listsendpays',
    'listtransactions',
    'multifundchannel',
    'multiwithdraw',
    'newaddr',
    'notifications',
    'offer',
    'offerout',
    'openchannel_abort',
    'openchannel_bump',
    'openchannel_init',
    'openchannel_signed',
    'openchannel_update',
    'pay',
    'payersign',
    'paystatus',
    'ping',
    'plugin',
    'reserveinputs',
    'sendinvoice',
    'sendonion',
    'sendonionmessage',
    'sendpay',
    'sendpsbt',
    'sendrawtransaction',
    'setchannelfee',
    'signmessage',
    'signpsbt',
    'stop',
    'txdiscard',
    'txprepare',
    'txsend',
    'unreserveinputs',
    'utxopsbt',
    'waitanyinvoice',
    'waitblockheight',
    'waitinvoice',
    'waitsendpay',
    'withdraw'
];
const events_1 = __importDefault(require("events"));
const fs_1 = require("fs");
const net_1 = require("net");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const readline_1 = require("readline");
const logger_1 = __importDefault(require("../../../logger"));
const clightning_convert_1 = require("./clightning-convert");
class LightningError extends Error {
    type = 'lightning';
    message = 'lightning-client error';
    constructor(error) {
        super();
        this.type = error.type;
        this.message = error.message;
    }
}
const defaultRpcPath = path_1.default.join((0, os_1.homedir)(), '.lightning'), fStat = (...p) => (0, fs_1.statSync)(path_1.default.join(...p)), fExists = (...p) => (0, fs_1.existsSync)(path_1.default.join(...p));
class CLightningClient extends events_1.default {
    rpcPath;
    reconnectWait;
    reconnectTimeout;
    reqcount;
    client;
    rl;
    clientConnectionPromise;
    constructor(rpcPath = defaultRpcPath) {
        if (!path_1.default.isAbsolute(rpcPath)) {
            throw new Error('The rpcPath must be an absolute path');
        }
        if (!fExists(rpcPath) || !fStat(rpcPath).isSocket()) {
            // network directory provided, use the lightning-rpc within in
            if (fExists(rpcPath, 'lightning-rpc')) {
                rpcPath = path_1.default.join(rpcPath, 'lightning-rpc');
            }
            // main data directory provided, default to using the bitcoin mainnet subdirectory
            // to be removed in v0.2.0
            else if (fExists(rpcPath, 'bitcoin', 'lightning-rpc')) {
                logger_1.default.warn(`${rpcPath}/lightning-rpc is missing, using the bitcoin mainnet subdirectory at ${rpcPath}/bitcoin instead.`, logger_1.default.tags.ln);
                logger_1.default.warn(`specifying the main lightning data directory is deprecated, please specify the network directory explicitly.\n`, logger_1.default.tags.ln);
                rpcPath = path_1.default.join(rpcPath, 'bitcoin', 'lightning-rpc');
            }
        }
        logger_1.default.debug(`Connecting to ${rpcPath}`, logger_1.default.tags.ln);
        super();
        this.rpcPath = rpcPath;
        this.reconnectWait = 0.5;
        this.reconnectTimeout = null;
        this.reqcount = 0;
        const _self = this;
        this.client = (0, net_1.createConnection)(rpcPath).on('error', () => {
            _self.increaseWaitTime();
            _self.reconnect();
        });
        this.rl = (0, readline_1.createInterface)({ input: this.client }).on('error', () => {
            _self.increaseWaitTime();
            _self.reconnect();
        });
        this.clientConnectionPromise = new Promise(resolve => {
            _self.client.on('connect', () => {
                logger_1.default.info(`CLightning client connected`, logger_1.default.tags.ln);
                _self.reconnectWait = 1;
                resolve();
            });
            _self.client.on('end', () => {
                logger_1.default.err(`CLightning client connection closed, reconnecting`, logger_1.default.tags.ln);
                _self.increaseWaitTime();
                _self.reconnect();
            });
            _self.client.on('error', error => {
                logger_1.default.err(`CLightning client connection error: ${error}`, logger_1.default.tags.ln);
                _self.increaseWaitTime();
                _self.reconnect();
            });
        });
        this.rl.on('line', line => {
            line = line.trim();
            if (!line) {
                return;
            }
            const data = JSON.parse(line);
            _self.emit('res:' + data.id, data);
        });
    }
    increaseWaitTime() {
        if (this.reconnectWait >= 16) {
            this.reconnectWait = 16;
        }
        else {
            this.reconnectWait *= 2;
        }
    }
    reconnect() {
        const _self = this;
        if (this.reconnectTimeout) {
            return;
        }
        this.reconnectTimeout = setTimeout(() => {
            logger_1.default.debug(`Trying to reconnect...`, logger_1.default.tags.ln);
            _self.client.connect(_self.rpcPath);
            _self.reconnectTimeout = null;
        }, this.reconnectWait * 1000);
    }
    call(method, args = []) {
        const _self = this;
        const callInt = ++this.reqcount;
        const sendObj = {
            jsonrpc: '2.0',
            method,
            params: args,
            id: '' + callInt
        };
        // Wait for the client to connect
        return this.clientConnectionPromise
            .then(() => new Promise((resolve, reject) => {
            // Wait for a response
            this.once('res:' + callInt, res => res.error == null
                ? resolve(res.result)
                : reject(new LightningError(res.error)));
            // Send the command
            _self.client.write(JSON.stringify(sendObj));
        }));
    }
    /** @asyncUnsafe */
    async $getNetworkGraph() {
        const listnodes = await this.call('listnodes');
        const listchannels = await this.call('listchannels');
        const channelsList = await (0, clightning_convert_1.convertAndmergeBidirectionalChannels)(listchannels['channels']);
        return {
            nodes: listnodes['nodes'].map(node => (0, clightning_convert_1.convertNode)(node)),
            edges: channelsList,
        };
    }
}
exports.default = CLightningClient;
const protify = s => s.replace(/-([a-z])/g, m => m[1].toUpperCase());
methods.forEach(k => {
    CLightningClient.prototype[protify(k)] = function (...args) {
        return this.call(k, args);
    };
});
