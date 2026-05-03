"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../../config"));
const bitcoin = require('../../rpc-api/index');
const nodeRpcCredentials = {
    host: config_1.default.SECOND_CORE_RPC.HOST,
    port: config_1.default.SECOND_CORE_RPC.PORT,
    user: config_1.default.SECOND_CORE_RPC.USERNAME,
    pass: config_1.default.SECOND_CORE_RPC.PASSWORD,
    timeout: config_1.default.SECOND_CORE_RPC.TIMEOUT,
    cookie: config_1.default.SECOND_CORE_RPC.COOKIE ? config_1.default.SECOND_CORE_RPC.COOKIE_PATH : undefined,
};
exports.default = new bitcoin.Client(nodeRpcCredentials);
