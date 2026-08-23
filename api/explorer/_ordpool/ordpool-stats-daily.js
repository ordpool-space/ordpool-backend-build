"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollupGroupBy = exports.getRollupSelectClause = exports.buildUpsertQuery = exports.rollupTableDdl = exports.getLiveSelectClause = exports.isRollupChart = exports.CHART_METRICS = void 0;
const ordpool_parser_1 = require("ordpool-parser");
const config_1 = __importDefault(require("../../../config"));
const database_1 = __importDefault(require("../../../database"));
const logger_1 = __importDefault(require("../../../logger"));
/** ordpool_stats columns that are DOUBLE (fee rates); everything else is INT. */
const DOUBLE_COLS = new Set([
    'cat21_avg_fee_rate',
    'cat21_min_fee_rate',
    'cat21_max_fee_rate',
]);
/**
 * The single source of truth for which ordpool_stats columns each (non-satellite)
 * chart reads and how it aggregates them. The live SELECT clause, the rollup
 * table shape, the backfill query and the rollup read query are all generated
 * from this, so they cannot drift.
 */
exports.CHART_METRICS = {
    'mints': [
        { alias: 'cat21Mints', col: 'amounts_cat21_mint', agg: 'SUM' },
        { alias: 'inscriptionMints', col: 'amounts_inscription_mint', agg: 'SUM' },
        { alias: 'runeMints', col: 'amounts_rune_mint', agg: 'SUM' },
        { alias: 'brc20Mints', col: 'amounts_brc20_mint', agg: 'SUM' },
        { alias: 'src20Mints', col: 'amounts_src20_mint', agg: 'SUM' },
    ],
    'new-tokens': [
        { alias: 'runeEtchings', col: 'amounts_rune_etch', agg: 'SUM' },
        { alias: 'brc20Deploys', col: 'amounts_brc20_deploy', agg: 'SUM' },
        { alias: 'src20Deploys', col: 'amounts_src20_deploy', agg: 'SUM' },
    ],
    'fees': [
        { alias: 'feesRuneMints', col: 'fees_rune_mints', agg: 'SUM' },
        { alias: 'feesNonUncommonRuneMints', col: 'fees_non_uncommon_rune_mints', agg: 'SUM' },
        { alias: 'feesBrc20Mints', col: 'fees_brc20_mints', agg: 'SUM' },
        { alias: 'feesSrc20Mints', col: 'fees_src20_mints', agg: 'SUM' },
        { alias: 'feesCat21Mints', col: 'fees_cat21_mints', agg: 'SUM' },
        { alias: 'feesAtomicals', col: 'fees_atomicals', agg: 'SUM' },
        { alias: 'feesInscriptionMints', col: 'fees_inscription_mints', agg: 'SUM' },
    ],
    'inscription-sizes': [
        { alias: 'totalEnvelopeSize', col: 'inscriptions_total_envelope_size', agg: 'SUM' },
        { alias: 'totalContentSize', col: 'inscriptions_total_content_size', agg: 'SUM' },
        { alias: 'largestEnvelopeSize', col: 'inscriptions_largest_envelope_size', agg: 'MAX' },
        { alias: 'largestContentSize', col: 'inscriptions_largest_content_size', agg: 'MAX' },
        { alias: 'avgEnvelopeSize', col: 'inscriptions_average_envelope_size', agg: 'AVG' },
        { alias: 'avgContentSize', col: 'inscriptions_average_content_size', agg: 'AVG' },
    ],
    'protocols': [
        { alias: 'counterparty', col: 'amounts_counterparty', agg: 'SUM' },
        { alias: 'stamp', col: 'amounts_stamp', agg: 'SUM' },
        { alias: 'src721', col: 'amounts_src721', agg: 'SUM' },
        { alias: 'src101', col: 'amounts_src101', agg: 'SUM' },
    ],
    'inscription-types': [
        { alias: 'inscriptionImages', col: 'amounts_inscription_image', agg: 'SUM' },
        { alias: 'inscriptionTexts', col: 'amounts_inscription_text', agg: 'SUM' },
        { alias: 'inscriptionJsons', col: 'amounts_inscription_json', agg: 'SUM' },
    ],
    'inscription-type-sizes': [
        { alias: 'imageTotalEnvelopeSize', col: 'inscriptions_image_total_envelope_size', agg: 'SUM' },
        { alias: 'imageTotalContentSize', col: 'inscriptions_image_total_content_size', agg: 'SUM' },
        { alias: 'imageAvgEnvelopeSize', col: 'inscriptions_image_average_envelope_size', agg: 'AVG' },
        { alias: 'imageAvgContentSize', col: 'inscriptions_image_average_content_size', agg: 'AVG' },
        { alias: 'textTotalEnvelopeSize', col: 'inscriptions_text_total_envelope_size', agg: 'SUM' },
        { alias: 'textTotalContentSize', col: 'inscriptions_text_total_content_size', agg: 'SUM' },
        { alias: 'textAvgEnvelopeSize', col: 'inscriptions_text_average_envelope_size', agg: 'AVG' },
        { alias: 'textAvgContentSize', col: 'inscriptions_text_average_content_size', agg: 'AVG' },
        { alias: 'jsonTotalEnvelopeSize', col: 'inscriptions_json_total_envelope_size', agg: 'SUM' },
        { alias: 'jsonTotalContentSize', col: 'inscriptions_json_total_content_size', agg: 'SUM' },
        { alias: 'jsonAvgEnvelopeSize', col: 'inscriptions_json_average_envelope_size', agg: 'AVG' },
        { alias: 'jsonAvgContentSize', col: 'inscriptions_json_average_content_size', agg: 'AVG' },
    ],
    'inscription-type-fees': [
        { alias: 'feesInscriptionImageMints', col: 'fees_inscription_image_mints', agg: 'SUM' },
        { alias: 'feesInscriptionTextMints', col: 'fees_inscription_text_mints', agg: 'SUM' },
        { alias: 'feesInscriptionJsonMints', col: 'fees_inscription_json_mints', agg: 'SUM' },
    ],
    'inscription-compression': [
        { alias: 'brotliCount', col: 'inscriptions_brotli_count', agg: 'SUM' },
        { alias: 'gzipCount', col: 'inscriptions_gzip_count', agg: 'SUM' },
        { alias: 'compressedEnvelopeBytes', col: 'inscriptions_compressed_envelope_bytes', agg: 'SUM' },
    ],
    'cat21-stats': [
        { alias: 'cat21Mints', col: 'amounts_cat21_mint', agg: 'SUM' },
        { alias: 'cat21GenesisCount', col: 'cat21_genesis_count', agg: 'SUM' },
        { alias: 'cat21AvgFeeRate', col: 'cat21_avg_fee_rate', agg: 'AVG' },
        { alias: 'cat21MinFeeRate', col: 'cat21_min_fee_rate', agg: 'MIN' },
        { alias: 'cat21MaxFeeRate', col: 'cat21_max_fee_rate', agg: 'MAX' },
    ],
    'rune-activity': [
        { alias: 'uniqueMints', col: 'runes_unique_mints_count', agg: 'SUM' },
        { alias: 'uniqueMintsNonUncommon', col: 'runes_unique_mints_count_non_uncommon', agg: 'SUM' },
        { alias: 'topMintCount', col: 'runes_top_mint_count', agg: 'MAX' },
        { alias: 'topMintCountNonUncommon', col: 'runes_top_mint_count_non_uncommon', agg: 'MAX' },
    ],
};
/** True for chart types served by the daily rollup (everything except the
 *  satellite-table charts, which have their own tables + read paths). */
function isRollupChart(type) {
    return Object.prototype.hasOwnProperty.call(exports.CHART_METRICS, type);
}
exports.isRollupChart = isRollupChart;
/** The base MIN/MAX height + time columns every chart response carries. */
const BASE_SELECT = `
      MIN(b.height) AS minHeight,
      MAX(b.height) AS maxHeight,
      MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime,
      MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime`;
/**
 * Live SELECT clause (block/hour aggregation + fallback before the rollup is
 * ready): aggregate the ordpool_stats columns directly. Generated from
 * CHART_METRICS so it can never diverge from the rollup path.
 */
function getLiveSelectClause(type) {
    const metrics = exports.CHART_METRICS[type];
    if (!metrics) {
        throw new Error('Invalid chart type: ' + type);
    }
    const cols = metrics.map((m) => `${m.agg}(bos.${m.col}) AS ${m.alias}`);
    return `${BASE_SELECT},\n      ${cols.join(',\n      ')}`;
}
exports.getLiveSelectClause = getLiveSelectClause;
/** Distinct source columns across all rollup charts, each with its agg. A column
 *  always uses the same agg wherever it appears, so keying by column is safe. */
function distinctRollupColumns() {
    const seen = new Map();
    for (const metrics of Object.values(exports.CHART_METRICS)) {
        for (const m of metrics) {
            seen.set(m.col, m.agg);
        }
    }
    return [...seen.entries()].map(([col, agg]) => ({ col, agg }));
}
const sqlType = (col) => (DOUBLE_COLS.has(col) ? 'DOUBLE' : 'BIGINT');
/**
 * CREATE TABLE for the daily rollup. SUM/MAX/MIN columns store the day's
 * aggregate directly; AVG columns store SUM + COUNT so a coarser bucket
 * recomputes `SUM/COUNT` exactly (AVG-of-AVG would be wrong), matching the live
 * query's `AVG(col)` = `SUM(col)/COUNT(col)` over the period.
 */
function rollupTableDdl() {
    const cols = [
        '`day` DATE NOT NULL PRIMARY KEY',
        '`minHeight` INT NULL',
        '`maxHeight` INT NULL',
        '`minTime` BIGINT NULL',
        '`maxTime` BIGINT NULL',
    ];
    for (const { col, agg } of distinctRollupColumns()) {
        if (agg === 'AVG') {
            cols.push(`\`${col}_sum\` ${sqlType(col)} NULL`);
            cols.push(`\`${col}_cnt\` BIGINT NULL`);
        }
        else {
            cols.push(`\`${col}\` ${sqlType(col)} NULL`);
        }
    }
    return `CREATE TABLE IF NOT EXISTS ordpool_stats_daily (\n  ${cols.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
}
exports.rollupTableDdl = rollupTableDdl;
/** Column list (excluding `day`) the backfill INSERT writes / ON DUPLICATE updates. */
function rollupValueColumns() {
    const out = ['minHeight', 'maxHeight', 'minTime', 'maxTime'];
    for (const { col, agg } of distinctRollupColumns()) {
        if (agg === 'AVG') {
            out.push(`${col}_sum`, `${col}_cnt`);
        }
        else {
            out.push(col);
        }
    }
    return out;
}
/**
 * INSERT ... SELECT that (re)computes one row per calendar day from
 * blocks LEFT JOIN ordpool_stats, upserting via ON DUPLICATE KEY UPDATE.
 * `extraWhere` bounds which blocks are read (empty = full backfill).
 */
function buildUpsertQuery(firstInscriptionHeight, extraWhere) {
    const selectCols = [
        'DATE(b.blockTimestamp) AS `day`',
        'MIN(b.height) AS minHeight',
        'MAX(b.height) AS maxHeight',
        'MIN(UNIX_TIMESTAMP(b.blockTimestamp)) AS minTime',
        'MAX(UNIX_TIMESTAMP(b.blockTimestamp)) AS maxTime',
    ];
    for (const { col, agg } of distinctRollupColumns()) {
        if (agg === 'AVG') {
            selectCols.push(`SUM(bos.${col}) AS ${col}_sum`);
            selectCols.push(`COUNT(bos.${col}) AS ${col}_cnt`);
        }
        else {
            selectCols.push(`${agg}(bos.${col}) AS ${col}`);
        }
    }
    const valueCols = rollupValueColumns();
    const updates = valueCols.map((c) => `${c} = VALUES(${c})`).join(',\n    ');
    return `
    INSERT INTO ordpool_stats_daily (\`day\`, ${valueCols.join(', ')})
    SELECT ${selectCols.join(',\n      ')}
    FROM blocks b
    LEFT JOIN ordpool_stats bos ON b.hash = bos.hash
    WHERE b.height >= ${firstInscriptionHeight}${extraWhere}
    GROUP BY DATE(b.blockTimestamp)
    ON DUPLICATE KEY UPDATE
    ${updates};`;
}
exports.buildUpsertQuery = buildUpsertQuery;
/**
 * SELECT clause reading the rollup: SUM/MAX/MIN roll up directly; AVG becomes
 * `SUM(col_sum)/NULLIF(SUM(col_cnt),0)`. Column names are validated against
 * CHART_METRICS, never interpolated from request input.
 */
function getRollupSelectClause(type) {
    const metrics = exports.CHART_METRICS[type];
    if (!metrics) {
        throw new Error('Invalid chart type: ' + type);
    }
    const base = `
      MIN(d.minHeight) AS minHeight,
      MAX(d.maxHeight) AS maxHeight,
      MIN(d.minTime) AS minTime,
      MAX(d.maxTime) AS maxTime`;
    const cols = metrics.map((m) => {
        if (m.agg === 'AVG') {
            return `SUM(d.${m.col}_sum) / NULLIF(SUM(d.${m.col}_cnt), 0) AS ${m.alias}`;
        }
        return `${m.agg}(d.${m.col}) AS ${m.alias}`;
    });
    return `${base},\n      ${cols.join(',\n      ')}`;
}
exports.getRollupSelectClause = getRollupSelectClause;
/** GROUP BY over the (already tiny) daily rollup for coarser buckets. */
function rollupGroupBy(aggregation) {
    switch (aggregation) {
        case 'week': return 'GROUP BY YEAR(d.day), WEEK(d.day)';
        case 'month': return 'GROUP BY YEAR(d.day), MONTH(d.day)';
        case 'year': return 'GROUP BY YEAR(d.day)';
        case 'day':
        default: return 'GROUP BY d.day';
    }
}
exports.rollupGroupBy = rollupGroupBy;
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
/** Recompute this many trailing days each tick: today's bucket always moves,
 *  and a small window absorbs late-arriving reorged/re-indexed blocks. */
const REFRESH_TRAILING_DAYS = 3;
class OrdpoolStatsDaily {
    timer = null;
    running = false;
    inFlight = false;
    start() {
        if (this.running)
            return;
        this.running = true;
        this.tick().catch((e) => logger_1.default.err('ordpool daily rollup first tick failed: ' + errMsg(e), 'Ordpool'));
        this.timer = setInterval(() => {
            this.tick().catch((e) => logger_1.default.err('ordpool daily rollup tick failed: ' + errMsg(e), 'Ordpool'));
        }, REFRESH_INTERVAL_MS);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.running = false;
    }
    async tick() {
        if (this.inFlight)
            return;
        this.inFlight = true;
        try {
            const firstInscriptionHeight = (0, ordpool_parser_1.getFirstInscriptionHeight)(config_1.default.MEMPOOL.NETWORK);
            if (await this.isEmpty()) {
                logger_1.default.info('ordpool daily rollup empty -> full backfill', 'Ordpool');
                await database_1.default.query({ sql: buildUpsertQuery(firstInscriptionHeight, ''), timeout: 3600_000 });
                logger_1.default.notice('ordpool daily rollup backfill complete', 'Ordpool');
            }
            else {
                await database_1.default.query({
                    sql: buildUpsertQuery(firstInscriptionHeight, `\n        AND b.blockTimestamp >= DATE_SUB(CURDATE(), INTERVAL ${REFRESH_TRAILING_DAYS} DAY)`),
                    timeout: 600_000,
                });
            }
        }
        finally {
            this.inFlight = false;
        }
    }
    async isEmpty() {
        const [rows] = await database_1.default.query(`SELECT COUNT(*) AS c FROM ordpool_stats_daily;`);
        return (rows[0]?.c ?? 0) === 0;
    }
    /** The rollup is trustworthy for reads only once it has been backfilled AND
     *  kept current (its newest day is within the last two days). Otherwise the
     *  API falls back to the live query. */
    async isReady() {
        try {
            const [rows] = await database_1.default.query(`SELECT MAX(\`day\`) AS maxDay FROM ordpool_stats_daily WHERE \`day\` >= DATE_SUB(CURDATE(), INTERVAL 2 DAY);`);
            return rows[0]?.maxDay != null;
        }
        catch {
            return false;
        }
    }
}
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
exports.default = new OrdpoolStatsDaily();
