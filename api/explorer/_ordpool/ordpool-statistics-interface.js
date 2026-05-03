"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInscriptionTypeStatistic = exports.isProtocolStatistic = exports.isInscriptionSizeStatistic = exports.isFeeStatistic = exports.isNewTokenStatistic = exports.isMintStatistic = void 0;
function isMintStatistic(stat) {
    return 'cat21Mints' in stat;
}
exports.isMintStatistic = isMintStatistic;
function isNewTokenStatistic(stat) {
    return 'runeEtchings' in stat;
}
exports.isNewTokenStatistic = isNewTokenStatistic;
function isFeeStatistic(stat) {
    return 'feesRuneMints' in stat;
}
exports.isFeeStatistic = isFeeStatistic;
function isInscriptionSizeStatistic(stat) {
    return 'totalEnvelopeSize' in stat;
}
exports.isInscriptionSizeStatistic = isInscriptionSizeStatistic;
function isProtocolStatistic(stat) {
    return 'stamp' in stat || 'counterparty' in stat || 'src721' in stat || 'src101' in stat;
}
exports.isProtocolStatistic = isProtocolStatistic;
function isInscriptionTypeStatistic(stat) {
    return 'inscriptionImages' in stat || 'inscriptionTexts' in stat || 'inscriptionJsons' in stat;
}
exports.isInscriptionTypeStatistic = isInscriptionTypeStatistic;
