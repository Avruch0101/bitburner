/** @param {NS} ns */
export async function main(ns) {
  const numTargets = Number(ns.args[0]) || 6;     // max targets to bring online
  const levelRatio = Number(ns.args[1]) || 0.5;   // target required-level <= ratio * your level
  const HOME_RESERVE = 24;     // GB kept free on home for this coordinator + diagnostics
  const MAINT_HACK = 10;     // hack threads on a prepped (harvesting) target
  const MAINT_PREP = 20;     // prep threads to refill what hack skims
  const ENTER = 0.90, EXIT = 0.60;   // hysteresis: prepped at >=90% money, reverts only below 60%
  const LOOP_MS = 15000;
  const PREP = "prep.js", HACK = "h.js";
  ns.disableLog("ALL");

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
      const openers = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];
      const have = openers.filter(f => ns.fileExists(f, "home")).length;
      for (const h of all) {
        if (ns.hasRootAccess(h)) continue;
        if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(h);
        if (ns.fileExists("FTPCrack.exe", "home")) ns.ftpcrack(h);
        if (ns.fileExists("relaySMTP.exe", "home")) ns.relaysmtp(h);
        if (ns.fileExists("HTTPWorm.exe", "home")) ns.httpworm(h);
        if (ns.fileExists("SQLInject.exe", "home")) ns.sqlinject(h);
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
      const done = targets.filter(t => preppedSet.has(t));
      const todo = targets.filter(t => !preppedSet.has(t));
      const focus = todo[0] || null;

      // --- only rebalance when the prepped set or focus changes ---
      const key = done.join(",") + "|" + (focus || "");
      if (key !== lastKey) {
        lastKey = key;

        const workerRam = Math.max(ns.getScriptRam(PREP, "home"), ns.getScriptRam(HACK, "home"));
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

        // maintenance crews on prepped targets
        for (const t of done) {
          place(ns, pool, HACK, MAINT_HACK, t);
          place(ns, pool, PREP, MAINT_PREP, t);
        }
        // bulk to the single focus target (concentrated prep + a seed of hack)
        if (focus) {
          const left = pool.reduce((s, r) => s + r.free, 0);
          const seed = Math.min(MAINT_HACK, Math.floor(left * 0.1));
          place(ns, pool, HACK, seed, focus);
          place(ns, pool, PREP, left - seed, focus);
        } else if (done.length) {
          const left = pool.reduce((s, r) => s + r.free, 0);
          place(ns, pool, HACK, left, done[0]);
        }

        ns.tprint(`coordinator @L${L}: harvesting [${done.join(", ")}]  digging ${focus || "(none)"}  pool ${total}t`);
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