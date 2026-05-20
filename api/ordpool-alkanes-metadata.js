"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeSimulateData = void 0;
const AlkaneMetadataRepository_1 = __importDefault(require("../repositories/AlkaneMetadataRepository"));
const alkanes_rpc_config_1 = require("./explorer/_ordpool/alkanes-rpc-config");
const SELECTOR_NAME = 99;
const SELECTOR_SYMBOL = 100;
const SELECTOR_TOTAL_SUPPLY = 101;
class AlkanesMetadataService {
    pending = new Map();
    async $getAlkaneMetadata(block, tx) {
        if (block < 0n || tx < 0n) {
            return null;
        }
        const alkaneId = `${block}:${tx}`;
        const existing = await AlkaneMetadataRepository_1.default.$getByAlkaneId(alkaneId);
        if (existing && this.isRowFresh(existing)) {
            return existing;
        }
        const inflight = this.pending.get(alkaneId);
        if (inflight) {
            return inflight;
        }
        const promise = this.$resolveAlkane(alkaneId, block, tx, existing)
            .finally(() => this.pending.delete(alkaneId));
        this.pending.set(alkaneId, promise);
        return promise;
    }
    async $resolveAlkane(alkaneId, block, tx, existing) {
        const { urls } = (0, alkanes_rpc_config_1.getAlkanesRpcConfig)();
        if (urls.length === 0) {
            return existing ?? null;
        }
        const fetched = await this.$fetchFromRpcs(block, tx);
        const fetchedAt = new Date();
        const row = {
            alkaneId,
            name: fetched.name,
            symbol: fetched.symbol,
            totalSupply: fetched.totalSupply,
            lastError: fetched.error ?? null,
            fetchAttempts: (existing?.fetchAttempts ?? 0) + 1,
            fetchedAt,
        };
        await AlkaneMetadataRepository_1.default.$upsert(row);
        return row;
    }
    isRowFresh(row) {
        // Resolved rows are immutable: name/symbol never change on-chain.
        if (row.name !== null) {
            return true;
        }
        const { negativeCacheMs } = (0, alkanes_rpc_config_1.getAlkanesRpcConfig)();
        return Date.now() - row.fetchedAt.getTime() < negativeCacheMs;
    }
    async $fetchFromRpcs(block, tx) {
        const { urls } = (0, alkanes_rpc_config_1.getAlkanesRpcConfig)();
        const errors = [];
        for (const url of urls) {
            try {
                const [name, symbol, totalSupply] = await Promise.all([
                    this.$callSimulate(url, block, tx, SELECTOR_NAME),
                    this.$callSimulate(url, block, tx, SELECTOR_SYMBOL),
                    this.$callSimulate(url, block, tx, SELECTOR_TOTAL_SUPPLY),
                ]);
                if (typeof name === 'string' && name.length > 0) {
                    return {
                        name,
                        symbol: typeof symbol === 'string' && symbol.length > 0 ? symbol : null,
                        totalSupply: typeof totalSupply === 'bigint' ? totalSupply.toString() : null,
                    };
                }
                errors.push(`${url}: no name returned`);
            }
            catch (e) {
                errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return {
            name: null,
            symbol: null,
            totalSupply: null,
            error: errors.join(' | ').slice(0, 250),
        };
    }
    async $callSimulate(url, block, tx, selector) {
        const { timeoutMs } = (0, alkanes_rpc_config_1.getAlkanesRpcConfig)();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctrl.signal,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: selector,
                    method: 'alkanes_simulate',
                    params: [{
                            target: { block: block.toString(), tx: tx.toString() },
                            alkanes: [],
                            transaction: '0x',
                            block: '0x',
                            height: '20000',
                            txindex: 0,
                            inputs: [selector.toString()],
                            pointer: 0,
                            refundPointer: 0,
                            vout: 0,
                        }],
                }),
            });
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const json = await resp.json();
            if (json.error) {
                throw new Error(`rpc: ${json.error.message ?? 'unknown'}`);
            }
            const data = json.result?.execution?.data;
            if (typeof data !== 'string' || !data.startsWith('0x')) {
                return null;
            }
            return decodeSimulateData(data, selector);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
function decodeSimulateData(hex, selector) {
    if (hex === '0x' || hex.length < 4) {
        return null;
    }
    const body = hex.slice(2);
    if (selector === SELECTOR_NAME || selector === SELECTOR_SYMBOL) {
        let chars = '';
        for (let i = 0; i < body.length; i += 2) {
            const byte = parseInt(body.substr(i, 2), 16);
            if (byte === 0)
                break;
            if (byte < 0x20 || byte > 0x7e)
                return null;
            chars += String.fromCharCode(byte);
        }
        return chars.length > 0 ? chars : null;
    }
    let value = 0n;
    for (let i = body.length - 2; i >= 0; i -= 2) {
        value = (value << 8n) | BigInt(parseInt(body.substr(i, 2), 16));
    }
    return value;
}
exports.decodeSimulateData = decodeSimulateData;
exports.default = new AlkanesMetadataService();
