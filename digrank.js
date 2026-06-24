/** digrank.js -- show coord's harvest candidate ranking.
 *  Replicates coordinator.js's effScore EXACTLY so the order matches what coord sees.
 *  Prints every rooted, hackable (reqLevel <= myLevel), money-bearing server, ranked by
 *  score descending, with the score components broken out. This answers "why is coord
 *  harvesting X instead of Y" -- the top of this list IS what coord prefers.
 *
 *  Also flags the 0.9*L eligibility cutoff coord uses for its main harvest set (servers
 *  with reqLevel > 0.9*myLevel are dig-reserved/fat-prep only, not in the primary harvest
 *  rank), so you can see if a high-value server is being excluded by that band.
 *  @param {NS} ns */
export async function main(ns) {
    const seen = new Set(["home"]), q = ["home"], all = [];
    while (q.length) {
        const c = q.shift();
        for (const n of ns.scan(c)) if (!seen.has(n)) { seen.add(n); q.push(n); all.push(n); }
    }
    const L = ns.getHackingLevel();
    const cutoff = 0.9 * L;

    const cand = all
        .filter(h => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0 && ns.getServerRequiredHackingLevel(h) <= L)
        .map(h => {
            const maxMoney = ns.getServerMaxMoney(h);
            const reqLevel = ns.getServerRequiredHackingLevel(h);
            const minSec = ns.getServerMinSecurityLevel(h);
            const s = effScoreVerbose(maxMoney, reqLevel, minSec, L);
            return { h, maxMoney, reqLevel, minSec, ...s, eligible: reqLevel <= cutoff };
        })
        .sort((a, b) => b.score - a.score);

    ns.tprint("=== coord harvest candidate ranking (level " + L + ", 0.9*L cutoff = " + cutoff.toFixed(0) + ") ===");
    ns.tprint("rank server                 maxMoney   req  minSec    pct     chance   timeProxy     SCORE  elig");
    let rank = 1;
    for (const r of cand.slice(0, 30)) {
        ns.tprint(
            String(rank).padStart(3) + " " +
            r.h.padEnd(22) +
            fmt(r.maxMoney).padStart(9) + " " +
            String(r.reqLevel).padStart(5) + " " +
            r.minSec.toFixed(1).padStart(6) + "  " +
            r.pct.toExponential(2).padStart(9) + "  " +
            r.chance.toFixed(3).padStart(6) + "  " +
            r.timeProxy.toFixed(2).padStart(9) + "  " +
            fmt(r.score).padStart(8) + "  " +
            (r.eligible ? "YES" : "no")
        );
        rank++;
    }
    ns.tprint("");
    ns.tprint("count: " + cand.length + " rooted+hackable money servers in range");
    ns.tprint("'elig=no' means reqLevel > 0.9*L -- excluded from primary harvest rank, only");
    ns.tprint("reachable via coord's fat-prep dig reservation (BATCH_FLOOR servers) or not at all.");
}

// EXACT copy of coordinator.js effScore, with components exposed for display.
function effScoreVerbose(maxMoney, reqLevel, minSec, level) {
    if (!(maxMoney > 0) || !(level > 0)) return { pct: 0, chance: 0, timeProxy: 0, score: 0 };
    const diffMult = Math.max(0, (100 - minSec) / 100);
    const pct = Math.max(0, (level - (reqLevel - 1)) / level) * diffMult / 240;
    const chance = Math.max(0, Math.min(1, (1.75 * level - reqLevel) / (1.75 * level))) * diffMult;
    const timeProxy = (2.5 * reqLevel * minSec + 500) / (level + 50);
    if (!(pct > 0) || !(chance > 0) || !(timeProxy > 0)) return { pct, chance, timeProxy, score: 0 };
    const score = quantize((maxMoney * pct * chance) / timeProxy);
    return { pct, chance, timeProxy, score };
}
function quantize(x) {
    if (!(x > 0) || !isFinite(x)) return 0;
    return Number(x.toPrecision(3));
}
function fmt(n) {
    const a = Math.abs(n);
    if (a >= 1e12) return (n/1e12).toFixed(2) + "t";
    if (a >= 1e9)  return (n/1e9).toFixed(2)  + "b";
    if (a >= 1e6)  return (n/1e6).toFixed(2)  + "m";
    if (a >= 1e3)  return (n/1e3).toFixed(1)  + "k";
    return n.toFixed(0);
}
