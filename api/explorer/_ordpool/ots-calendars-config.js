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
exports.getOtsCalendarHosts = exports.getOtsCalendars = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../../../logger"));
const FALLBACK_CALENDARS = Object.freeze([
    Object.freeze({ nickname: 'alice', url: 'https://alice.btc.calendar.opentimestamps.org' }),
    Object.freeze({ nickname: 'bob', url: 'https://bob.btc.calendar.opentimestamps.org' }),
    Object.freeze({ nickname: 'finney', url: 'https://finney.calendar.eternitywall.com' }),
    Object.freeze({
        nickname: 'catallaxy',
        url: 'https://ots.btc.catallaxy.com',
        upgradeUrl: 'https://btc.calendar.catallaxy.com',
    }),
]);
let cached = null;
let cachedHosts = null;
function load() {
    if (cached)
        return cached;
    const filePath = path.join(__dirname, 'ots-calendars.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed?.calendars || !Array.isArray(parsed.calendars) || parsed.calendars.length === 0) {
            throw new Error('ots-calendars.json: empty or malformed calendars[]');
        }
        const out = [];
        for (const entry of parsed.calendars) {
            const nickname = String(entry?.nickname || '').trim();
            const url = String(entry?.url || '').replace(/\/+$/, '');
            const upgradeUrlRaw = String(entry?.upgradeUrl || '').replace(/\/+$/, '');
            const upgradeUrl = /^https?:\/\//.test(upgradeUrlRaw) ? upgradeUrlRaw : undefined;
            if (nickname && /^https?:\/\//.test(url))
                out.push({ nickname, url, ...(upgradeUrl ? { upgradeUrl } : {}) });
        }
        if (out.length === 0)
            throw new Error('ots-calendars.json: no usable entries');
        cached = Object.freeze(out);
        return cached;
    }
    catch (e) {
        logger_1.default.warn(`OTS calendars config: ${e instanceof Error ? e.message : e}; using hardcoded fallback`);
        cached = FALLBACK_CALENDARS;
        return cached;
    }
}
/** All calendars, in declaration order (poller, backfill, frontend picker). */
function getOtsCalendars() {
    return load();
}
exports.getOtsCalendars = getOtsCalendars;
/** Hostname allowlist for the digest + upgrade proxies. Includes BOTH
 *  `url` and `upgradeUrl` hostnames so we can forward to whichever
 *  subdomain a given calendar uses for each endpoint. */
function getOtsCalendarHosts() {
    if (cachedHosts)
        return cachedHosts;
    const hosts = new Set();
    for (const c of load()) {
        try {
            hosts.add(new URL(c.url).hostname.toLowerCase());
        }
        catch { /* skip bad URI */ }
        if (c.upgradeUrl) {
            try {
                hosts.add(new URL(c.upgradeUrl).hostname.toLowerCase());
            }
            catch { /* skip bad URI */ }
        }
    }
    cachedHosts = hosts;
    return cachedHosts;
}
exports.getOtsCalendarHosts = getOtsCalendarHosts;
