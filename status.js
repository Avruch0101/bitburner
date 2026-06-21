/** @param {NS} ns */
export async function main(ns) {
  const p = ns.getPlayer();
  const r = ns.getResetInfo();
  const sf = [...r.ownedSF.entries()].map(([n, lvl]) => `SF${n}.${lvl}`).join(", ") || "none";
  const lines = [
    "=== BITBURNER STATUS ===",
    "timestamp: " + new Date().toISOString(),
    "bitNode: " + r.currentNode,
    "sourceFiles: " + sf,
    "money: " + Math.round(p.money),
    "scriptIncome/sec: " + ns.getTotalScriptIncome()[0].toFixed(2),
    "hacking: " + p.skills.hacking,
    "combat str/def/dex/agi: " + p.skills.strength + "/" + p.skills.defense + "/" + p.skills.dexterity + "/" + p.skills.agility,
    "charisma: " + p.skills.charisma,
    "karma: " + ns.heart.break().toFixed(0),
    "peopleKilled: " + p.numPeopleKilled,
    "homeRAM_GB: " + ns.getServerMaxRam("home"),
    "purchasedServers: " + ns.cloud.getServerNames().length,
    "========================",
  ];
  const report = lines.join("\n");
  ns.tprint("\n" + report);
  ns.write("status.txt", report, "w");
}