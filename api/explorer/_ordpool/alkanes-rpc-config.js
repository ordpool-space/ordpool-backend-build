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
exports.getAlkanesRpcConfig = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../../../logger"));
// Both endpoints are anonymous, free, JSON-RPC 2.0. They appear to share
// upstream infra (same block-tip responses), but failing over to the second
// costs nothing and protects against per-host outages.
const FALLBACK = Object.freeze({
    urls: Object.freeze([
        'https://mainnet.subfrost.io/v4/jsonrpc',
        'https://mainnet.sandshrew.io/v2/lasereyes',
    ]),
    timeoutMs: 8_000,
    negativeCacheMs: 60 * 60 * 1000, // 1h
});
let cached = null;
function load() {
    if (cached)
        return cached;
    const filePath = path.join(__dirname, 'alkanes-rpc.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const urls = Array.isArray(parsed.urls)
            ? parsed.urls.map(u => String(u).replace(/\/+$/, '')).filter(u => /^https?:\/\//.test(u))
            : [...FALLBACK.urls];
        cached = Object.freeze({
            urls: Object.freeze(urls),
            timeoutMs: typeof parsed.timeoutMs === 'number' && parsed.timeoutMs > 0
                ? parsed.timeoutMs : FALLBACK.timeoutMs,
            negativeCacheMs: typeof parsed.negativeCacheMs === 'number' && parsed.negativeCacheMs >= 0
                ? parsed.negativeCacheMs : FALLBACK.negativeCacheMs,
        });
        return cached;
    }
    catch (e) {
        logger_1.default.warn(`Alkanes RPC config: ${e instanceof Error ? e.message : e}; using fallback`);
        cached = FALLBACK;
        return cached;
    }
}
function getAlkanesRpcConfig() {
    return load();
}
exports.getAlkanesRpcConfig = getAlkanesRpcConfig;
