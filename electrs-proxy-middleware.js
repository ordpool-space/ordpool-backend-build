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
exports.createElectrsProxyMiddleware = void 0;
const http = __importStar(require("http"));
const logger_1 = __importDefault(require("./logger"));
const ordpool_ots_flag_1 = require("./api/ordpool-ots-flag");
// HACK --- Ordpool: cheap nginx replacement.
// Mempool's upstream production runs nginx in front of backend + electrs to path-route
// /api/v1/* → backend and /api/* → electrs (with the /api prefix stripped). We don't
// run nginx — the Cloudflare Tunnel forwards everything to this Node process. So we do
// the same path-rewriting in Express here, before any other route is matched.
//
// Mounted under '/api' in index.ts, so req.path arrives without that prefix
// (e.g. GET /api/v1/blocks → req.path === '/v1/blocks'). /v1/* falls through to
// upstream's normal routing; everything else streams to electrs.
//
// For our traffic (a few hundred req/s peak, mostly bots) the ~200µs Node proxy
// overhead vs. nginx's ~50µs is invisible relative to electrs's 10-100ms response time.
// If we ever scale to where the proxy itself becomes the bottleneck, this gets replaced
// by nginx in front of cloudflared and these lines deleted.
//
// HACK -- Ordpool: when `MEMPOOL.BACKEND === 'esplora'` (prod), upstream's
// `bitcoin.routes.ts:75-80` gates off `getTransaction`, so `/api/tx/<txid>`
// is served by this proxy. We intercept GET /tx/<64-hex> here, buffer the
// JSON body, and inject the tristate `isOtsCommit` field via
// `attachIsOtsCommit` so the frontend's OtsKnowledgeService can skip the
// lazy probe on the strip wire. Everything else streams through untouched.
// See ORDPOOL-FLAGS-ARCHITECTURE.md §4.
const TX_DETAIL_PATH = /^\/tx\/[0-9a-f]{64}$/i;
function createElectrsProxyMiddleware(electrsBaseUrl) {
    const electrsHost = new URL(electrsBaseUrl || 'http://127.0.0.1:3000');
    const port = electrsHost.port || '80';
    const hostHeader = `${electrsHost.hostname}:${port}`;
    return (req, res, next) => {
        if (req.path === '/v1' || req.path.startsWith('/v1/')) {
            return next();
        }
        const injectOtsCommit = req.method === 'GET' && TX_DETAIL_PATH.test(req.path);
        const proxyReq = http.request({
            host: electrsHost.hostname,
            port: Number(port),
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: hostHeader },
        }, (electrsRes) => {
            if (!injectOtsCommit) {
                res.writeHead(electrsRes.statusCode || 502, electrsRes.headers);
                electrsRes.pipe(res);
                return;
            }
            // Buffer the small (~1-3 KB) tx-detail JSON so we can inject
            // `isOtsCommit`. If anything looks off (non-200, content-encoding,
            // unparseable body, missing txid), fall back to a clean passthrough
            // so we never corrupt a response we don't understand.
            const status = electrsRes.statusCode || 502;
            const encoding = electrsRes.headers['content-encoding'];
            if (status !== 200 || encoding) {
                res.writeHead(status, electrsRes.headers);
                electrsRes.pipe(res);
                return;
            }
            const chunks = [];
            electrsRes.on('data', (c) => chunks.push(c));
            electrsRes.on('end', () => {
                const body = Buffer.concat(chunks);
                try {
                    const tx = JSON.parse(body.toString('utf8'));
                    if (!tx || typeof tx.txid !== 'string') {
                        res.writeHead(status, electrsRes.headers);
                        res.end(body);
                        return;
                    }
                    (0, ordpool_ots_flag_1.attachIsOtsCommit)(tx);
                    const out = Buffer.from(JSON.stringify(tx));
                    const headers = { ...electrsRes.headers };
                    headers['content-length'] = String(out.length);
                    delete headers['transfer-encoding'];
                    res.writeHead(status, headers);
                    res.end(out);
                }
                catch {
                    res.writeHead(status, electrsRes.headers);
                    res.end(body);
                }
            });
            electrsRes.on('error', () => {
                if (!res.headersSent) {
                    res.status(502).send('electrs proxy stream error');
                }
            });
        });
        proxyReq.on('error', (err) => {
            logger_1.default.warn(`electrs proxy error for ${req.method} ${req.url}: ${err.message}`);
            if (!res.headersSent) {
                res.status(502).send('electrs proxy error');
            }
        });
        req.pipe(proxyReq);
    };
}
exports.createElectrsProxyMiddleware = createElectrsProxyMiddleware;
