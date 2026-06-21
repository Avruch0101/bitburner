/** @param {NS} ns */
export async function main(ns) {
    const numTargets = Number(ns.args[0]) || 3;
    const levelRatio = Number(ns.args[1]) || 0.5;
    const HOME_RESERVE = 24;   // GB kept free on home for the coordinator + diagnostics
    const workers = ["w.js", "g.js", "h.js"];
    const gFrac = 0.70, hFrac = 0.10;
    const L = ns.getHackingLevel();
    const maxReq = L * levelRatio;

    const seen = new Set(["home"]), queue = ["home"], all = [];
    while (queue.length) {
        const cur = queue.shift();
        if (cur !== "home") all.push(cur);
        for (const next of ns.scan(cur)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }

    const openers = ["BruteSSH.exe","FTPCrack.exe","relaySMTP.exe","HTTPWorm.exe","SQLInject.exe"];
    const haveOpeners = openers.filter(f => ns.fileExists(f, "home")).length;
    for (const h of all) {
        if (ns.hasRootAccess(h)) continue;
        if (ns.fileExists("BruteSSH.exe","home")) ns.brutessh(h);
        if (ns.fileExists("FTPCrack.exe","home")) ns.ftpcrack(h);
        if (ns.fileExists("relaySMTP.exe","home")) ns.relaysmtp(h);
        if (ns.fileExists("HTTPWorm.exe","home")) ns.httpworm(h);
        if (ns.fileExists("SQLInject.exe","home")) ns.sqlinject(h);
        if (ns.getServerNumPortsRequired(h) <= haveOpeners) ns.nuke(h);
    }

    const estChance = (h) => {
        const req = ns.getServerRequiredHackingLevel(h);
        const skill = Math.max(0, (1.75 * L - req) / (1.75 * L));
        return Math.max(0, Math.min(1, skill * (100 - ns.getServerMinSecurityLevel(h)) / 100));
    };

    const targets = all
        .filter(h => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0
                  && ns.getServerRequiredHackingLevel(h) <= maxReq)
        .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a))
        .slice(0, numTargets);
    if (!targets.length) { ns.tprint(`ERROR: no targets with req <= ${maxReq.toFixed(0)}. Raise the ratio.`); return; }

    const workerRam = Math.max(...workers.map(w => ns.getScriptRam(w, "home")));
    if (workerRam === 0) { ns.tprint("ERROR: create w.js/g.js/h.js on home first."); return; }

    const pool = [];
    for (const h of all) {
        if (!ns.hasRootAccess(h) || ns.getServerMaxRam(h) <= 0) continue;
        ns.killall(h);
        ns.scp(workers, h, "home");
        const free = Math.floor((ns.getServerMaxRam(h) - ns.getServerUsedRam(h)) / workerRam);
        if (free > 0) pool.push({ host: h, free });
    }
    ns.killall("home", true);   // clear home's old scripts, but not THIS coordinator
    const homeFree = Math.floor((ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RESERVE) / workerRam);
    if (homeFree > 0) pool.push({ host: "home", free: homeFree });

    pool.sort((a, b) => b.free - a.free);
    const total = pool.reduce((s, r) => s + r.free, 0);
    if (!total) { ns.tprint("ERROR: no runner threads."); return; }

    const budget = Math.floor(total / targets.length);
    const plan = targets.map(t => {
        const g = Math.floor(budget * gFrac);
        const h = Math.floor(budget * hFrac);
        return { target: t, g, w: budget - g - h, h, got: { g: 0, w: 0, h: 0 } };
    });
    for (const p of plan) p.got.g = place(ns, pool, "g.js", p.g, p.target);
    for (const p of plan) p.got.w = place(ns, pool, "w.js", p.w, p.target);
    for (const p of plan) p.got.h = place(ns, pool, "h.js", p.h, p.target);

    ns.tprint(`=== farm.js: L${L}, req<=${maxReq.toFixed(0)}, ${targets.length} targets, pool ${total}t (home incl), ${budget}t each ===`);
    for (const p of plan) {
        const mm = ns.getServerMaxMoney(p.target);
        const pct = ns.getServerMoneyAvailable(p.target) / mm * 100;
        ns.tprint(`${p.target.padEnd(16)} req${ns.getServerRequiredHackingLevel(p.target)} ~${(estChance(p.target)*100).toFixed(0)}%  $${(mm/1e6).toFixed(1)}M now${pct.toFixed(0)}%  g${p.got.g} w${p.got.w} h${p.got.h}`);
    }
}

function place(ns, pool, script, threads, target) {
    let remaining = threads;
    for (const r of pool) {
        if (remaining <= 0) break;
        if (r.free <= 0) continue;
        const n = Math.min(r.free, remaining);
        const pid = ns.exec(script, r.host, n, target);
        if (pid !== 0) { r.free -= n; remaining -= n; }
    }
    return threads - remaining;
}