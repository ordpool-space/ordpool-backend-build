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
const bitcoin_client_1 = __importDefault(require("../bitcoin/bitcoin-client"));
const bitcoin_second_client_1 = __importDefault(require("../bitcoin/bitcoin-second-client"));
const common_1 = require("../common");
const database_1 = __importDefault(require("../../database"));
const logger_1 = __importDefault(require("../../logger"));
const bitcoinjs = __importStar(require("bitcoinjs-lib"));
const auditBlockOffsetWithTip = 1; // Wait for 1 block confirmation before processing the block in the audit process to reduce the risk of reorgs
const auditSyncToleranceBlocks = 105; // Audit lag from bitcoin tip to avoid potential unsynced state on peg-ins, which require 102 confirmations
const DYNAFED_ACTIVATION_HEIGHT = 1517040;
const DYNAFED_CHECK_INTERVAL = 20160;
const FEDERATION_TIMELOCK_FALLBACK = 0x0000ffff; // Preventive timelock in case an error occurs while extracting it from the fedpegscript
class ElementsParser {
    isRunning = false;
    federationPegScripts = [];
    constructor() { }
    async $parse() {
        if (this.isRunning) {
            return;
        }
        try {
            this.isRunning = true;
            const startedAt = Date.now() / 1000;
            const stopAt = startedAt + 3600; // Limit one parse run to 1 hour to keep the tip sufficiently up to date
            const result = await bitcoin_client_1.default.getChainTips();
            const tip = result[0].height;
            const latestBlockHeight = await this.$getLatestBlockHeightFromDatabase();
            for (let height = latestBlockHeight + 1; height <= tip; height++) {
                if ((Date.now() / 1000) >= stopAt) {
                    logger_1.default.debug(`Reached max Elements parsing runtime of one hour, pausing parse to resume later`);
                    break;
                }
                const blockHash = await bitcoin_client_1.default.getBlockHash(height);
                const block = await bitcoin_client_1.default.getBlock(blockHash, 2);
                await this.$updateFederationPegScripts(block);
                await this.$parseBlock(block);
                await this.$saveLatestBlockToDatabase(block.height);
            }
            await this.$updateFederationUtxos(stopAt);
            this.isRunning = false;
        }
        catch (e) {
            this.isRunning = false;
            throw new Error(e instanceof Error ? e.message : 'Error');
        }
    }
    /** @asyncUnsafe */
    async $parseBlock(block) {
        for (const tx of block.tx) {
            await this.$parseInputs(tx, block);
            await this.$parseOutputs(tx, block);
        }
    }
    /** @asyncUnsafe */
    async $parseInputs(tx, block) {
        for (const [index, input] of tx.vin.entries()) {
            if (input.is_pegin) {
                await this.$parsePegIn(input, index, tx.txid, block);
            }
        }
    }
    /** @asyncUnsafe */
    async $parsePegIn(input, vindex, txid, block) {
        const bitcoinTx = await bitcoin_second_client_1.default.getRawTransaction(input.txid, true);
        const bitcoinBlock = await bitcoin_second_client_1.default.getBlock(bitcoinTx.blockhash);
        const prevout = bitcoinTx.vout[input.vout || 0];
        const outputAddress = prevout.scriptPubKey.address || (prevout.scriptPubKey.addresses && prevout.scriptPubKey.addresses[0]) || '';
        const timelock = await this.$resolvePegInTimelock(input, outputAddress);
        await this.$savePegToDatabase(block.height, block.time, prevout.value * 100000000, txid, vindex, outputAddress, bitcoinTx.txid, prevout.n, bitcoinBlock.height, bitcoinBlock.time, 1, timelock);
    }
    /** @asyncUnsafe */
    async $parseOutputs(tx, block) {
        for (const output of tx.vout) {
            if (output.scriptPubKey.pegout_chain) {
                await this.$savePegToDatabase(block.height, block.time, 0 - output.value * 100000000, tx.txid, output.n, (output.scriptPubKey.pegout_address || ''), '', 0, 0, 0, 0);
            }
            if (!output.scriptPubKey.pegout_chain && output.scriptPubKey.type === 'nulldata'
                && output.value && output.value > 0 && output.asset && output.asset === common_1.Common.nativeAssetId) {
                await this.$savePegToDatabase(block.height, block.time, 0 - output.value * 100000000, tx.txid, output.n, (output.scriptPubKey.pegout_address || ''), '', 0, 0, 0, 1);
            }
        }
    }
    /** @asyncUnsafe */
    async $savePegToDatabase(height, blockTime, amount, txid, txindex, bitcoinaddress, bitcointxid, bitcoinindex, bitcoinblock, bitcoinBlockTime, final_tx, pegInTimelock = FEDERATION_TIMELOCK_FALLBACK) {
        const query = `INSERT IGNORE INTO elements_pegs(
        block, datetime, amount, txid, txindex, bitcoinaddress, bitcointxid, bitcoinindex, final_tx
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            height, blockTime, amount, txid, txindex, bitcoinaddress, bitcointxid, bitcoinindex, final_tx
        ];
        await database_1.default.query(query, params);
        logger_1.default.debug(`Saved L-BTC peg from Liquid block height #${height} with TXID ${txid}.`);
        if (amount > 0) { // Peg-in
            // Add the UTXO to the federation txos table
            const query_utxos = `INSERT IGNORE INTO federation_txos (txid, txindex, bitcoinaddress, amount, blocknumber, blocktime, unspent, lastblockupdate, lasttimeupdate, timelock, expiredAt, emergencyKey, pegtxid, pegindex, pegblocktime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params_utxos = [bitcointxid, bitcoinindex, bitcoinaddress, amount, bitcoinblock, bitcoinBlockTime, 1, bitcoinblock - 1, 0, pegInTimelock, 0, 0, txid, txindex, blockTime];
            await database_1.default.query(query_utxos, params_utxos);
            const [minBlockUpdate] = await database_1.default.query(`SELECT MIN(lastblockupdate) AS lastblockupdate FROM federation_txos WHERE unspent = 1`);
            await this.$saveLastBlockAuditToDatabase(minBlockUpdate[0]['lastblockupdate']);
            logger_1.default.debug(`Saved new Federation UTXO ${bitcointxid}:${bitcoinindex} belonging to ${bitcoinaddress} to federation txos`);
        }
    }
    /** @asyncUnsafe */
    async $getFederationPegScripts() {
        if (this.federationPegScripts.length === 0) {
            const [rows] = await database_1.default.query(`SELECT fedpegscript, address, timelock, blocknumber FROM federation_peg_scripts ORDER BY blocknumber DESC`);
            this.federationPegScripts = rows;
        }
        return this.federationPegScripts;
    }
    /** @asyncUnsafe */
    async $updateFederationPegScripts(block) {
        const height = block.height;
        if (height < DYNAFED_ACTIVATION_HEIGHT || height % DYNAFED_CHECK_INTERVAL !== 0) {
            return;
        }
        const fedpegscript = block.dynamic_parameters?.current?.fedpegscript;
        const fedpegProgram = block.dynamic_parameters?.current?.fedpeg_program;
        if (!fedpegscript || !fedpegProgram) {
            logger_1.default.err(`Missing fedpeg fields at height ${height}, skipping dynamic federation address update.`);
            return;
        }
        if ((await this.$getFederationPegScripts()).some(entry => entry.fedpegscript === fedpegscript)) {
            logger_1.default.debug(`Fedpegscript at height ${height} is already known, skipping.`);
            return;
        }
        logger_1.default.debug(`New fedpegscript found at height ${height}, deriving federation address.`);
        let address;
        try {
            address = bitcoinjs.address.fromOutputScript(Buffer.from(fedpegProgram, 'hex'), bitcoinjs.networks.bitcoin);
        }
        catch (e) {
            logger_1.default.err(`Unable to derive federation address from fedpeg program at height ${height}: ${e instanceof Error ? e.message : 'Error'}`);
            return;
        }
        let timelock = this.extractTimelockFromFedpegscript(fedpegscript);
        if (timelock === null) {
            timelock = FEDERATION_TIMELOCK_FALLBACK;
            logger_1.default.err(`Unable to extract federation address timelock from fedpegscript at height ${height}, using fallback timelock ${FEDERATION_TIMELOCK_FALLBACK}.`);
        }
        this.federationPegScripts.unshift({ fedpegscript, address, timelock, blocknumber: height });
        logger_1.default.debug(`Derived new federation address ${address} with timelock ${timelock} from fedpegscript at height ${height}. Adding to database.`);
        try {
            await database_1.default.query(`INSERT INTO federation_peg_scripts (fedpegscript, address, timelock, blocknumber) VALUES (?, ?, ?, ?)`, [fedpegscript, address, timelock, height]);
            logger_1.default.debug(`Added new federation address ${address} to the database.`);
        }
        catch (e) {
            logger_1.default.err(`Error while inserting new federation address ${address} into the database: ${e instanceof Error ? e.message : 'Error'}`);
        }
    }
    extractTimelockFromFedpegscript(fedpegscript) {
        const chunks = bitcoinjs.script.decompile(Buffer.from(fedpegscript, 'hex'));
        if (!chunks) {
            return null;
        }
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i] !== bitcoinjs.opcodes.OP_CHECKSEQUENCEVERIFY) {
                continue;
            }
            const previous = chunks[i - 1];
            if (previous === undefined) {
                return null;
            }
            if (Buffer.isBuffer(previous)) {
                try {
                    return bitcoinjs.script.number.decode(previous, 5, true);
                }
                catch (e) {
                    return null;
                }
            }
            if (typeof previous === 'number') {
                if (previous === bitcoinjs.opcodes.OP_0) {
                    return 0;
                }
                if (previous >= bitcoinjs.opcodes.OP_1 && previous <= bitcoinjs.opcodes.OP_16) {
                    return previous - bitcoinjs.opcodes.OP_1 + 1;
                }
            }
            return null;
        }
        return null;
    }
    /** @asyncUnsafe */
    async $resolvePegInTimelock(input, bitcoinaddress) {
        const claimScript = input.pegin_witness?.[3];
        if (!claimScript) {
            logger_1.default.err(`Missing claim_script for peg-in input to address ${bitcoinaddress}, using fallback timelock ${FEDERATION_TIMELOCK_FALLBACK}.`);
            return FEDERATION_TIMELOCK_FALLBACK;
        }
        // Check claim script against each fedpegscript most recent first
        for (const pegScript of (await this.$getFederationPegScripts())) {
            try {
                const tweakResult = await bitcoin_client_1.default.tweakFedPegScript(claimScript, pegScript.fedpegscript);
                const matches = tweakResult?.p2wsh === bitcoinaddress || tweakResult?.p2shwsh === bitcoinaddress;
                if (matches) {
                    return pegScript.timelock;
                }
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                logger_1.default.err(`tweakfedpegscript failed for address ${bitcoinaddress}: ${message}`);
            }
        }
        logger_1.default.err(`No matching fedpegscript found for address ${bitcoinaddress}, using fallback timelock ${FEDERATION_TIMELOCK_FALLBACK}.`);
        return FEDERATION_TIMELOCK_FALLBACK;
    }
    /** @asyncUnsafe */
    async $getLatestBlockHeightFromDatabase() {
        const query = `SELECT number FROM state WHERE name = 'last_elements_block'`;
        const [rows] = await database_1.default.query(query);
        return rows[0]['number'];
    }
    /** @asyncUnsafe */
    async $saveLatestBlockToDatabase(blockHeight) {
        const query = `UPDATE state SET number = ? WHERE name = 'last_elements_block'`;
        await database_1.default.query(query, [blockHeight]);
    }
    ///////////// FEDERATION AUDIT //////////////
    async $updateFederationUtxos(stopAt) {
        try {
            let auditProgress = await this.$getAuditProgress();
            // If no peg in transaction was found in the database, return
            if (!auditProgress.lastBlockAudit) {
                logger_1.default.debug(`No Federation UTXOs found in the database. Waiting for some to be confirmed before starting the Federation UTXOs audit`);
                return;
            }
            const bitcoinBlocksToSync = await this.$getBitcoinBlockchainState();
            // If the bitcoin blockchain is not synced yet, return
            if (bitcoinBlocksToSync.bitcoinHeaders > bitcoinBlocksToSync.bitcoinBlocks + 1) {
                logger_1.default.debug(`Bitcoin client is not synced yet. ${bitcoinBlocksToSync.bitcoinHeaders - bitcoinBlocksToSync.bitcoinBlocks} blocks remaining to sync before the Federation audit process can start`);
                return;
            }
            auditProgress.lastBlockAudit++;
            // Logging
            let indexedThisRun = 0;
            let timer = Date.now() / 1000;
            const startedAt = Date.now() / 1000;
            const indexingSpeeds = [];
            while (auditProgress.lastBlockAudit <= auditProgress.confirmedTip) {
                // First, get the current UTXOs that need to be scanned in the block
                const utxos = await this.$getFederationUtxosToScan(auditProgress.lastBlockAudit);
                // Get the peg-out addresses that need to be scanned
                const redeemAddresses = await this.$getRedeemAddressesToScan();
                const redeemAddressesByAddress = new Map();
                for (const redeemAddress of redeemAddresses) {
                    const entries = redeemAddressesByAddress.get(redeemAddress.bitcoinaddress);
                    if (entries) {
                        entries.push(redeemAddress);
                    }
                    else {
                        redeemAddressesByAddress.set(redeemAddress.bitcoinaddress, [redeemAddress]);
                    }
                }
                // The fast way: check if these UTXOs are still unspent as of the current block with gettxout
                let spentAsTip;
                let unspentAsTip;
                if (auditProgress.confirmedTip - auditProgress.lastBlockAudit <= 150) { // If the audit status is not too far in the past, we can use gettxout (fast way)
                    const utxosToParse = await this.$getFederationUtxosToParse(utxos);
                    spentAsTip = utxosToParse.spentAsTip;
                    unspentAsTip = utxosToParse.unspentAsTip;
                    logger_1.default.debug(`Found ${utxos.length} Federation UTXOs and ${redeemAddresses.length} Peg-Out Addresses to scan in Bitcoin block height #${auditProgress.lastBlockAudit} / #${auditProgress.confirmedTip}`);
                    logger_1.default.debug(`${unspentAsTip.size} / ${utxos.length} Federation UTXOs are unspent as of tip`);
                }
                else { // If the audit status is too far in the past, it is useless and wasteful to look for still unspent txos since they will all be spent as of the tip
                    spentAsTip = new Map(utxos.map(utxo => [`${utxo.txid}:${utxo.txindex}`, utxo]));
                    unspentAsTip = new Map();
                    // Logging
                    const elapsedSeconds = (Date.now() / 1000) - timer;
                    if (elapsedSeconds > 5) {
                        const runningFor = (Date.now() / 1000) - startedAt;
                        const blockPerSeconds = indexedThisRun / elapsedSeconds;
                        indexingSpeeds.push(blockPerSeconds);
                        if (indexingSpeeds.length > 100) {
                            indexingSpeeds.shift();
                        } // Keep the length of the up to 100 last indexing speeds
                        const meanIndexingSpeed = indexingSpeeds.reduce((a, b) => a + b, 0) / indexingSpeeds.length;
                        const eta = (auditProgress.confirmedTip - auditProgress.lastBlockAudit) / meanIndexingSpeed;
                        logger_1.default.debug(`Scanning ${utxos.length} Federation UTXOs and ${redeemAddresses.length} Peg-Out Addresses at Bitcoin block height #${auditProgress.lastBlockAudit} / #${auditProgress.confirmedTip} | ~${meanIndexingSpeed.toFixed(2)} blocks/sec | elapsed: ${(runningFor / 60).toFixed(0)} minutes | ETA: ${(eta / 60).toFixed(0)} minutes`);
                        timer = Date.now() / 1000;
                        indexedThisRun = 0;
                    }
                }
                // The slow way: parse the block to look for the spending tx
                const blockHash = await bitcoin_second_client_1.default.getBlockHash(auditProgress.lastBlockAudit);
                const block = await bitcoin_second_client_1.default.getBlock(blockHash, 2);
                await this.$parseBitcoinBlock(block, spentAsTip, unspentAsTip, auditProgress.confirmedTip, redeemAddressesByAddress);
                // Finally, update the lastblockupdate of the remaining UTXOs and save to the database
                const [minBlockUpdate] = await database_1.default.query(`SELECT MIN(lastblockupdate) AS lastblockupdate FROM federation_txos WHERE unspent = 1`);
                await this.$saveLastBlockAuditToDatabase(minBlockUpdate[0]['lastblockupdate']);
                auditProgress = await this.$getAuditProgress();
                auditProgress.lastBlockAudit++;
                indexedThisRun++;
                if ((Date.now() / 1000) >= stopAt) {
                    logger_1.default.debug(`Reached max federation audit runtime, pausing audit to let Liquid parsing run and resuming later`);
                    break;
                }
            }
        }
        catch (e) {
            throw new Error(e instanceof Error ? e.message : 'Error');
        }
    }
    // Get the UTXOs that need to be scanned in block height (UTXOs that were last updated in the block height - 1)
    /** @asyncUnsafe */
    async $getFederationUtxosToScan(height) {
        const query = `SELECT txid, txindex, bitcoinaddress, amount, blocknumber, timelock, expiredAt FROM federation_txos WHERE lastblockupdate = ? AND unspent = 1`;
        const [rows] = await database_1.default.query(query, [height - 1]);
        return rows;
    }
    // Returns the UTXOs that are spent as of tip and need to be scanned
    /** @asyncUnsafe */
    async $getFederationUtxosToParse(utxos) {
        const spentAsTip = new Map();
        const unspentAsTip = new Map();
        for (const utxo of utxos) {
            const result = await bitcoin_second_client_1.default.getTxOut(utxo.txid, utxo.txindex, false);
            const key = `${utxo.txid}:${utxo.txindex}`;
            result ? unspentAsTip.set(key, utxo) : spentAsTip.set(key, utxo);
        }
        return { spentAsTip, unspentAsTip };
    }
    /** @asyncUnsafe */
    async $parseBitcoinBlock(block, spentAsTip, unspentAsTip, confirmedTip, redeemAddressesByAddress) {
        const federationTimelockByAddress = new Map((await this.$getFederationPegScripts()).map(fedAddress => [fedAddress.address, fedAddress.timelock]));
        for (const tx of block.tx) {
            let mightRedeemInThisTx = false;
            // Check if the Federation UTXOs that was spent as of tip are spent in this block
            for (const input of tx.vin) {
                const txo = spentAsTip.get(`${input.txid}:${input.vout}`);
                if (txo) {
                    mightRedeemInThisTx = true; // A Federation UTXO is spent in this tx: a peg-out redeem output may be present
                    if (txo.expiredAt > 0) {
                        if (input.txinwitness?.length !== 13) { // Check if the witness data of the input contains the 11 signatures: if it doesn't, emergency keys are being used
                            await database_1.default.query(`UPDATE federation_txos SET unspent = 0, lastblockupdate = ?, lasttimeupdate = ?, emergencyKey = 1 WHERE txid = ? AND txindex = ?`, [block.height, block.time, txo.txid, txo.txindex]);
                            logger_1.default.debug(`Expired Federation UTXO ${txo.txid}:${txo.txindex} (${txo.amount} sats) was spent in block ${block.height} using emergency keys!`);
                        }
                        else {
                            await database_1.default.query(`UPDATE federation_txos SET unspent = 0, lastblockupdate = ?, lasttimeupdate = ? WHERE txid = ? AND txindex = ?`, [block.height, block.time, txo.txid, txo.txindex]);
                            logger_1.default.debug(`Expired Federation UTXO ${txo.txid}:${txo.txindex} (${txo.amount} sats) was spent in block ${block.height} using regular 11-of-15 signatures`);
                        }
                    }
                    else {
                        await database_1.default.query(`UPDATE federation_txos SET unspent = 0, lastblockupdate = ?, lasttimeupdate = ? WHERE txid = ? AND txindex = ?`, [block.height, block.time, txo.txid, txo.txindex]);
                        logger_1.default.debug(`Federation UTXO ${txo.txid}:${txo.txindex} (${txo.amount} sats) was spent in block ${block.height}`);
                    }
                    // Remove the TXO from the map
                    spentAsTip.delete(`${txo.txid}:${txo.txindex}`);
                }
            }
            // Check if an output is sent to a change address of the federation
            for (const output of tx.vout) {
                if (output.scriptPubKey.address) {
                    const timelock = federationTimelockByAddress.get(output.scriptPubKey.address);
                    if (timelock !== undefined) {
                        // Check that the UTXO was not already added in the DB by previous scans
                        const [rows_check] = await database_1.default.query(`SELECT txid FROM federation_txos WHERE txid = ? AND txindex = ?`, [tx.txid, output.n]);
                        if (rows_check.length === 0) {
                            const query_utxos = `INSERT INTO federation_txos (txid, txindex, bitcoinaddress, amount, blocknumber, blocktime, unspent, lastblockupdate, lasttimeupdate, timelock, expiredAt, emergencyKey, pegtxid, pegindex, pegblocktime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                            const params_utxos = [tx.txid, output.n, output.scriptPubKey.address, output.value * 100000000, block.height, block.time, 1, block.height, 0, timelock, 0, 0, '', 0, 0];
                            await database_1.default.query(query_utxos, params_utxos);
                            // Add the UTXO to the map
                            spentAsTip.set(`${tx.txid}:${output.n}`, {
                                txid: tx.txid,
                                txindex: output.n,
                                bitcoinaddress: output.scriptPubKey.address,
                                amount: output.value * 100000000,
                                blocknumber: block.height,
                                timelock: timelock,
                                expiredAt: 0,
                            });
                            logger_1.default.debug(`Added new Federation UTXO ${tx.txid}:${output.n} (${Math.round(output.value * 100000000)} sats), change address: ${output.scriptPubKey.address}`);
                        }
                    }
                    if (!mightRedeemInThisTx) {
                        continue;
                    }
                    const redeemCandidates = redeemAddressesByAddress.get(output.scriptPubKey.address);
                    if (!redeemCandidates) {
                        continue;
                    }
                    // Find the number of times output.scriptPubKey.address appears in the candidates. There can be address reuse for peg-outs...
                    const matchingAddress = redeemCandidates.filter(redeemAddress => -redeemAddress.amount === Math.round(output.value * 100000000));
                    if (matchingAddress.length > 0) {
                        if (matchingAddress.length > 1) {
                            // If there are more than one peg out address with the same amount, we can't know which one redeemed the UTXO: we take the oldest one
                            matchingAddress.sort((a, b) => a.datetime - b.datetime);
                            logger_1.default.debug(`Found redeem txid ${tx.txid}:${output.n} to peg-out address ${matchingAddress[0].bitcoinaddress}, amount ${matchingAddress[0].amount}, datetime ${matchingAddress[0].datetime}`);
                        }
                        else {
                            logger_1.default.debug(`Found redeem txid ${tx.txid}:${output.n} to peg-out address ${matchingAddress[0].bitcoinaddress}, amount ${matchingAddress[0].amount}`);
                        }
                        const query_add_redeem = `UPDATE elements_pegs SET bitcointxid = ?, bitcoinindex = ? WHERE bitcoinaddress = ? AND amount = ? AND datetime = ?`;
                        const params_add_redeem = [tx.txid, output.n, matchingAddress[0].bitcoinaddress, matchingAddress[0].amount, matchingAddress[0].datetime];
                        await database_1.default.query(query_add_redeem, params_add_redeem);
                        const index = redeemCandidates.indexOf(matchingAddress[0]);
                        if (index !== -1) {
                            redeemCandidates.splice(index, 1);
                            if (redeemCandidates.length === 0) {
                                redeemAddressesByAddress.delete(output.scriptPubKey.address);
                            }
                        }
                    }
                    else { // The output amount does not match the peg-out amount... log it
                        logger_1.default.debug(`Found redeem txid ${tx.txid}:${output.n} to peg-out address ${output.scriptPubKey.address} but output amount ${Math.round(output.value * 100000000)} does not match the peg-out amount!`);
                    }
                }
            }
        }
        for (const utxo of spentAsTip.values()) {
            if (utxo.expiredAt === 0 && block.height >= utxo.blocknumber + utxo.timelock) { // The UTXO is expiring in this block
                await database_1.default.query(`UPDATE federation_txos SET lastblockupdate = ?, expiredAt = ? WHERE txid = ? AND txindex = ?`, [block.height, block.time, utxo.txid, utxo.txindex]);
            }
            else {
                await database_1.default.query(`UPDATE federation_txos SET lastblockupdate = ? WHERE txid = ? AND txindex = ?`, [block.height, utxo.txid, utxo.txindex]);
            }
        }
        for (const utxo of unspentAsTip.values()) {
            if (utxo.expiredAt === 0 && block.height >= utxo.blocknumber + utxo.timelock) { // The UTXO is expiring in this block
                await database_1.default.query(`UPDATE federation_txos SET lastblockupdate = ?, expiredAt = ? WHERE txid = ? AND txindex = ?`, [confirmedTip, block.time, utxo.txid, utxo.txindex]);
            }
            else if (utxo.expiredAt === 0 && confirmedTip >= utxo.blocknumber + utxo.timelock) { // The UTXO is expiring before the tip: we need to keep track of it
                await database_1.default.query(`UPDATE federation_txos SET lastblockupdate = ? WHERE txid = ? AND txindex = ?`, [utxo.blocknumber + utxo.timelock - 1, utxo.txid, utxo.txindex]);
            }
            else {
                await database_1.default.query(`UPDATE federation_txos SET lastblockupdate = ? WHERE txid = ? AND txindex = ?`, [confirmedTip, utxo.txid, utxo.txindex]);
            }
        }
    }
    /** @asyncUnsafe */
    async $saveLastBlockAuditToDatabase(blockHeight) {
        const query = `UPDATE state SET number = ? WHERE name = 'last_bitcoin_block_audit'`;
        await database_1.default.query(query, [blockHeight]);
    }
    // Get the bitcoin block where the audit process was last updated
    /** @asyncUnsafe */
    async $getAuditProgress() {
        const lastblockaudit = await this.$getLastBlockAudit();
        const bitcoinBlocksToSync = await this.$getBitcoinBlockchainState();
        return {
            lastBlockAudit: lastblockaudit,
            confirmedTip: bitcoinBlocksToSync.bitcoinBlocks - auditBlockOffsetWithTip,
        };
    }
    // Get the bitcoin blocks remaining to be synced
    /** @asyncUnsafe */
    async $getBitcoinBlockchainState() {
        const result = await bitcoin_second_client_1.default.getBlockchainInfo();
        return {
            bitcoinBlocks: result.blocks,
            bitcoinHeaders: result.headers,
        };
    }
    /** @asyncUnsafe */
    async $getLastBlockAudit() {
        const query = `SELECT number FROM state WHERE name = 'last_bitcoin_block_audit'`;
        const [rows] = await database_1.default.query(query);
        return rows[0]['number'];
    }
    /** @asyncUnsafe */
    async $getRedeemAddressesToScan() {
        const query = `SELECT datetime, amount, bitcoinaddress FROM elements_pegs where amount < 0 AND bitcoinaddress != '' AND bitcointxid = '';`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    isDust(amount, feeRate) {
        return amount <= (450 * feeRate); // A P2WSH 11-of-15 multisig input is around 450 bytes
    }
    ///////////// DATA QUERY //////////////
    /** @asyncUnsafe */
    async $getAuditStatus() {
        const lastBlockAudit = await this.$getLastBlockAudit();
        const bitcoinBlocksToSync = await this.$getBitcoinBlockchainState();
        return {
            bitcoinBlocks: bitcoinBlocksToSync.bitcoinBlocks,
            bitcoinHeaders: bitcoinBlocksToSync.bitcoinHeaders,
            lastBlockAudit: lastBlockAudit,
            isAuditSynced: bitcoinBlocksToSync.bitcoinHeaders - bitcoinBlocksToSync.bitcoinBlocks <= 3 && bitcoinBlocksToSync.bitcoinBlocks - lastBlockAudit <= auditSyncToleranceBlocks,
        };
    }
    /** @asyncUnsafe */
    async $getPegDataByMonth() {
        const query = `SELECT SUM(amount) AS amount, DATE_FORMAT(FROM_UNIXTIME(datetime), '%Y-%m-01') AS date FROM elements_pegs GROUP BY DATE_FORMAT(FROM_UNIXTIME(datetime), '%Y%m')`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    /** @asyncUnsafe */
    async $getFederationReservesByMonth() {
        const query = `
    SELECT SUM(amount) AS amount, DATE_FORMAT(FROM_UNIXTIME(blocktime), '%Y-%m-01') AS date FROM federation_txos 
    WHERE
        (blocktime > UNIX_TIMESTAMP(LAST_DAY(FROM_UNIXTIME(blocktime) - INTERVAL 1 MONTH) + INTERVAL 1 DAY))
      AND 
        ((unspent = 1) OR (unspent = 0 AND lasttimeupdate > UNIX_TIMESTAMP(LAST_DAY(FROM_UNIXTIME(blocktime)) + INTERVAL 1 DAY)))
      AND 
        (expiredAt = 0 OR expiredAt > UNIX_TIMESTAMP(LAST_DAY(FROM_UNIXTIME(blocktime)) + INTERVAL 1 DAY))
    GROUP BY 
        date;`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    // Get the current L-BTC pegs and the last Liquid block it was updated
    /** @asyncUnsafe */
    async $getCurrentLbtcSupply() {
        const [rows] = await database_1.default.query(`SELECT SUM(amount) AS LBTC_supply FROM elements_pegs;`);
        const lastblockupdate = await this.$getLatestBlockHeightFromDatabase();
        const hash = await bitcoin_client_1.default.getBlockHash(lastblockupdate);
        return {
            amount: rows[0]['LBTC_supply'],
            lastBlockUpdate: lastblockupdate,
            hash: hash
        };
    }
    // Get the current reserves of the federation and the last Bitcoin block it was updated
    /** @asyncUnsafe */
    async $getCurrentFederationReserves() {
        const [rows] = await database_1.default.query(`SELECT SUM(amount) AS total_balance FROM federation_txos WHERE unspent = 1 AND expiredAt = 0;`);
        const lastblockaudit = await this.$getLastBlockAudit();
        const hash = await bitcoin_second_client_1.default.getBlockHash(lastblockaudit);
        return {
            amount: rows[0]['total_balance'],
            lastBlockUpdate: lastblockaudit,
            hash: hash
        };
    }
    // Get all of the federation addresses, most balances first
    /** @asyncUnsafe */
    async $getFederationAddresses() {
        const query = `SELECT bitcoinaddress, SUM(amount) AS balance FROM federation_txos WHERE unspent = 1 AND expiredAt = 0 GROUP BY bitcoinaddress ORDER BY balance DESC;`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    // Get all of the UTXOs held by the federation, most recent first
    /** @asyncUnsafe */
    async $getFederationUtxos() {
        const query = `SELECT txid, txindex, bitcoinaddress, amount, blocknumber, blocktime, pegtxid, pegindex, pegblocktime, timelock, expiredAt FROM federation_txos WHERE unspent = 1 AND expiredAt = 0 ORDER BY blocktime DESC;`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    // Get expired UTXOs, most recent first
    /** @asyncUnsafe */
    async $getExpiredUtxos() {
        const query = `SELECT txid, txindex, bitcoinaddress, amount, blocknumber, blocktime, pegtxid, pegindex, pegblocktime, timelock, expiredAt FROM federation_txos WHERE unspent = 1 AND expiredAt > 0 ORDER BY blocktime DESC;`;
        const [rows] = await database_1.default.query(query);
        const feeRate = Math.round((await bitcoin_second_client_1.default.estimateSmartFee(1)).feerate * 100000000 / 1000);
        for (const row of rows) {
            row.isDust = this.isDust(row.amount, feeRate);
        }
        return rows;
    }
    // Get utxos that were spent using emergency keys
    /** @asyncUnsafe */
    async $getEmergencySpentUtxos() {
        const query = `SELECT txid, txindex, bitcoinaddress, amount, blocknumber, blocktime, pegtxid, pegindex, pegblocktime, timelock, expiredAt FROM federation_txos WHERE emergencyKey = 1 ORDER BY blocktime DESC;`;
        const [rows] = await database_1.default.query(query);
        return rows;
    }
    // Get the total number of federation addresses
    /** @asyncUnsafe */
    async $getFederationAddressesNumber() {
        const query = `SELECT COUNT(DISTINCT bitcoinaddress) AS address_count FROM federation_txos WHERE unspent = 1 AND expiredAt = 0;`;
        const [rows] = await database_1.default.query(query);
        return rows[0];
    }
    // Get the total number of federation utxos
    /** @asyncUnsafe */
    async $getFederationUtxosNumber() {
        const query = `SELECT COUNT(*) AS utxo_count FROM federation_txos WHERE unspent = 1 AND expiredAt = 0;`;
        const [rows] = await database_1.default.query(query);
        return rows[0];
    }
    // Get the total number of emergency spent utxos and their total amount
    /** @asyncUnsafe */
    async $getEmergencySpentUtxosStats() {
        const query = `SELECT COUNT(*) AS utxo_count, SUM(amount) AS total_amount FROM federation_txos WHERE emergencyKey = 1;`;
        const [rows] = await database_1.default.query(query);
        return rows[0];
    }
    // Get recent pegs in / out
    /** @asyncUnsafe */
    async $getPegsList(count = 0) {
        const query = `SELECT txid, txindex, amount, bitcoinaddress, bitcointxid, bitcoinindex, datetime AS blocktime FROM elements_pegs ORDER BY block DESC LIMIT 15 OFFSET ?;`;
        const [rows] = await database_1.default.query(query, [count]);
        return rows;
    }
    // Get all peg in / out from the last month
    /** @asyncUnsafe */
    async $getPegsVolumeDaily() {
        const pegInQuery = await database_1.default.query(`SELECT SUM(amount) AS volume, COUNT(*) AS number FROM elements_pegs WHERE amount > 0 and datetime > UNIX_TIMESTAMP(TIMESTAMPADD(DAY, -1, CURRENT_TIMESTAMP()));`);
        const pegOutQuery = await database_1.default.query(`SELECT SUM(amount) AS volume, COUNT(*) AS number FROM elements_pegs WHERE amount < 0 and datetime > UNIX_TIMESTAMP(TIMESTAMPADD(DAY, -1, CURRENT_TIMESTAMP()));`);
        return [
            pegInQuery[0][0],
            pegOutQuery[0][0]
        ];
    }
    // Get the total pegs number
    /** @asyncUnsafe */
    async $getPegsCount() {
        const [rows] = await database_1.default.query(`SELECT COUNT(*) AS pegs_count FROM elements_pegs;`);
        return rows[0];
    }
}
exports.default = new ElementsParser();
