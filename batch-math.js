/** Pure HWGW batch + prep math. NO ns calls -> unit-testable in Node.
 * In-game, per-thread security/percent values are read from ns/formulas and passed IN;
 * this module only does arithmetic and scheduling.
 * Security deltas below are stable Bitburner constants, used here as test defaults; the
 * live layer reads them via ns.*AnalyzeSecurity / ns.weakenAnalyze so it stays correct
 * even if a version retunes them.
 */
export const HACK_SEC_PER_THREAD = 0.002;
export const GROW_SEC_PER_THREAD = 0.004;

export function hackThreadsForFraction(fraction, hackPctPerThread) {
  if (!(hackPctPerThread > 0)) return 0;
  return Math.max(1, Math.floor(fraction / hackPctPerThread));
}
export function growMultiplierAfterHack(fraction) {
  const remaining = 1 - fraction;
  if (remaining <= 0) return Infinity;
  return 1 / remaining;
}
export function weakenThreadsForSecurity(secIncrease, weakenPerThread) {
  if (!(weakenPerThread > 0)) return 0;
  return Math.ceil(secIncrease / weakenPerThread);
}
export function weakenThreadsForHack(hackThreads, weakenPerThread, hackSec = HACK_SEC_PER_THREAD) {
  return weakenThreadsForSecurity(hackThreads * hackSec, weakenPerThread);
}
export function weakenThreadsForGrow(growThreads, weakenPerThread, growSec = GROW_SEC_PER_THREAD) {
  return weakenThreadsForSecurity(growThreads * growSec, weakenPerThread);
}

// --- prep math ---
export function weakenThreadsToMin(curSec, minSec, weakenPerThread) {
  return weakenThreadsForSecurity(Math.max(0, curSec - minSec), weakenPerThread);
}
export function growMultiplierToMax(curMoney, maxMoney) {
  const m = Math.max(1, curMoney);
  if (maxMoney <= m) return 1;
  return maxMoney / m;
}

// --- landing schedule: ops exec'd together at t0, additionalMsec pushes each completion so
// they FINISH H -> W1 -> G -> W2, `gap` ms apart, all after the longest op (weaken). ---
export function batchOffsets(weakenTime, growTime, hackTime, gap) {
  return {
    hack:    weakenTime + 1 * gap - hackTime,
    weaken1: 2 * gap,
    grow:    weakenTime + 3 * gap - growTime,
    weaken2: 4 * gap,
    batchDuration: weakenTime + 4 * gap,
  };
}
export function landTimes(weakenTime, growTime, hackTime, gap) {
  const o = batchOffsets(weakenTime, growTime, hackTime, gap);
  return {
    hack: hackTime + o.hack, weaken1: weakenTime + o.weaken1,
    grow: growTime + o.grow, weaken2: weakenTime + o.weaken2,
  };
}
