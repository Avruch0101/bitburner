/** @param {NS} ns
 * v1 sequential HWGW batcher (single target). One batch in flight at a time -> cannot desync.
 *   run bbatch.js <target>              -> prep, then fire batches forever (sequential)
 *   run bbatch.js <target> once         -> prep, fire ONE instrumented batch, write report, stop
 *   run bbatch.js <target> once 0.10    -> ... with a 10% skim fraction
 */
import { getParams, growThreadsForMultiplier, dispatch, prepTarget } from "batch-live.js";
import { hackThreadsForFraction, weakenThreadsForHack, weakenThreadsForGrow,
         growMultiplierAfterHack, batchOffsets, landTimes } from "batch-math.js";

const GAP = 200;
const REPORT_FILE = "breport.txt";

export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  const once = ns.args[1] === "once";
  const frac = Number(ns.args[2]) || 0.10;
  if (!target) { ns.tprint("usage: run bbatch.js <target> [once] [fraction]"); return; }

  ns.tprint("prepping " + target + " ...");
  await prepTarget(ns, target, (m) => ns.print(m));

  if (once) {
    const report = await fireBatch(ns, target, frac, true);
    ns.write(REPORT_FILE, report, "w");
    ns.tprint("\n=== COPY BELOW ===\n" + report + "\n=== COPY ABOVE ===\n(saved to " + REPORT_FILE + " - re-read with:  cat " + REPORT_FILE + ")");
    return;
  }
  ns.tprint("bbatch continuous on " + target + "  (kill bbatch.js to stop)");
  while (true) { await fireBatch(ns, target, frac, false); }
}

async function fireBatch(ns, target, frac, instrument) {
  let p = getParams(ns, target);
  if (!p.prepped) { await prepTarget(ns, target, () => {}); p = getParams(ns, target); }

  const h  = hackThreadsForFraction(frac, p.hackPct);
  const realFrac = h * p.hackPct;
  const w1 = weakenThreadsForHack(h, p.weakenPerThread);
  const g  = growThreadsForMultiplier(ns, target, growMultiplierAfterHack(realFrac), p);
  const w2 = weakenThreadsForGrow(g, p.weakenPerThread);
  const off  = batchOffsets(p.weakenTime, p.growTime, p.hackTime, GAP);
  const land = landTimes(p.weakenTime, p.growTime, p.hackTime, GAP);

  const preMoneyPct = 100 * p.curMoney / p.maxMoney;
  const preSec = p.curSec - p.minSec;

  // exec all four; additionalMsec makes them FINISH in order H -> W1 -> G -> W2
  const ph  = dispatch(ns, "bhack.js",   h,  target, off.hack);
  const pw1 = dispatch(ns, "bweaken.js", w1, target, off.weaken1);
  const pg  = dispatch(ns, "bgrow.js",   g,  target, off.grow);
  const pw2 = dispatch(ns, "bweaken.js", w2, target, off.weaken2);
  const allPlaced = ph === h && pw1 === w1 && pg === g && pw2 === w2;

  const t0 = Date.now();
  if (!instrument) { await ns.sleep(off.batchDuration + 1500); return; }

  // sample money% and sec over the batch window; keep only points that changed notably
  const kept = [];
  let lastM = null, lastS = null;
  function sample(tag) {
    const t = Date.now() - t0;
    const m = 100 * ns.getServerMoneyAvailable(target) / p.maxMoney;
    const s = ns.getServerSecurityLevel(target) - p.minSec;
    if (lastM === null || Math.abs(m - lastM) >= 0.5 || Math.abs(s - lastS) >= 0.05 || tag) {
      kept.push(`${String(t).padStart(6)}  ${m.toFixed(1).padStart(6)}%  +${s.toFixed(2)}${tag ? "   <-- " + tag : ""}`);
      lastM = m; lastS = s;
    }
  }
  sample("start");
  const end = t0 + off.batchDuration + 1500;
  while (Date.now() < end && kept.length < 38) { await ns.sleep(200); sample(""); }
  sample("end");

  const post = getParams(ns, target);
  const postMoneyPct = 100 * post.curMoney / post.maxMoney;
  const postSec = post.curSec - post.minSec;
  const okMoney = postMoneyPct >= 99.5, okSec = postSec <= 0.05;

  const L = [];
  L.push("btest report   target=" + target + "   L" + ns.getHackingLevel());
  L.push("Formulas: " + (p.hasFormulas ? "YES" : "NO (base funcs, current-state approx)"));
  L.push(`PRE:    money ${preMoneyPct.toFixed(1)}%    sec +${preSec.toFixed(2)}`);
  L.push(`plan:   skim ${(100*frac).toFixed(0)}% requested / ${(100*realFrac).toFixed(1)}% actual`);
  L.push(`threads wanted:  H ${h}  W1 ${w1}  G ${g}  W2 ${w2}`);
  L.push(`threads placed:  H ${ph}  W1 ${pw1}  G ${pg}  W2 ${pw2}   ` + (allPlaced ? "(all fit)" : "(SHORT - pool too small for this batch)"));
  L.push(`planned lands (ms): H ${land.hack.toFixed(0)}  W1 ${land.weaken1.toFixed(0)}  G ${land.grow.toFixed(0)}  W2 ${land.weaken2.toFixed(0)}   batch ${(off.batchDuration/1000).toFixed(1)}s`);
  L.push("trajectory (t ms, money%, sec+):");
  for (const k of kept) L.push("  " + k);
  L.push(`POST:   money ${postMoneyPct.toFixed(1)}%    sec +${postSec.toFixed(2)}`);
  L.push("VERDICT: " + (okMoney && okSec ? "money returned to max AND sec returned to min  =>  BATCH OK"
        : (!okMoney && !okSec ? "money LOW and sec HIGH  =>  batch mistimed/undersized"
        : (!okMoney ? "money did NOT return to max  =>  grow undersized or hack too deep"
        : "sec did NOT return to min  =>  weaken undersized"))));
  return L.join("\n");
}
