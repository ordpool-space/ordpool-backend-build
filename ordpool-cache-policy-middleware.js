"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ordpoolCachePolicy = exports.findCachePolicy = void 0;
const POLICIES = [
    // Near-real-time: keep browsers nearly live, let the edge collapse crawler bursts.
    { match: (p) => p === '/api/v1/blocks/tip/height', policy: { edge: 10, browser: 5 } },
    { match: (p) => p === '/api/v1/fees/recommended', policy: { edge: 15, browser: 5 } },
    // Heavy aggregations (the crawler magnets); staleness invisible vs ~10 min blocks.
    // 120s edge matches mempool's observed max-age for pools/hashrate.
    { match: (p) => p.startsWith('/api/v1/mining/'), policy: { edge: 120, browser: 60 } },
    { match: (p) => p.startsWith('/api/v1/statistics/'), policy: { edge: 120, browser: 60 } },
    { match: (p) => p === '/api/v1/difficulty-adjustment', policy: { edge: 120, browser: 60 } },
];
/** Resolve the cache policy for a request path, or undefined if not cacheable. */
function findCachePolicy(path) {
    return POLICIES.find((entry) => entry.match(path))?.policy;
}
exports.findCachePolicy = findCachePolicy;
function ordpoolCachePolicy(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
    }
    const policy = findCachePolicy(req.path);
    if (!policy) {
        return next();
    }
    // Wrap writeHead so our header is applied at flush time, after (and overriding)
    // whatever the upstream handler set. The cast is needed because writeHead has
    // several overload signatures we don't want to reproduce; we forward args verbatim.
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = (...args) => {
        const status = (typeof args[0] === 'number' ? args[0] : res.statusCode) || 0;
        if (status >= 200 && status < 300) {
            res.setHeader('Cache-Control', `public, max-age=${policy.browser}, s-maxage=${policy.edge}`);
            // Correct for compressed variants; never Vary on Cookie (that disables edge
            // caching). Our API responses carry no Set-Cookie, so this stays safe.
            res.setHeader('Vary', 'Accept-Encoding');
            // Drop upstream's bare `Expires` + `Pragma: public`, which would otherwise
            // fight the max-age we just set.
            res.removeHeader('Expires');
            res.removeHeader('Pragma');
        }
        return originalWriteHead(...args);
    };
    next();
}
exports.ordpoolCachePolicy = ordpoolCachePolicy;
