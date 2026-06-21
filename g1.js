/** @param {NS} ns */
export async function main(ns) {
    const t = ns.args[0];
    const max = ns.getServerMaxMoney(t);
    const before = ns.getServerMoneyAvailable(t);
    const sec = ns.getServerSecurityLevel(t);
    const minSec = ns.getServerMinSecurityLevel(t);
    await ns.grow(t);
    const after = ns.getServerMoneyAvailable(t);
    const mult = before > 0 ? (after / before) : 0;
    ns.tprint(`${t}: max $${max.toFixed(0)} | threads ${ns.getRunningScript().threads} | sec ${sec.toFixed(2)} (min ${minSec.toFixed(2)}) | money ${before.toFixed(0)} -> ${after.toFixed(0)} (x${mult.toFixed(3)})`);
}