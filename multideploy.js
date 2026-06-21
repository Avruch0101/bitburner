/** @param {NS} ns */
export async function main(ns) {
    const script = "hack.js";     // must match your hack file name exactly
    const maxTargets = 8;         // spread across the N best money servers
    const ramPerThread = ns.getScriptRam(script);
    if (!ramPerThread) { ns.tprint(`ERROR: '${script}' not found on home.`); return; }

    const myLevel = ns.getHackingLevel();

    // breadth-first scan of the whole network
    const seen = new Set(["home"]), queue = ["home"], all = [];
    while (queue.length > 0) {
        for (const next of ns.scan(queue.shift())) {
            if (!seen.has(next)) { seen.add(next); all.push(next); queue.push(next); }
        }
    }

    // root everything we can
    for (const host of all) {
        if (ns.hasRootAccess(host)) continue;
        let ports = 0;
        if (ns.fileExists("BruteSSH.exe", "home")) { ns.brutessh(host); ports++; }
        if (ns.fileExists("FTPCrack.exe", "home")) { ns.ftpcrack(host); ports++; }
        if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(host); ports++; }
        if (ns.fileExists("HTTPWorm.exe", "home")) { ns.httpworm(host); ports++; }
        if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(host); ports++; }
        if (ns.getServerNumPortsRequired(host) <= ports) ns.nuke(host);
    }

    // targets: rooted, has money, hackable — best money first
    const targets = all
        .filter(h => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0
                  && ns.getServerRequiredHackingLevel(h) <= myLevel)
        .map(h => ({ host: h, money: ns.getServerMaxMoney(h) }))
        .sort((a, b) => b.money - a.money)
        .slice(0, maxTargets)
        .map(o => o.host);
    if (targets.length === 0) { ns.tprint("ERROR: no hackable money targets found."); return; }

    // runners: every rooted server with usable RAM, spread round-robin across targets
    let deployed = 0, t = 0;
    for (const host of all) {
        if (!ns.hasRootAccess(host)) continue;
        const threads = Math.floor(ns.getServerMaxRam(host) / ramPerThread);
        if (threads < 1) continue;
        const target = targets[t++ % targets.length];
        ns.killall(host);
        ns.scp(script, host);
        ns.exec(script, host, threads, target);
        deployed++;
    }
    ns.tprint(`Deployed to ${deployed} runners across ${targets.length} targets: ${targets.join(", ")}`);
}