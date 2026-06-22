/** @param {NS} ns
 * Fully prep one target to max money / min security, then exit.
 *   run bprep.js <target>
 */
import { prepTarget } from "batch-live.js";
export async function main(ns) {
  ns.disableLog("ALL");
  const target = ns.args[0];
  if (!target) { ns.tprint("usage: run bprep.js <target>"); return; }
  ns.tprint("prep start: " + target);
  const ok = await prepTarget(ns, target, (m) => ns.print(m));
  ns.tprint(ok ? ("PREPPED " + target + " (money max, sec min)") : ("prep gave up: " + target));
}
