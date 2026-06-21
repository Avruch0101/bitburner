/** @param {NS} ns */
export async function main(ns) {
    const t = ns.args[0];
    while (true) {
        const minSec = ns.getServerMinSecurityLevel(t);
        const sec = ns.getServerSecurityLevel(t);
        const maxMoney = ns.getServerMaxMoney(t);
        const money = ns.getServerMoneyAvailable(t);
        if (money >= maxMoney * 0.9 && sec <= minSec + 2) await ns.hack(t);
        else if (sec > minSec + 1) await ns.weaken(t);
        else await ns.grow(t);
    }
}