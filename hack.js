/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const target = ns.args[0];
    if (!target) { ns.tprint("ERROR: no target passed to hack.js"); return; }

    const moneyThresh = ns.getServerMaxMoney(target) * 0.10;   // was 0.75
    const securityThresh = ns.getServerMinSecurityLevel(target) + 5;

    if (!ns.hasRootAccess(target)) {
        if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(target);
        ns.nuke(target);
    }
    while (true) {
        if (ns.getServerSecurityLevel(target) > securityThresh) await ns.weaken(target);
        else if (ns.getServerMoneyAvailable(target) < moneyThresh) await ns.grow(target);
        else await ns.hack(target);
    }
}