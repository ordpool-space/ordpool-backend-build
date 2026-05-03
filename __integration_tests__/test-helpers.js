"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertTestBlock = exports.insertTestPool = exports.getTestDatabaseConfig = exports.waitForDatabase = exports.cleanupTestData = exports.setupTestDatabase = void 0;
const database_1 = __importDefault(require("../database"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../logger"));
const database_migration_1 = __importDefault(require("../api/database-migration"));
/**
 * Initialize the test database with schema migrations
 */
async function setupTestDatabase() {
    try {
        await database_1.default.checkDbConnection();
        await database_migration_1.default.$initializeOrMigrateDatabase();
    }
    catch (error) {
        logger_1.default.err('Failed to setup test database: ' + (error instanceof Error ? error.message : error));
        throw error;
    }
}
exports.setupTestDatabase = setupTestDatabase;
/**
 * Clean up all data from test tables (but preserve schema)
 * This runs between each test to ensure isolation
 */
async function cleanupTestData() {
    // Order matters: delete child tables before parent tables
    const tables = [
        'blocks_audits',
        'blocks_summaries',
        'blocks_prices',
        'blocks_templates',
        'cpfp_clusters',
        'blocks',
        'difficulty_adjustments',
        'hashrates',
        'prices',
        'node_records',
        'nodes_sockets',
        'nodes',
        'lightning_stats',
        'transactions',
        'elements_pegs',
        'federation_txos',
        'pools'
    ];
    try {
        // Disable foreign key checks temporarily for faster cleanup
        await database_1.default.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const table of tables) {
            try {
                // Use 'silent' error logging to avoid noise for optional tables that don't exist
                await database_1.default.query(`TRUNCATE TABLE ${table}`, [], 'silent');
            }
            catch (e) {
                // Table might not exist, that's okay for optional tables
                // Silently ignore - no need to log since these are expected for optional features
            }
        }
        // Re-enable foreign key checks
        await database_1.default.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    catch (error) {
        // Try to re-enable foreign keys even if cleanup failed
        try {
            await database_1.default.query('SET FOREIGN_KEY_CHECKS = 1');
        }
        catch (e) {
            // Ignore
        }
        logger_1.default.err('Failed to cleanup test data: ' + (error instanceof Error ? error.message : error));
        throw error;
    }
}
exports.cleanupTestData = cleanupTestData;
/**
 * Wait for database to be ready
 */
async function waitForDatabase(maxRetries = 30, retryInterval = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await database_1.default.query('SELECT 1');
            logger_1.default.info('Database is ready');
            return;
        }
        catch (error) {
            logger_1.default.debug(`Waiting for database... attempt ${i + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
    }
    throw new Error('Database did not become ready in time');
}
exports.waitForDatabase = waitForDatabase;
/**
 * Get database configuration for tests
 */
function getTestDatabaseConfig() {
    return {
        host: config_1.default.DATABASE.HOST,
        port: config_1.default.DATABASE.PORT,
        database: config_1.default.DATABASE.DATABASE,
        username: config_1.default.DATABASE.USERNAME,
        enabled: config_1.default.DATABASE.ENABLED
    };
}
exports.getTestDatabaseConfig = getTestDatabaseConfig;
/**
 * Insert a test pool into the database
 */
async function insertTestPool(poolData) {
    const [result] = await database_1.default.query(`INSERT INTO pools (unique_id, name, link, slug, addresses, regexes)
     VALUES (?, ?, ?, ?, ?, ?)`, [
        poolData.id || -1,
        poolData.name,
        poolData.link || '',
        poolData.slug,
        poolData.addresses || '[]',
        poolData.regexes || '[]'
    ]);
    return result.insertId;
}
exports.insertTestPool = insertTestPool;
/**
 * Insert a test block into the database
 */
async function insertTestBlock(blockData) {
    const timestamp = blockData.blockTimestamp || new Date();
    const size = blockData.size || 1000000;
    const weight = blockData.weight || 4000000;
    const txCount = blockData.tx_count || 2000;
    await database_1.default.query(`INSERT INTO blocks (
      height, hash, blockTimestamp, size, weight, tx_count, 
      difficulty, pool_id, version, bits, nonce, merkle_root, 
      previous_block_hash, median_timestamp, stale,
      fees, fee_span, median_fee,
      avg_tx_size, total_inputs, total_outputs, total_output_amt,
      segwit_total_txs, segwit_total_size, segwit_total_weight,
      header, utxoset_change
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        blockData.height,
        blockData.hash,
        timestamp,
        size,
        weight,
        txCount,
        blockData.difficulty || 1.0,
        blockData.poolId !== undefined ? blockData.poolId : null,
        0x20000000,
        0x1d00ffff,
        0,
        '0000000000000000000000000000000000000000000000000000000000000000',
        '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp,
        0,
        // Required fields with defaults
        50000000,
        JSON.stringify([0, 0, 0, 0, 0, 0, 0]),
        10000,
        size / txCount,
        txCount * 2,
        txCount * 2,
        2100000000000000,
        txCount,
        size,
        weight,
        '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        0 // utxoset_change
    ]);
}
exports.insertTestBlock = insertTestBlock;
