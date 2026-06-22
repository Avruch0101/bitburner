/** @param {NS} ns
 * Fully prep one target to max money / min security, then exit "PREPPED".
 *   run bprep.js <target>
 */
import { getParams, growThreadsForMultiplier, dispatch } from "batch-live.js";
import { weakenThreadsToMin, growMultiplierToMax, GROW_SEC_PER_THREAD } from "batch-math.js";

export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  if (!target) { ns.tprint("usage: run bprep.js <target>"); return; }
  ns.tprint("prep start: " + target);
  for (let pass = 1; pass < 100000; pass++) {
    const p = getParams(ns, target);
    if (p.prepped) { ns.tprint("PREPPED " + target + " (money max, sec min)"); return; }
    if (p.curSec > p.minSec + 0.01) {
      const wt = weakenThreadsToMin(p.curSec, p.minSec, p.weakenPerThread);
      const got = dispatch(ns, "bweaken.js", wt, target, 0);
      ns.print(`pass ${pass}: weaken ${got}/${wt}  sec ${p.curSec.toFixed(2)}->${p.minSec.toFixed(2)}`);
      await ns.sleep(p.weakenTime + 400);
    } else {
      const mult = growMultiplierToMax(p.curMoney, p.maxMoney);
      const gt = growThreadsForMultiplier(ns, target, mult, p);
      const gGot = dispatch(ns, "bgrow.js", gt, target, 0);
      const wt = Math.ceil(gGot * GROW_SEC_PER_THREAD / p.weakenPerThread);
      const wGot = dispatch(ns, "bweaken.js", wt, target, 0);
      ns.print(`pass ${pass}: grow ${gGot}/${gt} (${(100*p.curMoney/p.maxMoney).toFixed(1)}%) +weaken ${wGot}`);
      await ns.sleep(p.weakenTime + 400);
    }
  }
  ns.tprint("prep gave up after many passes: " + target);
}
