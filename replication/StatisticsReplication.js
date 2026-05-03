"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const replicator_1 = require("./replicator");
const config_1 = __importDefault(require("../config"));
const common_1 = require("../api/common");
const statistics_api_1 = __importDefault(require("../api/statistics/statistics-api"));
const steps = {
    '24h': 60,
    '1w': 300,
    '1m': 1800,
    '3m': 7200,
    '6m': 10800,
    '2y': 28800,
    'all': 43200,
};
/**
 * Syncs missing statistics data from trusted servers
 */
class StatisticsReplication {
    inProgress = false;
    /** @asyncUnsafe */
    async $sync() {
        if (!config_1.default.REPLICATION.ENABLED || !config_1.default.REPLICATION.STATISTICS || !config_1.default.STATISTICS.ENABLED) {
            // replication not enabled, or statistics not enabled
            return;
        }
        if (this.inProgress) {
            logger_1.default.info(`StatisticsReplication sync already in progress`, 'Replication');
            return;
        }
        this.inProgress = true;
        const missingStatistics = await this.$getMissingStatistics();
        const missingIntervals = Object.keys(missingStatistics).filter(key => missingStatistics[key].size > 0);
        const totalMissing = missingIntervals.reduce((total, key) => total + missingStatistics[key].size, 0);
        if (totalMissing === 0) {
            this.inProgress = false;
            logger_1.default.info(`Statistics table is complete, no replication needed`, 'Replication');
            return;
        }
        for (const interval of missingIntervals) {
            logger_1.default.debug(`Missing ${missingStatistics[interval].size} statistics rows in '${interval}' timespan`, 'Replication');
        }
        logger_1.default.debug(`Fetching ${missingIntervals.join(', ')} statistics endpoints from trusted servers to fill ${totalMissing} rows missing in statistics`, 'Replication');
        let totalSynced = 0;
        let totalMissed = 0;
        for (const interval of missingIntervals) {
            const results = await this.$syncStatistics(interval, missingStatistics[interval]);
            totalSynced += results.synced;
            totalMissed += results.missed;
            logger_1.default.info(`Found ${totalSynced} / ${totalSynced + totalMissed} of ${totalMissing} missing statistics rows`, 'Replication');
            await common_1.Common.sleep$(3000);
        }
        logger_1.default.debug(`Synced ${totalSynced} statistics rows, ${totalMissed} still missing`, 'Replication');
        this.inProgress = false;
    }
    /** @asyncUnsafe */
    async $syncStatistics(interval, missingTimes) {
        let success = false;
        let synced = 0;
        const missed = new Set(missingTimes);
        const syncResult = await (0, replicator_1.$sync)(`/api/v1/statistics/${interval}`);
        if (syncResult && syncResult.data?.length) {
            success = true;
            logger_1.default.info(`Fetched /api/v1/statistics/${interval} from ${syncResult.server}`);
            for (const stat of syncResult.data) {
                const time = this.roundToNearestStep(stat.added, steps[interval]);
                if (missingTimes.has(time)) {
                    try {
                        await statistics_api_1.default.$create(statistics_api_1.default.mapOptimizedStatisticToStatistic([stat])[0], true);
                        if (missed.delete(time)) {
                            synced++;
                        }
                    }
                    catch (e) {
                        logger_1.default.err(`Failed to insert statistics row at ${stat.added} (${interval}) from ${syncResult.server}. Reason: ` + (e instanceof Error ? e.message : e));
                    }
                }
            }
        }
        else {
            logger_1.default.warn(`An error occured when trying to fetch /api/v1/statistics/${interval}`);
        }
        return { success, synced, missed: missed.size };
    }
    /** @asyncUnsafe */
    async $getMissingStatistics() {
        try {
            const now = Math.floor(Date.now() / 1000);
            const day = 60 * 60 * 24;
            const startTime = this.getStartTimeFromConfig();
            const missingStatistics = {
                '24h': new Set(),
                '1w': new Set(),
                '1m': new Set(),
                '3m': new Set(),
                '6m': new Set(),
                '2y': new Set(),
                'all': new Set()
            };
            const intervals = [
                [now - day + 600, now - 60, '24h'],
                startTime < now - day ? [now - day * 7, now - day, '1w'] : null,
                startTime < now - day * 7 ? [now - day * 30, now - day * 7, '1m'] : null,
                startTime < now - day * 30 ? [now - day * 90, now - day * 30, '3m'] : null,
                startTime < now - day * 90 ? [now - day * 180, now - day * 90, '6m'] : null,
                startTime < now - day * 180 ? [now - day * 365 * 2, now - day * 180, '2y'] : null,
                startTime < now - day * 365 * 2 ? [startTime, now - day * 365 * 2, 'all'] : null, // from start of statistics to 2 years ago = 12 hours granularity
            ];
            for (const interval of intervals) {
                if (!interval) {
                    continue;
                }
                missingStatistics[interval[2]] = await this.$getMissingStatisticsInterval(interval, startTime);
            }
            return missingStatistics;
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch missing statistics times from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    /** @asyncUnsafe */
    async $getMissingStatisticsInterval(interval, startTime) {
        try {
            const start = interval[0];
            const end = interval[1];
            const step = steps[interval[2]];
            const [rows] = await database_1.default.query(`
        SELECT UNIX_TIMESTAMP(added) as added
        FROM statistics
        WHERE added >= FROM_UNIXTIME(?) AND added <= FROM_UNIXTIME(?)
        GROUP BY UNIX_TIMESTAMP(added) DIV ${step} ORDER BY statistics.added DESC
      `, [start, end]);
            const startingTime = Math.max(startTime, start) - Math.max(startTime, start) % step;
            const timeSteps = [];
            for (let time = startingTime; time < end; time += step) {
                timeSteps.push(time);
            }
            if (timeSteps.length === 0) {
                return new Set();
            }
            const roundedTimesAlreadyHere = Array.from(new Set(rows.map(row => this.roundToNearestStep(row.added, step))));
            const missingTimes = timeSteps.filter(time => !roundedTimesAlreadyHere.includes(time)).filter((time, i, arr) => {
                // Remove outsiders
                if (i === 0) {
                    return arr[i + 1] === time + step;
                }
                else if (i === arr.length - 1) {
                    return arr[i - 1] === time - step;
                }
                return (arr[i + 1] === time + step) && (arr[i - 1] === time - step);
            });
            // Don't bother fetching if very few rows are missing
            if (missingTimes.length < timeSteps.length * 0.01) {
                return new Set();
            }
            return new Set(missingTimes);
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch missing statistics times from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    roundToNearestStep(time, step) {
        const remainder = time % step;
        if (remainder < step / 2) {
            return time - remainder;
        }
        else {
            return time + (step - remainder);
        }
    }
    getStartTimeFromConfig() {
        const now = Math.floor(Date.now() / 1000);
        const day = 60 * 60 * 24;
        let startTime;
        if (typeof (config_1.default.REPLICATION.STATISTICS_START_TIME) === 'string' && ['24h', '1w', '1m', '3m', '6m', '2y', 'all'].includes(config_1.default.REPLICATION.STATISTICS_START_TIME)) {
            if (config_1.default.REPLICATION.STATISTICS_START_TIME === 'all') {
                startTime = 1481932800;
            }
            else if (config_1.default.REPLICATION.STATISTICS_START_TIME === '2y') {
                startTime = now - day * 365 * 2;
            }
            else if (config_1.default.REPLICATION.STATISTICS_START_TIME === '6m') {
                startTime = now - day * 180;
            }
            else if (config_1.default.REPLICATION.STATISTICS_START_TIME === '3m') {
                startTime = now - day * 90;
            }
            else if (config_1.default.REPLICATION.STATISTICS_START_TIME === '1m') {
                startTime = now - day * 30;
            }
            else if (config_1.default.REPLICATION.STATISTICS_START_TIME === '1w') {
                startTime = now - day * 7;
            }
            else {
                startTime = now - day;
            }
        }
        else {
            startTime = Math.max(config_1.default.REPLICATION.STATISTICS_START_TIME || 1481932800, 1481932800);
        }
        return startTime;
    }
}
exports.default = new StatisticsReplication();
