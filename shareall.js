/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const SH = "sh.js", HOME_RESERVE = 8;

    // BFS scan the network
    const seen = new Set(["home"]), queue = ["home"], all = [];
    while (queue.length) {
        const cur = queue.shift();
        if (cur !== "home") all.push(cur);
        for (const n of ns.scan(cur)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }

    const ram = ns.getScriptRam(SH, "home");
    let threads = 0;

    // every rooted remote server -> max share threads
    for (const h of all) {
        if (!ns.hasRootAccess(h) || ns.getServerMaxRam(h) <= 0) continue;
        ns.killall(h);                 // clears the money-farm workers
        ns.scp(SH, h, "home");
        const free = ns.getServerMaxRam(h) - ns.getServerUsedRam(h);
        const t = Math.floor(free / ram);
        if (t > 0) { ns.exec(SH, h, t); threads += t; }
    }

    // home, minus a small reserve, without killing this script
    ns.killall("home", true);          // also stops coordinator.js (intended)
    const hf = ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RESERVE;
    const ht = Math.floor(hf / ram);
    if (ht > 0) { ns.exec(SH, "home", ht); threads += ht; }

    ns.tprint(`sharing on ${threads} threads — leave Sector-12 hacking work running`);
}