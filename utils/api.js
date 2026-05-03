"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleError = void 0;
function handleError(req, res, statusCode, errorMessage) {
    if (req.accepts('json')) {
        res.status(statusCode).json({ error: errorMessage });
    }
    else {
        res.status(statusCode).send(errorMessage);
    }
}
exports.handleError = handleError;
