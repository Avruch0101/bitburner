/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL"); // stop the log window from flooding

    // Target is now an argument: `run hack.js n00dles`. Falls back to joesguns.
    const target = ns.args[0] || "joesguns";

    // Hack once money is >=75% of max; tolerate security up to min+5.
    const moneyThresh = ns.getServerMaxMoney(target) * 0.75;
    const securityThresh = ns.getServerMinSecurityLevel(target) + 5;

    // Only root if we don't already have access (safe to re-run).
    if (!ns.hasRootAccess(target)) {
        if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(target);
        ns.nuke(target);
    }

    while (true) {
        if (ns.getServerSecurityLevel(target) > securityThresh) {
            await ns.weaken(target);
        } else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
            await ns.grow(target);
        } else {
            await ns.hack(target);
        }
    }
}