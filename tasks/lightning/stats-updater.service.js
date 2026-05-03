"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../../logger"));
const lightning_api_factory_1 = __importDefault(require("../../api/lightning/lightning-api-factory"));
const stats_importer_1 = __importDefault(require("./sync-tasks/stats-importer"));
const config_1 = __importDefault(require("../../config"));
const common_1 = require("../../api/common");
class LightningStatsUpdater {
    async $startService() {
        logger_1.default.info(`Starting Lightning Stats service`, logger_1.default.tags.ln);
        await this.$runTasks();
        void stats_importer_1.default.$run();
    }
    /** @asyncSafe */
    async $runTasks() {
        await this.$logStatsDaily();
        setTimeout(() => { void this.$runTasks(); }, 1000 * config_1.default.LIGHTNING.STATS_REFRESH_INTERVAL);
    }
    /**
     * Update the latest entry for each node every config.LIGHTNING.STATS_REFRESH_INTERVAL seconds
     * @asyncSafe
     */
    async $logStatsDaily() {
        try {
            const date = new Date();
            common_1.Common.setDateMidnight(date);
            const networkGraph = await lightning_api_factory_1.default.$getNetworkGraph();
            await stats_importer_1.default.computeNetworkStats(date.getTime() / 1000, networkGraph);
            logger_1.default.debug(`Updated latest network stats`, logger_1.default.tags.ln);
        }
        catch (e) {
            logger_1.default.err(`Exception in $logStatsDaily. Reason: ${(e instanceof Error ? e.message : e)}`);
        }
    }
}
exports.default = new LightningStatsUpdater();
