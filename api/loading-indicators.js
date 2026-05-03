"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class LoadingIndicators {
    loadingIndicators = {
        'mempool': 0,
    };
    progressChangedCallback;
    constructor() { }
    setProgressChangedCallback(fn) {
        this.progressChangedCallback = fn;
    }
    setProgress(name, progressPercent, rounded = true) {
        const newProgress = rounded === true ? Math.round(progressPercent) : progressPercent;
        if (newProgress >= 100) {
            delete this.loadingIndicators[name];
        }
        else {
            this.loadingIndicators[name] = newProgress;
        }
        if (this.progressChangedCallback) {
            this.progressChangedCallback(this.loadingIndicators);
        }
    }
    getLoadingIndicators() {
        return this.loadingIndicators;
    }
}
exports.default = new LoadingIndicators();
