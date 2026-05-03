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
exports.$lookupNodeLocation = void 0;
const net = __importStar(require("net"));
const maxmind_1 = __importDefault(require("maxmind"));
const nodes_api_1 = __importDefault(require("../../../api/explorer/nodes.api"));
const config_1 = __importDefault(require("../../../config"));
const database_1 = __importDefault(require("../../../database"));
const logger_1 = __importDefault(require("../../../logger"));
const IPCheck = __importStar(require("../../../utils/ipcheck.js"));
/** @asyncSafe */
async function $lookupNodeLocation() {
    let loggerTimer = new Date().getTime() / 1000;
    let progress = 0;
    let nodesUpdated = 0;
    let geoNamesInserted = 0;
    logger_1.default.debug(`Running node location updater using Maxmind`, logger_1.default.tags.ln);
    try {
        const nodes = await nodes_api_1.default.$getAllNodes();
        const lookupCity = await maxmind_1.default.open(config_1.default.MAXMIND.GEOLITE2_CITY);
        const lookupAsn = await maxmind_1.default.open(config_1.default.MAXMIND.GEOLITE2_ASN);
        let lookupIsp = null;
        try {
            lookupIsp = await maxmind_1.default.open(config_1.default.MAXMIND.GEOIP2_ISP);
        }
        catch (e) { }
        for (const node of nodes) {
            const sockets = node.sockets?.split(',') ?? [];
            for (const socket of sockets) {
                const ip = socket.substring(0, socket.lastIndexOf(':')).replace('[', '').replace(']', '');
                const hasClearnet = [4, 6].includes(net.isIP(ip));
                if (hasClearnet && ip !== '127.0.1.1' && ip !== '127.0.0.1') {
                    const city = lookupCity.get(ip);
                    const asn = lookupAsn.get(ip);
                    let isp = null;
                    if (lookupIsp) {
                        isp = lookupIsp.get(ip);
                    }
                    let asOverwrite;
                    if (asn && (IPCheck.match(ip, '170.75.160.0/20') || IPCheck.match(ip, '172.81.176.0/21'))) {
                        asOverwrite = {
                            asn: 394745,
                            name: 'Lunanode',
                        };
                    }
                    else if (asn && (IPCheck.match(ip, '50.7.0.0/16') || IPCheck.match(ip, '66.90.64.0/18'))) {
                        asOverwrite = {
                            asn: 30058,
                            name: 'FDCservers.net',
                        };
                    }
                    else if (asn && asn.autonomous_system_number === 174) {
                        asOverwrite = {
                            asn: 174,
                            name: 'Cogent Communications',
                        };
                    }
                    if (city && (asn || isp)) {
                        const query = `
              UPDATE nodes SET
                as_number = ?,
                city_id = ?,
                country_id = ?,
                subdivision_id = ?,
                longitude = ?,
                latitude = ?,
                accuracy_radius = ?
              WHERE public_key = ?
            `;
                        const params = [
                            asOverwrite?.asn ?? isp?.autonomous_system_number ?? asn?.autonomous_system_number,
                            city.city?.geoname_id,
                            city.country?.geoname_id,
                            city.subdivisions ? city.subdivisions[0].geoname_id : null,
                            city.location?.longitude,
                            city.location?.latitude,
                            city.location?.accuracy_radius,
                            node.public_key
                        ];
                        let result = await database_1.default.query(query, params);
                        if (result[0].changedRows ?? 0 > 0) {
                            ++nodesUpdated;
                        }
                        // Store Continent
                        if (city.continent?.geoname_id) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'continent', ?)`, [city.continent?.geoname_id, JSON.stringify(city.continent?.names)]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                        // Store Country
                        if (city.country?.geoname_id) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'country', ?)`, [city.country?.geoname_id, JSON.stringify(city.country?.names)]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                        // Store Country ISO code
                        if (city.country?.iso_code) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'country_iso_code', ?)`, [city.country?.geoname_id, city.country?.iso_code]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                        // Store Division
                        if (city.subdivisions && city.subdivisions[0]) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'division', ?)`, [city.subdivisions[0].geoname_id, JSON.stringify(city.subdivisions[0]?.names)]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                        // Store City
                        if (city.city?.geoname_id) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'city', ?)`, [city.city?.geoname_id, JSON.stringify(city.city?.names)]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                        // Store AS name
                        if (isp?.autonomous_system_organization ?? asn?.autonomous_system_organization) {
                            result = await database_1.default.query(`INSERT IGNORE INTO geo_names (id, type, names) VALUES (?, 'as_organization', ?)`, [
                                asOverwrite?.asn ?? isp?.autonomous_system_number ?? asn?.autonomous_system_number,
                                JSON.stringify(asOverwrite?.name ?? isp?.isp ?? asn?.autonomous_system_organization)
                            ]);
                            if (result[0].changedRows ?? 0 > 0) {
                                ++geoNamesInserted;
                            }
                        }
                    }
                    ++progress;
                    const elapsedSeconds = Math.round((new Date().getTime() / 1000) - loggerTimer);
                    if (elapsedSeconds > config_1.default.LIGHTNING.LOGGER_UPDATE_INTERVAL) {
                        logger_1.default.debug(`Updating node location data ${progress}/${nodes.length}`);
                        loggerTimer = new Date().getTime() / 1000;
                    }
                }
            }
        }
        if (nodesUpdated > 0) {
            logger_1.default.debug(`${nodesUpdated} nodes maxmind data updated, ${geoNamesInserted} geo names inserted`, logger_1.default.tags.ln);
        }
    }
    catch (e) {
        logger_1.default.err('$lookupNodeLocation() error: ' + (e instanceof Error ? e.message : e));
    }
}
exports.$lookupNodeLocation = $lookupNodeLocation;
