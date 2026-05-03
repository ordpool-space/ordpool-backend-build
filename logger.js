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
const config_1 = __importDefault(require("./config"));
const dgram = __importStar(require("dgram"));
class Logger {
    static priorities = {
        emerg: 0,
        alert: 1,
        crit: 2,
        err: 3,
        warn: 4,
        notice: 5,
        info: 6,
        debug: 7
    };
    static facilities = {
        kern: 0,
        user: 1,
        mail: 2,
        daemon: 3,
        auth: 4,
        syslog: 5,
        lpr: 6,
        news: 7,
        uucp: 8,
        local0: 16,
        local1: 17,
        local2: 18,
        local3: 19,
        local4: 20,
        local5: 21,
        local6: 22,
        local7: 23
    };
    tags = {
        mining: 'Mining',
        ln: 'Lightning',
        goggles: 'Goggles',
    };
    // @ts-ignore
    emerg;
    // @ts-ignore
    alert;
    // @ts-ignore
    crit;
    // @ts-ignore
    err;
    // @ts-ignore
    warn;
    // @ts-ignore
    notice;
    // @ts-ignore
    info;
    // @ts-ignore
    debug;
    name = 'mempool';
    client;
    network;
    constructor() {
        let prio;
        for (prio in Logger.priorities) {
            if (true) {
                this.addprio(prio);
            }
        }
        this.client = dgram.createSocket('udp4');
        // Unref the socket so it doesn't prevent Node.js from exiting
        this.client.unref();
        this.network = this.getNetwork();
    }
    updateNetwork() {
        this.network = this.getNetwork();
    }
    addprio(prio) {
        this[prio] = (function (_this) {
            return function (msg, tag) {
                return _this.msg(prio, msg, tag);
            };
        })(this);
    }
    getNetwork() {
        if (config_1.default.LIGHTNING.ENABLED) {
            return config_1.default.MEMPOOL.NETWORK === 'mainnet' ? 'lightning' : `${config_1.default.MEMPOOL.NETWORK}-lightning`;
        }
        if (config_1.default.MEMPOOL.NETWORK && config_1.default.MEMPOOL.NETWORK !== 'mainnet') {
            return config_1.default.MEMPOOL.NETWORK;
        }
        return '';
    }
    msg(priority, msg, tag) {
        let consolemsg, prionum, syslogmsg;
        if (typeof msg === 'string' && msg.length > 0) {
            while (msg[msg.length - 1].charCodeAt(0) === 10) {
                msg = msg.slice(0, msg.length - 1);
            }
        }
        const network = this.network ? ' <' + this.network + '>' : '';
        prionum = Logger.priorities[priority] || Logger.priorities.info;
        consolemsg = `${this.ts()} [${process.pid}] ${priority.toUpperCase()}:${network} ${tag ? '[' + tag + '] ' : ''}${msg}`;
        if (config_1.default.SYSLOG.ENABLED && Logger.priorities[priority] <= Logger.priorities[config_1.default.SYSLOG.MIN_PRIORITY]) {
            syslogmsg = `<${(Logger.facilities[config_1.default.SYSLOG.FACILITY] * 8 + prionum)}> ${this.name}[${process.pid}]: ${priority.toUpperCase()}${network} ${tag ? '[' + tag + '] ' : ''}${msg}`;
            this.syslog(syslogmsg);
        }
        if (Logger.priorities[priority] > Logger.priorities[config_1.default.MEMPOOL.STDOUT_LOG_MIN_PRIORITY]) {
            return;
        }
        if (priority === 'warning') {
            priority = 'warn';
        }
        if (priority === 'debug') {
            priority = 'info';
        }
        if (priority === 'err') {
            priority = 'error';
        }
        return (console[priority] || console.error)(consolemsg);
    }
    syslog(msg) {
        let msgbuf;
        msgbuf = Buffer.from(msg);
        this.client.send(msgbuf, 0, msgbuf.length, config_1.default.SYSLOG.PORT, config_1.default.SYSLOG.HOST, function (err, bytes) {
            if (err) {
                console.log(err);
            }
        });
    }
    leadZero(n) {
        if (n < 10) {
            return '0' + n;
        }
        return n;
    }
    ts() {
        let day, dt, hours, minutes, month, months, seconds;
        dt = new Date();
        hours = this.leadZero(dt.getHours());
        minutes = this.leadZero(dt.getMinutes());
        seconds = this.leadZero(dt.getSeconds());
        month = dt.getMonth();
        day = dt.getDate();
        if (day < 10) {
            day = ' ' + day;
        }
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[month] + ' ' + day + ' ' + hours + ':' + minutes + ':' + seconds;
    }
    /**
     * Close the UDP socket used for syslog
     * This should only be called when shutting down or in test teardown
     */
    close() {
        if (this.client) {
            // Unref allows Node.js to exit even if the socket is open
            this.client.unref();
            this.client.close(() => {
                // Socket closed callback
            });
        }
    }
}
exports.default = new Logger();
