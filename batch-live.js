/** @param {NS} ns
 * Live (ns) layer for the batcher: reads target params via the Formulas.exe path when
 * present and a base-function fallback when not, and provides pool dispatch.
 * This is the small runtime-only surface that CANNOT be unit-tested in Node -- kept thin.
 */
export const HOME_RESERVE = 24; // GB kept free on home

export function getParams(ns, target) {
  const srv = ns.getServer(target);
  const maxMoney = srv.moneyMax;
  const minSec = srv.minDifficulty;
  const curMoney = ns.getServerMoneyAvailable(target);
  const curSec = ns.getServerSecurityLevel(target);
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const player = ns.getPlayer();
  const weakenPerThread = ns.weakenAnalyze(1);

  let hackPct, weakenTime, growTime, hackTime;
  if (hasFormulas) {
    const prepped = Object.assign({}, srv, { hackDifficulty: minSec, moneyAvailable: maxMoney });
    hackPct    = ns.formulas.hacking.hackPercent(prepped, player);
    weakenTime = ns.formulas.hacking.weakenTime(prepped, player);
    growTime   = ns.formulas.hacking.growTime(prepped, player);
    hackTime   = ns.formulas.hacking.hackTime(prepped, player);
  } else {
    hackPct    = ns.hackAnalyze(target);
    weakenTime = ns.getWeakenTime(target);
    growTime   = ns.getGrowTime(target);
    hackTime   = ns.getHackTime(target);
  }
  const prepped = curMoney >= maxMoney - 1 && curSec <= minSec + 0.01;
  return { target, maxMoney, minSec, curMoney, curSec, hasFormulas, weakenPerThread,
           hackPct, weakenTime, growTime, hackTime, prepped };
}

export function growThreadsForMultiplier(ns, target, mult, p) {
  if (mult <= 1) return 0;
  if (p && p.hasFormulas) {
    const srv = ns.getServer(target);
    const start = Object.assign({}, srv, { hackDifficulty: p.minSec, moneyAvailable: p.maxMoney / mult });
    return Math.ceil(ns.formulas.hacking.growThreads(start, ns.getPlayer(), p.maxMoney));
  }
  return Math.ceil(ns.growthAnalyze(target, mult));
}

export function pool(ns) {
  const seen = new Set(["home"]), q = ["home"], all = ["home"];
  while (q.length) { const c = q.shift(); for (const n of ns.scan(c)) if (!seen.has(n)) { seen.add(n); q.push(n); all.push(n); } }
  const hosts = [];
  for (const h of all) {
    if (h !== "home" && !ns.hasRootAccess(h)) continue;
    const max = ns.getServerMaxRam(h);
    if (max === 0) continue;
    let free = max - ns.getServerUsedRam(h);
    if (h === "home") free -= HOME_RESERVE;
    if (free > 0) hosts.push({ host: h, free });
  }
  return hosts;
}

// scp `script` to each host and exec to place up to `threads` total across the pool.
export function dispatch(ns, script, threads, ...args) {
  if (threads <= 0) return 0;
  const ram = ns.getScriptRam(script, "home");
  if (ram <= 0) return 0;
  let placed = 0;
  for (const { host, free } of pool(ns)) {
    if (placed >= threads) break;
    const fit = Math.floor(free / ram);
    if (fit <= 0) continue;
    const n = Math.min(fit, threads - placed);
    if (host !== "home") ns.scp(script, host, "home");
    if (ns.exec(script, host, n, ...args) !== 0) placed += n;
  }
  return placed;
}
