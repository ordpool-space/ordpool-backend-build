"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDPOOL_PARSER_FLAG_GENERATION = void 0;
/**
 * Generation of the ordpool flag bits the running code understands. Bumping
 * this invalidates `blocks_summaries` (via `ORDPOOL_BLOCK_SUMMARY_VERSION`)
 * and must be paired with a new migration block that wipes affected
 * `ordpool_stats` rows -- otherwise per-block stats stay stale.
 */
exports.ORDPOOL_PARSER_FLAG_GENERATION = 4;
