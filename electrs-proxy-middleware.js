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
function createElectrsProxyMiddleware(electrsBaseUrl) {
    const electrsHost = new URL(electrsBaseUrl || 'http://127.0.0.1:3000');
    const port = electrsHost.port || '80';
    const hostHeader = `${electrsHost.hostname}:${port}`;
    return (req, res, next) => {
        if (req.path === '/v1' || req.path.startsWith('/v1/')) {
            return next();
        }
        const proxyReq = http.request({
            host: electrsHost.hostname,
            port: Number(port),
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: hostHeader },
        }, (electrsRes) => {
            res.writeHead(electrsRes.statusCode || 502, electrsRes.headers);
            electrsRes.pipe(res);
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
