/** shareall — flood the network with share workers to boost faction-rep gain.
 *  Stops whatever farm is running (money OR XP) so its RAM is free, then fills
 *  every rooted server with share workers and keeps topping up.
 *  share only helps WHILE you are doing faction work, so start faction work in
 *  the UI before/while this runs. Kill this and run coordinator.js / xpfarm.js
 *  to switch back.
 *  usage: run shareall.js
 *  @param {NS} ns */
export async function main(ns) {
    const HOME_RESERVE = 24;        // GB kept free on home for hud/pull/etc
    const WORKER = "sh.js";
    ns.disableLog("ALL");

    // singleton: kill any older shareall instance, newest wins
    for (const p of ns.ps("home")) {
        if (p.filename === ns.getScriptName() && p.pid !== ns.pid) ns.kill(p.pid);
    }

    const scan = () => {
        const out = [], seen = new Set(["home"]), q = ["home"];
        while (q.length) {
            const cur = q.shift(); out.push(cur);
            for (const n of ns.scan(cur)) if (!seen.has(n)) { seen.add(n); q.push(n); }
        }
        return out;
    };
    const root = (hosts) => {
        const openers = ["BruteSSH.exe","FTPCrack.exe","relaySMTP.exe","HTTPWorm.exe","SQLInject.exe"];
        const have = openers.filter(f => ns.fileExists(f, "home")).length;
        for (const h of hosts) {
            if (ns.hasRootAccess(h)) continue;
            if (ns.fileExists("BruteSSH.exe","home")) ns.brutessh(h);
            if (ns.fileExists("FTPCrack.exe","home")) ns.ftpcrack(h);
            if (ns.fileExists("relaySMTP.exe","home")) ns.relaysmtp(h);
            if (ns.fileExists("HTTPWorm.exe","home")) ns.httpworm(h);
            if (ns.fileExists("SQLInject.exe","home")) ns.sqlinject(h);
            if (ns.getServerNumPortsRequired(h) <= have) ns.nuke(h);
        }
    };

    // switch to share mode: stop any farm (money OR XP) across the whole network
    // so its RAM is free. Leaves hud/pull/diagnostics alone.
    const stopList = ["coordinator.js", "prep.js", "h.js", "xpfarm.js", "xp.js"];
    let all = scan();
    root(all);
    for (const h of all) {
        if (!ns.hasRootAccess(h)) continue;
        for (const p of ns.ps(h)) if (stopList.includes(p.filename)) ns.kill(p.pid);
    }

    const workerRam = ns.getScriptRam(WORKER, "home");

    // fill all RAM with share workers, keep topping up (new pservers, freed RAM)
    while (true) {
        all = scan();
        root(all);
        let threads = 0, hosts = 0;
        for (const h of all) {
            if (!ns.hasRootAccess(h) || ns.getServerMaxRam(h) <= 0) continue;
            let max = ns.getServerMaxRam(h);
            if (h === "home") max -= HOME_RESERVE;
            const free = Math.floor((max - ns.getServerUsedRam(h)) / workerRam);
            if (free > 0) {
                ns.scp(WORKER, h, "home");
                const pid = ns.exec(WORKER, h, free);   // sh.js takes no args
                if (pid) { threads += free; hosts++; }
            }
        }
        if (threads > 0) ns.tprint("shareall: +" + threads + " share threads across " + hosts + " servers");
        await ns.sleep(15000);
    }
}
