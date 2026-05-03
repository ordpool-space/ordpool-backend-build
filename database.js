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
const path_1 = __importDefault(require("path"));
const config_1 = __importDefault(require("./config"));
const promise_1 = require("mysql2/promise");
const logger_1 = __importDefault(require("./logger"));
const child_process_1 = require("child_process");
class DB {
    constructor() {
        if (config_1.default.DATABASE.SOCKET !== '') {
            this.poolConfig.socketPath = config_1.default.DATABASE.SOCKET;
        }
        else {
            this.poolConfig.host = config_1.default.DATABASE.HOST;
        }
    }
    pool = null;
    poolConfig = {
        port: config_1.default.DATABASE.PORT,
        database: config_1.default.DATABASE.DATABASE,
        user: config_1.default.DATABASE.USERNAME,
        password: config_1.default.DATABASE.PASSWORD,
        connectionLimit: config_1.default.DATABASE.POOL_SIZE,
        supportBigNumbers: true,
        timezone: '+00:00',
    };
    /** @asyncUnsafe */
    checkDBFlag() {
        if (config_1.default.DATABASE.ENABLED === false) {
            const stack = new Error().stack;
            logger_1.default.err(`Trying to use DB feature but config.DATABASE.ENABLED is set to false, please open an issue.\nStack trace: ${stack}}`);
        }
    }
    /** @asyncUnsafe */
    async query(query, params, errorLogLevel = 'debug', connection) {
        this.checkDBFlag();
        let hardTimeout;
        if (query?.timeout != null) {
            hardTimeout = Math.floor(query.timeout * 1.1);
        }
        else {
            hardTimeout = config_1.default.DATABASE.TIMEOUT;
        }
        if (hardTimeout > 0) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`DB query failed to return, reject or time out within ${hardTimeout / 1000}s - ${query?.sql?.slice(0, 160) || (typeof (query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}`));
                }, hardTimeout);
                // Use a specific connection if provided, otherwise delegate to the pool
                const connectionPromise = connection ? Promise.resolve(connection) : this.getPool();
                connectionPromise.then((pool) => {
                    return pool.query(query, params);
                }).then(result => {
                    resolve(result);
                }).catch(error => {
                    if (errorLogLevel !== 'silent') {
                        logger_1.default[errorLogLevel](`database query "${query?.sql?.slice(0, 160) || (typeof (query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}" failed!`);
                    }
                    reject(error);
                }).finally(() => {
                    clearTimeout(timer);
                });
            });
        }
        else {
            try {
                const pool = await this.getPool();
                return pool.query(query, params);
            }
            catch (e) {
                if (errorLogLevel !== 'silent') {
                    logger_1.default[errorLogLevel](`database query "${query?.sql?.slice(0, 160) || (typeof (query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}" failed!`);
                }
                throw e;
            }
        }
    }
    /** @asyncSafe */
    async $rollbackAtomic(connection) {
        try {
            await connection.rollback();
            await connection.release();
        }
        catch (e) {
            logger_1.default.warn('Failed to rollback incomplete db transaction: ' + (e instanceof Error ? e.message : e));
        }
    }
    /** @asyncSafe */
    async $atomicQuery(queries, errorLogLevel = 'debug') {
        const pool = await this.getPool();
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            const results = [];
            for (const query of queries) {
                const result = await this.query(query.query, query.params, errorLogLevel, connection);
                results.push(result);
            }
            await connection.commit();
            return results;
        }
        catch (e) {
            logger_1.default.warn('Could not complete db transaction, rolling back: ' + (e instanceof Error ? e.message : e));
            if (connection) {
                await this.$rollbackAtomic(connection);
            }
            throw e;
        }
        finally {
            if (connection) {
                connection.release();
            }
        }
    }
    /** @asyncSafe */
    async checkDbConnection() {
        this.checkDBFlag();
        try {
            await this.query('SELECT ?', [1]);
            logger_1.default.info('Database connection established.');
        }
        catch (e) {
            logger_1.default.err('Could not connect to database: ' + (e instanceof Error ? e.message : e));
            process.exit(1);
        }
    }
    getPidLock() {
        const filePath = path_1.default.join(config_1.default.DATABASE.PID_DIR || __dirname, `/mempool-${config_1.default.DATABASE.DATABASE}.pid`);
        this.enforcePidLock(filePath);
        fs.writeFileSync(filePath, `${process.pid}`);
        return true;
    }
    enforcePidLock(filePath) {
        if (fs.existsSync(filePath)) {
            const pid = parseInt(fs.readFileSync(filePath, 'utf-8'));
            if (pid === process.pid) {
                logger_1.default.warn('PID file already exists for this process');
                return;
            }
            let cmd;
            try {
                cmd = (0, child_process_1.execSync)(`ps -p ${pid} -o args=`);
            }
            catch (e) {
                logger_1.default.warn(`Stale PID file at ${filePath}, but no process running on that PID ${pid}`);
                return;
            }
            if (cmd && cmd.toString()?.includes('node')) {
                const msg = `Another mempool nodejs process is already running on PID ${pid}`;
                logger_1.default.err(msg);
                throw new Error(msg);
            }
            else {
                logger_1.default.warn(`Stale PID file at ${filePath}, but the PID ${pid} does not belong to a running mempool instance`);
            }
        }
    }
    releasePidLock() {
        const filePath = path_1.default.join(config_1.default.DATABASE.PID_DIR || __dirname, `/mempool-${config_1.default.DATABASE.DATABASE}.pid`);
        if (fs.existsSync(filePath)) {
            const pid = parseInt(fs.readFileSync(filePath, 'utf-8'));
            // only release our own pid file
            if (pid === process.pid) {
                fs.unlinkSync(filePath);
            }
        }
    }
    /** @asyncSafe */
    async getPool() {
        if (this.pool === null) {
            this.pool = (0, promise_1.createPool)(this.poolConfig);
            this.pool.on('connection', function (newConnection) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises -- callback API, not a promise despite types
                newConnection.query(`SET time_zone='+00:00'`);
                // HACK for Ordpool: increase the GROUP_CONCAT maximum length for the current session to 5MB
                newConnection.query(`SET SESSION group_concat_max_len = 5120000`);
            });
        }
        return this.pool;
    }
    /**
     * Close the database connection pool
     * This should only be called when the application is shutting down
     * or at the end of test suites
     */
    async close() {
        if (this.pool !== null) {
            try {
                await this.pool.end();
            }
            catch (e) {
                logger_1.default.err(`Exception in close. Reason: ${(e instanceof Error ? e.message : e)}`);
            }
            this.pool = null;
            logger_1.default.debug('Database connection pool closed');
        }
    }
}
exports.default = new DB();
