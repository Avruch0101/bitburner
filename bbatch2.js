/** @param {NS} ns
 * v2 CONTINUOUS overlapping HWGW batcher (single target). Fires a fresh self-scheduling batch every
 * `period` ms; many are in flight at once -> the throughput multiple over v1 sequential. Guardrails:
 * a drift detector that re-preps on desync, and a pool-fit guard that never fires a partial batch.
 *   run bbatch2.js <target>                      -> frac 0.05, gap 200ms, period 4*gap
 *   run bbatch2.js <target> 0.05 200 4           -> frac, gap(ms), periodMult (period = periodMult*gap)
 * Validate v1 (`run bbatch.js <target> once`) first; this assumes that BATCH-OK timing holds.
 */
import { getParams, growThreadsForMultiplier, dispatch, prepTarget, pool } from "batch-live.js";
import { hackThreadsForFraction, weakenThreadsForHack, weakenThreadsForGrow,
         growMultiplierAfterHack, batchOffsets } from "batch-math.js";

const DRIFT_SEC = 3;     // sec over min that means desync (normal intra-batch bumps are < ~0.2)
const DRIFT_MULT = 3;    // money desync floor = 1 - DRIFT_MULT*frac (below the normal sawtooth trough)

export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  const frac   = Number(ns.args[1]) || 0.05;
  const gap    = Number(ns.args[2]) || 200;
  const periodMult = Number(ns.args[3]) || 4;
  if (!target) { ns.tprint("usage: run bbatch2.js <target> [frac=0.05] [gap=200] [periodMult=4]"); return; }
  const period = Math.max(gap, periodMult * gap);
  const moneyFloor = Math.max(0.5, 1 - DRIFT_MULT * frac);   // re-prep if money drops below this fraction of max

  ns.tprint(`bbatch2 on ${target}: frac ${frac}, gap ${gap}ms, period ${period}ms (re-prep < ${(100*moneyFloor).toFixed(0)}% money / +${DRIFT_SEC} sec)`);
  await prepTarget(ns, target, (m) => ns.print(m));
  ns.print("PREPPED -- firing continuous batches (kill bbatch2.js to stop)");

  let fired = 0, skipped = 0, resyncs = 0, statusAt = 0;
  while (true) {
    const p = getParams(ns, target);
    const moneyPct = p.maxMoney > 0 ? p.curMoney / p.maxMoney : 1;
    const secOver = p.curSec - p.minSec;
    // publish counters for the HUD (per-target stats file; HUD reads + staleness-checks via ts)
    try {
      ns.write("bstat-" + target + ".txt",
        JSON.stringify({ f: fired, s: skipped, r: resyncs, m: +(moneyPct * 100).toFixed(1), sec: +secOver.toFixed(2), ts: Date.now() }), "w");
    } catch (e) {}

    // --- drift detector: if the server has run off its prepped baseline, stop, clear in-flight
    // workers for this target, re-prep, and resume. Thresholds sit well outside the normal sawtooth. ---
    if (moneyPct < moneyFloor || secOver > DRIFT_SEC) {
      resyncs++;
      ns.print(`DESYNC #${resyncs}: money ${(100*moneyPct).toFixed(1)}%  sec +${secOver.toFixed(2)} -> clear + re-prep`);
      killTargetWorkers(ns, target);
      await ns.sleep(gap * 5);                 // let any just-dispatched ops settle before re-prep
      await prepTarget(ns, target, () => {});
      continue;
    }

    // --- size this batch at the prepped baseline (Formulas-exact when present) ---
    const h  = hackThreadsForFraction(frac, p.hackPct);
    const realFrac = h * p.hackPct;
    const w1 = weakenThreadsForHack(h, p.weakenPerThread);
    const g  = growThreadsForMultiplier(ns, target, growMultiplierAfterHack(realFrac), p);
    const w2 = weakenThreadsForGrow(g, p.weakenPerThread);
    const total = h + w1 + g + w2;

    // --- pool-fit guard: only fire a WHOLE batch. A partial batch (some ops short) desyncs the server.
    // When the pool is full of in-flight batches this skips until they drain -- the natural throttle. ---
    if (poolThreads(ns) < total) {
      skipped++;
      await ns.sleep(period);
      continue;
    }

    const off = batchOffsets(p.weakenTime, p.growTime, p.hackTime, gap);
    dispatch(ns, "bhack.js",   h,  target, off.hack);
    dispatch(ns, "bweaken.js", w1, target, off.weaken1);
    dispatch(ns, "bgrow.js",   g,  target, off.grow);
    dispatch(ns, "bweaken.js", w2, target, off.weaken2);
    fired++;

    const now = Date.now();
    if (now - statusAt > 10000) {                // status roughly every 10s
      statusAt = now;
      ns.print(`fired ${fired}  skipped ${skipped}  resyncs ${resyncs}  | money ${(100*moneyPct).toFixed(1)}%  sec +${secOver.toFixed(2)}  batch H${h}/W${w1}/G${g}/W${w2}`);
    }
    await ns.sleep(period);
  }
}

// total free pool capacity in worker-thread units (largest of the three batch workers' RAM)
function poolThreads(ns) {
  const ram = Math.max(ns.getScriptRam("bhack.js", "home"),
                       ns.getScriptRam("bgrow.js", "home"),
                       ns.getScriptRam("bweaken.js", "home")) || 1.75;
  let t = 0;
  for (const { free } of pool(ns)) t += Math.floor(free / ram);
  return t;
}

// kill only THIS target's in-flight batch workers (by target arg), across all hosts -- multi-target safe
function killTargetWorkers(ns, target) {
  const seen = new Set(["home"]), q = ["home"], all = ["home"];
  while (q.length) { const c = q.shift(); for (const n of ns.scan(c)) if (!seen.has(n)) { seen.add(n); q.push(n); all.push(n); } }
  const workers = new Set(["bhack.js", "bgrow.js", "bweaken.js"]);
  for (const host of all) {
    if (!ns.hasRootAccess(host)) continue;
    for (const proc of ns.ps(host)) {
      if (workers.has(proc.filename) && proc.args[0] === target) ns.kill(proc.pid);
    }
  }
}
