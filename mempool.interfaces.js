"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionFlags = exports.TemplateAlgorithm = void 0;
const ordpool_parser_1 = require("ordpool-parser");
var TemplateAlgorithm;
(function (TemplateAlgorithm) {
    TemplateAlgorithm[TemplateAlgorithm["legacy"] = 0] = "legacy";
    TemplateAlgorithm[TemplateAlgorithm["clusterMempool"] = 1] = "clusterMempool";
})(TemplateAlgorithm = exports.TemplateAlgorithm || (exports.TemplateAlgorithm = {}));
// binary flags for transaction classification
exports.TransactionFlags = {
    // features
    rbf: 1n,
    no_rbf: 2n,
    v1: 4n,
    v2: 8n,
    v3: 16n,
    nonstandard: 32n,
    // address types
    p2pk: 256n,
    p2ms: 512n,
    p2pkh: 1024n,
    p2sh: 2048n,
    p2wpkh: 4096n,
    p2wsh: 8192n,
    p2tr: 16384n,
    // behavior
    cpfp_parent: 65536n,
    cpfp_child: 131072n,
    replacement: 262144n,
    // data
    op_return: 16777216n,
    fake_pubkey: 33554432n,
    inscription: 67108864n,
    fake_scripthash: 134217728n,
    annex: 268435456n,
    // heuristics
    coinjoin: 4294967296n,
    consolidation: 8589934592n,
    batch_payout: 17179869184n,
    // sighash
    sighash_all: 1099511627776n,
    sighash_none: 2199023255552n,
    sighash_single: 4398046511104n,
    sighash_default: 8796093022208n,
    sighash_acp: 17592186044416n,
    // HACK -- Ordpool flags
    ...ordpool_parser_1.OrdpoolTransactionFlags
};
