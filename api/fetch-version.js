"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const { spawnSync } = require('child_process');
function getVersion() {
    const packageJson = fs_1.default.readFileSync('package.json').toString();
    return JSON.parse(packageJson).version;
}
function getGitCommit() {
    if (process.env.MEMPOOL_COMMIT_HASH) {
        return process.env.MEMPOOL_COMMIT_HASH;
    }
    else {
        const gitRevParse = spawnSync('git', ['rev-parse', '--short', 'HEAD']);
        if (!gitRevParse.error) {
            const output = gitRevParse.stdout.toString('utf-8').replace(/[\n\r\s]+$/, '');
            if (output) {
                return output;
            }
            else {
                console.log('Could not fetch git commit: No repo available');
            }
        }
        else if (gitRevParse.error.code === 'ENOENT') {
            console.log('Could not fetch git commit: Command `git` is unavailable');
        }
    }
    return '?';
}
const versionInfo = {
    version: getVersion(),
    gitCommit: getGitCommit()
};
fs_1.default.writeFileSync(path_1.default.join(__dirname, 'version.json'), JSON.stringify(versionInfo, null, 2) + '\n');
