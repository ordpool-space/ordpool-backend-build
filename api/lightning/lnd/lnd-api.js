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
const axios_1 = __importDefault(require("axios"));
const https_1 = require("https");
const fs = __importStar(require("fs"));
const config_1 = __importDefault(require("../../../config"));
const logger_1 = __importDefault(require("../../../logger"));
class LndApi {
    axiosConfig = {};
    constructor() {
        if (!config_1.default.LIGHTNING.ENABLED) {
            return;
        }
        try {
            this.axiosConfig = {
                headers: {
                    'Grpc-Metadata-macaroon': fs.readFileSync(config_1.default.LND.MACAROON_PATH).toString('hex'),
                },
                httpsAgent: new https_1.Agent({
                    ca: fs.readFileSync(config_1.default.LND.TLS_CERT_PATH)
                }),
                timeout: config_1.default.LND.TIMEOUT
            };
        }
        catch (e) {
            config_1.default.LIGHTNING.ENABLED = false;
            logger_1.default.updateNetwork();
            logger_1.default.err(`Could not initialize LND Macaroon/TLS Cert. Disabling LIGHTNING. ` + (e instanceof Error ? e.message : e));
        }
    }
    async $getNetworkInfo() {
        return axios_1.default.get(config_1.default.LND.REST_API_URL + '/v1/graph/info', this.axiosConfig)
            .then((response) => response.data);
    }
    async $getInfo() {
        return axios_1.default.get(config_1.default.LND.REST_API_URL + '/v1/getinfo', this.axiosConfig)
            .then((response) => response.data);
    }
    /** @asyncUnsafe */
    async $getNetworkGraph() {
        const graph = await axios_1.default.get(config_1.default.LND.REST_API_URL + '/v1/graph', this.axiosConfig)
            .then((response) => response.data);
        for (const node of graph.nodes) {
            const nodeFeatures = [];
            for (const bit in node.features) {
                nodeFeatures.push({
                    bit: parseInt(bit, 10),
                    name: node.features[bit].name,
                    is_required: node.features[bit].is_required,
                    is_known: node.features[bit].is_known,
                });
            }
            node.features = nodeFeatures;
        }
        return graph;
    }
}
exports.default = LndApi;
