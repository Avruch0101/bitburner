/** xpw -- XP filler worker. Loops weaken() on a target for hacking XP.
 *  Used by coordinator.js Phase 2 to consume leftover idle RAM after
 *  harvest/dig/batch placements. Hacking XP only -- weaken does not
 *  train combat stats. Combat requires gym/crime (manual in BN1 without SF4).
 *  @param {NS} ns */
export async function main(ns) {
    const target = ns.args[0];
    if (!target || !ns.hasRootAccess(target)) return;
    while (true) await ns.weaken(target);
}
