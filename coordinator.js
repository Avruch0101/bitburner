/** @param {NS} ns */
export async function main(ns) {
    const numTargets   = Number(ns.args[0]) || 6;     // max targets to bring online
    const levelRatio   = Number(ns.args[1]) || 0.5;   // target required-level <= ratio * your level
    const HOME_RESERVE = 24;     // GB kept free on home for this coordinator + diagnostics
    const STEAL_FRAC   = 0.25;   // fraction of a target's money each hack pass skims; one knob for every server
    const PREP_MARGIN  = 1.5;    // prep threads over the bare grow+weaken need, for reactive-timing slack
    const ENTER = 0.90, EXIT = 0.60;   // hysteresis: prepped at >=90% money, reverts only below 60%
    const LOOP_MS = 15000;
    const PREP = "prep.js", HACK = "h.js";
    ns.disableLog("ALL");

    // --- singleton guard: kill any other copy of this coordinator (newest wins) ---
    const me = ns.getRunningScript();
    for (const p of ns.ps("home")) {
        if (p.filename === me.filename && p.pid !== me.pid) ns.kill(p.pid);
    }

    const preppedSet = new Set();   // persists across loops (hysteresis state)
    let lastKey = "";

    while (true) {
        try {
            // --- scan ---
            const seen = new Set(["home"]), queue = ["home"], all = [];
            while (queue.length) {
                const cur = queue.shift();
                if (cur !== "home") all.push(cur);
                for (const n of ns.scan(cur)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
            }
            // --- root ---
            const openers = ["BruteSSH.exe","FTPCrack.exe","relaySMTP.exe","HTTPWorm.exe","SQLInject.exe"];
            const have = openers.filter(f => ns.fileExists(f, "home")).length;
            for (const h of all) {
                if (ns.hasRootAccess(h)) continue;
                if (ns.fileExists("BruteSSH.exe","home")) ns.brutessh(h);
                if (ns.fileExists("FTPCrack.exe","home")) ns.ftpcrack(h);
                if (ns.fileExists("relaySMTP.exe","home")) ns.relaysmtp(h);
                if (ns.fileExists("HTTPWorm.exe","home")) ns.httpworm(h);
                if (ns.fileExists("SQLInject.exe","home")) ns.sqlinject(h);
                if (ns.getServerNumPortsRequired(h) <= have) ns.nuke(h);
            }
            // --- pick targets (level-filtered, richest first) ---
            const L = ns.getHackingLevel();
            const maxReq = L * levelRatio;
            const targets = all
                .filter(h => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0
                          && ns.getServerRequiredHackingLevel(h) <= maxReq)
                .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a))
                .slice(0, numTargets);

            // --- classify with hysteresis ---
            for (const t of targets) {
                const m = ns.getServerMoneyAvailable(t) / ns.getServerMaxMoney(t);
                const s = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
                if (!preppedSet.has(t)) { if (m >= ENTER && s <= 2) preppedSet.add(t); }
                else { if (m < EXIT) preppedSet.delete(t); }
            }
            const done  = targets.filter(t => preppedSet.has(t));
            const todo  = targets.filter(t => !preppedSet.has(t));
            const focus = todo[0] || null;

            // --- only rebalance when the prepped set or focus changes ---
            const key = done.join(",") + "|" + (focus || "") + "|L" + Math.floor(L / 10);
            if (key !== lastKey) {
                lastKey = key;

                const workerRam = Math.max(ns.getScriptRam(PREP,"home"), ns.getScriptRam(HACK,"home"));
                const pool = [];
                for (const h of all) {
                    if (!ns.hasRootAccess(h) || ns.getServerMaxRam(h) <= 0) continue;
                    ns.killall(h);
                    ns.scp([PREP, HACK], h, "home");
                    const free = Math.floor((ns.getServerMaxRam(h) - ns.getServerUsedRam(h)) / workerRam);
                    if (free > 0) pool.push({ host: h, free });
                }
                ns.killall("home", true);
                const hf = Math.floor((ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RESERVE) / workerRam);
                if (hf > 0) pool.push({ host: "home", free: hf });
                pool.sort((a, b) => b.free - a.free);
                const total = pool.reduce((s, r) => s + r.free, 0);

                // dynamic crews: size each prepped target from its own economics
                const HACK_CAP = Math.max(1, Math.floor(total * 0.20));   // no single target hogs >20% of pool on hack
                const crews = {};
                for (const t of done) crews[t] = crewFor(ns, t, STEAL_FRAC, PREP_MARGIN, HACK_CAP);
                // pass 1: hack threads first (income drivers), richest target first
                for (const t of done) place(ns, pool, HACK, crews[t].hackT, t);
                // pass 2: prep to refill the skim
                for (const t of done) place(ns, pool, PREP, crews[t].prepT, t);
                // pass 3: surplus -> focus prep, or spread as extra prep across prepped targets
                if (focus) {
                    const left = pool.reduce((s, r) => s + r.free, 0);
                    const fc = crewFor(ns, focus, STEAL_FRAC, PREP_MARGIN, HACK_CAP);
                    const seed = Math.min(fc.hackT, Math.floor(left * 0.1));
                    place(ns, pool, HACK, seed, focus);
                    place(ns, pool, PREP, left - seed, focus);
                } else if (done.length) {
                    const left = pool.reduce((s, r) => s + r.free, 0);
                    const per = Math.floor(left / done.length);
                    for (const t of done) place(ns, pool, PREP, per, t);
                }

                const crewStr = done.map(t => t + "(h" + crews[t].hackT + "/p" + crews[t].prepT + ")").join(" ");
                ns.tprint("coordinator @L" + L + ": harvest " + (crewStr || "(none)") + "  dig " + (focus || "(none)") + "  pool " + total + "t");
            }
        } catch (e) {
            ns.print("loop error: " + e);
        }
        await ns.sleep(LOOP_MS);
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
}

// Size a harvest crew for one target from its own hack/grow economics.
function crewFor(ns, t, STEAL_FRAC, PREP_MARGIN, HACK_CAP) {
    const perHack = ns.hackAnalyze(t);                       // fraction stolen per hack thread
    let hackT = perHack > 0 ? Math.max(1, Math.floor(STEAL_FRAC / perHack)) : 1;
    if (hackT > HACK_CAP) hackT = HACK_CAP;
    const growMult = 1 / (1 - STEAL_FRAC);                   // regrow what the skim removes
    const growT = Math.max(1, Math.ceil(ns.growthAnalyze(t, growMult)));
    const wpt = ns.weakenAnalyze(1) || 0.05;                 // security removed per weaken thread
    const secAdd = ns.hackAnalyzeSecurity(hackT, t) + ns.growthAnalyzeSecurity(growT, t);
    const weakenT = Math.max(1, Math.ceil(secAdd / wpt));
    const prepT = Math.ceil((growT + weakenT) * PREP_MARGIN);
    return { hackT, prepT };
}
