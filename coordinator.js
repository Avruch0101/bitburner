/** @param {NS} ns */
export async function main(ns) {
    const numTargets   = Number(ns.args[0]) || 6;     // max targets to bring online
    const levelRatio   = Number(ns.args[1]) || 0.5;   // target required-level <= ratio * your level
    const HOME_RESERVE = 24;     // GB kept free on home for this coordinator + diagnostics
    const STEAL_FRAC   = 0.25;   // fraction of a target's money each hack pass skims; one knob for every server
    const PREP_MARGIN  = 1.5;    // prep threads over the bare grow+weaken need, for reactive-timing slack
    const VALUE_FLOOR  = 0.02;   // skip harvesting any target worth < this fraction of your richest one
    const STICKY_EXTRA = 3;      // keep up to numTargets + this many prepped earners harvesting during a handoff
    const DIG_TARGETS  = 3;      // cold servers to prep IN PARALLEL (each capped), vs dumping all on one focus
    const DIG_PREP_CAP = 6000;   // flat ceiling on prep threads per dig target. A server's prep need is set by
                                 // its OWN economics, not the pool size -- 4% of a 270k pool was still 11k, far
                                 // more than any BN1 server needs at min security. growthAnalyze (no Formulas)
                                 // over-counts grow threads at high security, so prepCost balloons on a cold
                                 // target; this bounds it. prep.js weakens-then-grows over a few cycles, so a
                                 // bounded crew preps fully anyway. Raise if big servers prep slowly; lower to cut idle.
    const ENTER = 0.90, EXIT = 0.60;   // hysteresis: prepped at >=90% money, reverts only below 60%
    const LOOP_MS = 15000;
    const REFRESH_MS = 600000;   // backstop: re-plan at least this often to pick up pool growth / crew resizing
                                 // even with nothing else changed -- but NOT level-driven, so a long weaken gets
                                 // an uninterrupted window instead of being killed every few levels
    const PREP = "prep.js", HACK = "h.js";
    ns.disableLog("ALL");

    // --- singleton guard: kill any other copy of this coordinator (newest wins) ---
    const me = ns.getRunningScript();
    for (const p of ns.ps("home")) {
        if (p.filename === me.filename && p.pid !== me.pid) ns.kill(p.pid);
    }

    const preppedSet = new Set();   // persists across loops (hysteresis state)
    let lastKey = "";
    let lastRebalance = 0;          // timestamp of last redeploy, for the REFRESH_MS backstop

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
            // --- pick candidates (level-filtered, ranked by yield-efficiency) ---
            const L = ns.getHackingLevel();
            const maxReq = L * levelRatio;
            // servers I can currently hack at all: rooted, has money, reqLevel <= my level
            const rootedMoney = all.filter(h => ns.hasRootAccess(h) && ns.getServerMaxMoney(h) > 0
                                              && ns.getServerRequiredHackingLevel(h) <= L);
            // Efficiency score per candidate, computed ONCE (quantized + hostname tiebreak so the
            // ordering is a deterministic function of state -- this is what keeps focus/key stable).
            // Used for SORT ONLY, never for filtering: the eligibility filter + zero-target fallback
            // below stay reqLevel-based, so the L1 cold-start deadlock cannot return.
            const scoreOf = {};
            for (const h of rootedMoney) scoreOf[h] = scoreServer(ns, h);
            const byScore = (a, b) => {
                const d = (scoreOf[b] || 0) - (scoreOf[a] || 0);
                return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);   // tiebreak: hostname asc
            };
            // normal selection uses the ratio filter (skip near-level targets with poor odds);
            // but if that strands us with ZERO targets -- the cold-start deadlock, e.g. n00dles
            // needs L1 while ratio*L < 1 at level 1 -- fall back to every hackable server so the
            // coordinator can never sit idle with no targets and no way to level out of it.
            let eligible = rootedMoney.filter(h => ns.getServerRequiredHackingLevel(h) <= maxReq);
            if (eligible.length === 0) eligible = rootedMoney;
            eligible.sort(byScore);
            const top = eligible.slice(0, numTargets);

            // --- classify with hysteresis: ANY eligible server that's fully prepped can be
            // promoted to the harvest set (not just the top-N). The cold start preps the cheapest
            // server (n00dles) first; restricting promotion to top-N stranded it there forever,
            // since n00dles is never among the richest. The harvest set is value-floored and
            // sliced below, so poor servers drop off on their own once richer ones come online. ---
            const watch = new Set(eligible);
            for (const t of preppedSet) watch.add(t);
            for (const t of watch) {
                if (!ns.hasRootAccess(t) || ns.getServerMaxMoney(t) <= 0) { preppedSet.delete(t); continue; }
                const m = ns.getServerMoneyAvailable(t) / ns.getServerMaxMoney(t);
                const s = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
                if (!preppedSet.has(t)) { if (m >= ENTER && s <= 2) preppedSet.add(t); }
                else { if (m < EXIT) preppedSet.delete(t); }
            }

            // harvest = currently-prepped servers, sticky even if bumped out of top-N;
            // ordered by efficiency (crew placement loads the best $/RAM-sec targets first),
            // but ADMISSION stays on static max-money: the value floor is relative to the richest
            // earner (explicit max, not harvest[0]), so a server can't flip in/out of the set as
            // its score drifts -- that drift is exactly what would thrash the rebalance key.
            let harvest = [...preppedSet].sort(byScore);
            const bestMoney = harvest.length ? Math.max(...harvest.map(t => ns.getServerMaxMoney(t))) : 0;
            harvest = harvest.filter(t => ns.getServerMaxMoney(t) >= VALUE_FLOOR * bestMoney)
                             .slice(0, numTargets + STICKY_EXTRA);
            // dig list: the cold servers we actively prep THIS cycle, in parallel, each capped to its
            // own need (pass 3 below). Capping + parallelism replaces "pour the whole pool into one
            // focus" -- at a 100k+ thread pool that wasted nearly all of it on a server needing a few hundred.
            //  - no earners yet: bootstrap the FASTEST-to-prep servers first (income in seconds)
            //  - once earning: dig the highest-POTENTIAL unprepped top-N targets (big servers now included)
            let digList;
            if (harvest.length === 0) {
                digList = eligible.filter(t => !preppedSet.has(t))
                    .sort((a, b) => prepCost(ns, a) - prepCost(ns, b))
                    .slice(0, DIG_TARGETS);
            } else {
                digList = top.filter(t => !preppedSet.has(t)).slice(0, DIG_TARGETS);
            }

            // --- rebalance when harvest MEMBERSHIP or the dig list changes, OR the refresh backstop
            // fires. LEVEL is deliberately NOT in the key: during a fast-leveling cold start the old
            // floor(L/10) term fired a teardown every few seconds, and since a rebalance kills in-flight
            // prep, long weakens on big servers never completed (the omega-net stall). Both lists use
            // canonical (alphabetical) ordering so re-ranking the same members never triggers a redeploy.
            const key = [...harvest].sort().join(",") + "|" + [...digList].sort().join(",");
            const stale = (Date.now() - lastRebalance) > REFRESH_MS;
            if (key !== lastKey || stale) {
                lastKey = key;
                lastRebalance = Date.now();

                const workerRam = Math.max(ns.getScriptRam(PREP,"home"), ns.getScriptRam(HACK,"home"));
                const pool = [];
                for (const h of all) {
                    if (!ns.hasRootAccess(h) || ns.getServerMaxRam(h) <= 0) continue;
                    ns.scriptKill(PREP, h); ns.scriptKill(HACK, h);
                    ns.scp([PREP, HACK], h, "home");
                    const free = Math.floor((ns.getServerMaxRam(h) - ns.getServerUsedRam(h)) / workerRam);
                    if (free > 0) pool.push({ host: h, free });
                }
                ns.scriptKill(PREP, "home"); ns.scriptKill(HACK, "home");
                const hf = Math.floor((ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RESERVE) / workerRam);
                if (hf > 0) pool.push({ host: "home", free: hf });
                pool.sort((a, b) => b.free - a.free);
                const total = pool.reduce((s, r) => s + r.free, 0);

                // dynamic crews: size each harvested target from its own economics
                const HACK_CAP = Math.max(1, Math.floor(total * 0.20));   // no single target hogs >20% of pool on hack
                const crews = {};
                for (const t of harvest) crews[t] = crewFor(ns, t, STEAL_FRAC, PREP_MARGIN, HACK_CAP);
                // pass 1: hack threads first (income drivers), richest target first
                for (const t of harvest) place(ns, pool, HACK, crews[t].hackT, t);
                // pass 2: prep to refill the skim
                for (const t of harvest) place(ns, pool, PREP, crews[t].prepT, t);
                // pass 3: dig each cold target with a CAPPED crew. The cap is FLAT (DIG_PREP_CAP), not a
                // pool fraction: a server's prep need is set by its own economics, not pool size, and 4% of a
                // big pool was still ~11k. prepCost uses growthAnalyze, which counts grow threads at CURRENT
                // security, so a cold +30-sec target reports a 100k+ "need" -- prep.js weakens to min first
                // then grows efficiently, so the flat cap preps it fine over a few cycles and stops the dump.
                // PREP only, never seed-hack (hacking an unsettled server traps it at high-sec / $0).
                for (const t of digList) {
                    const raw = Math.max(1, Math.ceil(prepCost(ns, t) * PREP_MARGIN));
                    place(ns, pool, PREP, Math.min(raw, DIG_PREP_CAP), t);
                }
                // pass 4: soak remaining surplus as extra prep on the earners (richest-first, ~2x base),
                // then leave the rest idle (persistent idle => raise numTargets / ratio / DIG_TARGETS)
                for (const t of harvest) place(ns, pool, PREP, crews[t].prepT, t);
                const idle = pool.reduce((s, r) => s + r.free, 0);

                const crewStr = harvest.map(t => t + "(h" + crews[t].hackT + "/p" + crews[t].prepT + ")").join(" ");
                ns.tprint("coordinator @L" + L + ": harvest " + (crewStr || "(none)")
                    + "  dig " + (digList.join(",") || "(none)")
                    + "  pool " + total + "t" + (idle > 0 ? "  idle " + idle + "t (raise targets/ratio/DIG)" : ""));
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

// Rough threads-to-prep estimate for picking the fastest bootstrap target:
// grow threads to refill from current money + weaken threads for current security excess.
// Lower = closer to prepped / cheaper to bring online.
function prepCost(ns, t) {
    const max = ns.getServerMaxMoney(t);
    const cur = Math.max(ns.getServerMoneyAvailable(t), 1);
    const mult = Math.min(max / cur, 1e6);                  // cap to avoid Infinity on near-empty servers
    const growT = mult > 1 ? ns.growthAnalyze(t, mult) : 0;
    const secExcess = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
    const weakenT = secExcess / (ns.weakenAnalyze(1) || 0.05);
    return growT + weakenT;
}

// --- yield-efficiency score (relative target ranking) ---------------------------------------
// effScore is PURE (Node-testable): the expected income rate per hack thread a server would have
// once PREPPED (at min security / max money), computed analytically from static values + level.
// Scoring potential -- not current state -- is deliberate: a big server sitting COLD (high sec,
// low money) reads as terrible on the live hack functions, which made focus avoid the very
// servers it should dig. Potential scoring ranks them by what they're worth once prepped.
// Quantized to 3 sig figs so small per-loop drift can't reorder targets and thrash focus/key.
function effScore(maxMoney, reqLevel, minSec, level) {
    if (!(maxMoney > 0) || !(level > 0)) return 0;
    const diffMult = Math.max(0, (100 - minSec) / 100);                 // 0 at sec 100
    const pct    = Math.max(0, (level - (reqLevel - 1)) / level) * diffMult / 240;   // frac/thread at min sec
    const chance = Math.max(0, Math.min(1, (1.75 * level - reqLevel) / (1.75 * level))) * diffMult;
    const timeProxy = (2.5 * reqLevel * minSec + 500) / (level + 50);   // ~hackTime at min sec (×5 const drops out)
    if (!(pct > 0) || !(chance > 0) || !(timeProxy > 0)) return 0;
    return quantize((maxMoney * pct * chance) / timeProxy);
}
function quantize(x) {
    if (!(x > 0) || !isFinite(x)) return 0;
    return Number(x.toPrecision(3));
}
// live wrapper: STATIC reads only (maxMoney, reqLevel, minSec) + current level. No current-security
// reads, no Formulas.exe (lost every install). Same score whether the server is cold or prepped,
// so focus picks the highest-potential cold target to dig instead of fleeing it.
function scoreServer(ns, t) {
    return effScore(ns.getServerMaxMoney(t), ns.getServerRequiredHackingLevel(t),
                    ns.getServerMinSecurityLevel(t), ns.getHackingLevel());
}
