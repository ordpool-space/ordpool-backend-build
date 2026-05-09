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
exports.getOtsCalendarHosts = exports.getOtsCalendarUris = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../../../logger"));
const FALLBACK_URIS = Object.freeze([
    'https://alice.btc.calendar.opentimestamps.org',
    'https://bob.btc.calendar.opentimestamps.org',
    'https://finney.calendar.eternitywall.com',
    'https://ots.btc.catallaxy.com',
]);
let cachedUris = null;
let cachedHosts = null;
function load() {
    if (cachedUris)
        return cachedUris;
    const filePath = path.join(__dirname, 'ots-calendars.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed?.calendars || !Array.isArray(parsed.calendars) || parsed.calendars.length === 0) {
            throw new Error('ots-calendars.json: empty or malformed calendars[]');
        }
        const uris = parsed.calendars
            .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
            .map(u => u.replace(/\/+$/, '')); // strip trailing slash
        if (uris.length === 0)
            throw new Error('ots-calendars.json: no usable URIs');
        cachedUris = Object.freeze(uris);
        return cachedUris;
    }
    catch (e) {
        logger_1.default.warn(`OTS calendars config: ${e instanceof Error ? e.message : e}; using hardcoded fallback`);
        cachedUris = FALLBACK_URIS;
        return cachedUris;
    }
}
function getOtsCalendarUris() {
    return load();
}
exports.getOtsCalendarUris = getOtsCalendarUris;
function getOtsCalendarHosts() {
    if (cachedHosts)
        return cachedHosts;
    const hosts = new Set();
    for (const uri of load()) {
        try {
            hosts.add(new URL(uri).hostname.toLowerCase());
        }
        catch { /* skip bad URI */ }
    }
    cachedHosts = hosts;
    return cachedHosts;
}
exports.getOtsCalendarHosts = getOtsCalendarHosts;
