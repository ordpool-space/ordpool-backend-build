"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithTimeout = void 0;
// fetch() has no built-in timeout; this wraps the AbortController + setTimeout
// + clearTimeout dance so callers don't repeat it. Returns the raw Response;
// status code and body parsing stay with the caller.
// fetchImpl is injectable so tests can stub the underlying fetch.
async function fetchWithTimeout(url, init, timeoutMs, fetchImpl = fetch) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
exports.fetchWithTimeout = fetchWithTimeout;
