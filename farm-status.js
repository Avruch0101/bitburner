/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0];
  if (!target) {
    ns.tprint("usage: run farm-status.js <target>");
    return;
  }
  const IGNORE = ["farm-status.js", "diagnose-income.js", "earners.js", "g1.js", "status.js"];

  const seen = new Set(["home"]);
  const queue = ["home"];
  const all = ["home"];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ns.scan(cur)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
        all.push(n);
      }
    }
  }

  let grow = 0;
  let weaken = 0;
  let prep = 0;
  let hack = 0;
  let income = 0;
  const others = {};
  for (const host of all) {
    let hostHasHack = false;
    for (const p of ns.ps(host)) {
      if (p.args[0] !== target) continue;
      if (p.filename === "g.js") grow += p.threads;
      else if (p.filename === "w.js") weaken += p.threads;
      else if (p.filename === "prep.js") prep += p.threads;
      else if (p.filename === "h.js") {
        hack += p.threads;
        hostHasHack = true;
      } else if (!IGNORE.includes(p.filename)) {
        others[p.filename] = (others[p.filename] || 0) + p.threads;
      }
    }
    if (hostHasHack) income += ns.getScriptIncome("h.js", host, target);
  }

  const max = ns.getServerMaxMoney(target);
  const money = ns.getServerMoneyAvailable(target);
  const sec = ns.getServerSecurityLevel(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const pct = max > 0 ? (money / max * 100) : 0;

  ns.tprint("=== " + target + " workers ===");
  ns.tprint("prep " + prep + "t   hack " + hack + "t   (legacy grow " + grow + "t  weaken " + weaken + "t)");
  ns.tprint("money " + pct.toFixed(1) + "%   sec +" + (sec - minSec).toFixed(1));
  ns.tprint("hack income $" + income.toFixed(0) + "/s");
  const otherKeys = Object.keys(others);
  if (otherKeys.length) ns.tprint("OTHER scripts: " + otherKeys.map(k => k + " " + others[k] + "t").join(", "));
  else ns.tprint("no old scripts running");
}