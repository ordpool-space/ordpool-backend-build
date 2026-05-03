"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const config_1 = __importDefault(require("../config"));
const bitcoin_client_1 = __importDefault(require("./bitcoin/bitcoin-client"));
const logger_1 = __importDefault(require("../logger"));
class BackendInfo {
    backendInfo;
    timer;
    constructor() {
        // This file is created by ./fetch-version.ts during building
        const versionFile = path_1.default.join(__dirname, 'version.json');
        let versionInfo;
        if (fs_1.default.existsSync(versionFile)) {
            versionInfo = JSON.parse(fs_1.default.readFileSync(versionFile).toString());
        }
        else {
            // Use dummy values if `versionFile` doesn't exist (e.g., during testing)
            versionInfo = {
                version: '?',
                gitCommit: '?'
            };
        }
        this.backendInfo = {
            hostname: os_1.default.hostname(),
            version: versionInfo.version,
            gitCommit: versionInfo.gitCommit,
            lightning: config_1.default.LIGHTNING.ENABLED,
            backend: config_1.default.MEMPOOL.BACKEND,
            coreVersion: '?',
            osVersion: `${os_1.default.type()} ${os_1.default.release()}`,
        };
        this.timer = setInterval(async () => {
            try {
                await this.$updateCoreVersion();
            }
            catch (e) {
                logger_1.default.err(`Exception in $updateCoreVersion. Reason: ${(e instanceof Error ? e.message : e)}`);
            }
        }, 10 * 60 * 1000); // every 10 minutes
        void this.$updateCoreVersion(); // starting immediately
    }
    /** @asyncSafe */
    async $updateCoreVersion() {
        try {
            const networkInfo = await bitcoin_client_1.default.getNetworkInfo();
            this.backendInfo.coreVersion = networkInfo.subversion;
        }
        catch (e) {
            logger_1.default.err(`Exception in $updateCoreVersion. Reason: ${(e instanceof Error ? e.message : e)}`);
        }
    }
    getBackendInfo() {
        return this.backendInfo;
    }
    getShortCommitHash() {
        return this.backendInfo.gitCommit.slice(0, 7);
    }
}
exports.default = new BackendInfo();
