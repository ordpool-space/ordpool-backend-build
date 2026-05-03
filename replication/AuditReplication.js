"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const logger_1 = __importDefault(require("../logger"));
const BlocksAuditsRepository_1 = __importDefault(require("../repositories/BlocksAuditsRepository"));
const BlocksSummariesRepository_1 = __importDefault(require("../repositories/BlocksSummariesRepository"));
const replicator_1 = require("./replicator");
const config_1 = __importDefault(require("../config"));
const common_1 = require("../api/common");
const blocks_1 = __importDefault(require("../api/blocks"));
const BATCH_SIZE = 16;
/**
 * Syncs missing block template and audit data from trusted servers
 */
class AuditReplication {
    inProgress = false;
    skip = new Set();
    /** @asyncUnsafe */
    async $sync() {
        if (!config_1.default.REPLICATION.ENABLED || !config_1.default.REPLICATION.AUDIT) {
            // replication not enabled
            return;
        }
        if (this.inProgress) {
            logger_1.default.info(`AuditReplication sync already in progress`, 'Replication');
            return;
        }
        this.inProgress = true;
        const missingAudits = await this.$getMissingAuditBlocks();
        logger_1.default.debug(`Fetching missing audit data for ${missingAudits.length} blocks from trusted servers`, 'Replication');
        let totalSynced = 0;
        let totalMissed = 0;
        let loggerTimer = Date.now();
        // process missing audits in batches of BATCH_SIZE
        for (let i = 0; i < missingAudits.length; i += BATCH_SIZE) {
            const slice = missingAudits.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(slice.map(hash => this.$syncAudit(hash)));
            const synced = results.reduce((total, status) => status ? total + 1 : total, 0);
            totalSynced += synced;
            totalMissed += (slice.length - synced);
            if (Date.now() - loggerTimer > 10000) {
                loggerTimer = Date.now();
                logger_1.default.info(`Found ${totalSynced} / ${totalSynced + totalMissed} of ${missingAudits.length} missing audits`, 'Replication');
            }
            await common_1.Common.sleep$(1000);
        }
        logger_1.default.debug(`Fetched ${totalSynced} audits, ${totalMissed} still missing`, 'Replication');
        this.inProgress = false;
    }
    /** @asyncUnsafe */
    async $syncAudit(hash) {
        if (this.skip.has(hash)) {
            // we already know none of our trusted servers have this audit
            return false;
        }
        let success = false;
        // start with a random server so load is uniformly spread
        const syncResult = await (0, replicator_1.$sync)(`/api/v1/block/${hash}/audit-summary`);
        if (syncResult) {
            if (syncResult.data?.template?.length) {
                await this.$saveAuditData(hash, syncResult.data);
                logger_1.default.info(`Imported audit data from ${syncResult.server} for block ${syncResult.data.height} (${hash})`);
                success = true;
            }
            if (!syncResult.data && !syncResult.exists) {
                this.skip.add(hash);
            }
        }
        return success;
    }
    /** @asyncSafe */
    async $getMissingAuditBlocks() {
        try {
            const startHeight = config_1.default.REPLICATION.AUDIT_START_HEIGHT || 0;
            const [rows] = await database_1.default.query(`
        SELECT auditable.hash, auditable.height
        FROM (
          SELECT hash, height
          FROM blocks
          WHERE height >= ?
        ) AS auditable
        LEFT JOIN blocks_audits ON auditable.hash = blocks_audits.hash
        WHERE blocks_audits.hash IS NULL
        ORDER BY auditable.height DESC
      `, [startHeight]);
            return rows.map(row => row.hash);
        }
        catch (e) {
            logger_1.default.err(`Cannot fetch missing audit blocks from db. Reason: ` + (e instanceof Error ? e.message : e));
            throw e;
        }
    }
    async $saveAuditData(blockHash, auditSummary) {
        // save audit & template to DB
        await BlocksSummariesRepository_1.default.$saveTemplate({
            height: auditSummary.height,
            template: {
                id: blockHash,
                transactions: auditSummary.template || []
            },
            version: 1,
        });
        await BlocksAuditsRepository_1.default.$saveAudit({
            version: auditSummary.version || 0,
            templateAlgorithm: auditSummary.templateAlgorithm ?? 0,
            hash: blockHash,
            height: auditSummary.height,
            time: auditSummary.timestamp || auditSummary.time,
            unseenTxs: auditSummary.unseenTxs || [],
            missingTxs: auditSummary.missingTxs || [],
            addedTxs: auditSummary.addedTxs || [],
            prioritizedTxs: auditSummary.prioritizedTxs || [],
            freshTxs: auditSummary.freshTxs || [],
            sigopTxs: auditSummary.sigopTxs || [],
            fullrbfTxs: auditSummary.fullrbfTxs || [],
            acceleratedTxs: auditSummary.acceleratedTxs || [],
            matchRate: auditSummary.matchRate,
            expectedFees: auditSummary.expectedFees,
            expectedWeight: auditSummary.expectedWeight,
        });
        // add missing data to cached blocks
        const cachedBlock = blocks_1.default.getBlocks().find(block => block.id === blockHash);
        if (cachedBlock) {
            cachedBlock.extras.matchRate = auditSummary.matchRate;
            cachedBlock.extras.expectedFees = auditSummary.expectedFees || null;
            cachedBlock.extras.expectedWeight = auditSummary.expectedWeight || null;
        }
    }
}
exports.default = new AuditReplication();
