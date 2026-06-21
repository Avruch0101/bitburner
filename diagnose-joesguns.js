/** @param {NS} ns */
export async function main(ns) {
  const t = "joesguns";
  const money = ns.getServerMoneyAvailable(t), maxMoney = ns.getServerMaxMoney(t);
  const sec = ns.getServerSecurityLevel(t), minSec = ns.getServerMinSecurityLevel(t);
  ns.tprint(`money:    ${money.toFixed(0)} / ${maxMoney.toFixed(0)}   (75% line = ${(maxMoney*0.75).toFixed(0)})`);
  ns.tprint(`security: ${sec.toFixed(2)} / ${minSec.toFixed(2)} min   (weaken trigger = ${(minSec+5).toFixed(2)})`);
  ns.tprint(`hack branch fires? ${(sec <= minSec + 5 && money >= maxMoney * 0.75) ? "YES" : "NO"}`);
}