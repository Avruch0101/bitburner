/** @param {NS} ns */
export async function main(ns) {
    const script = "h.js";

    const seen = new Set(["home"]), queue = ["home"], all = ["home"];
    while (queue.length > 0) {
        for (const next of ns.scan(queue.shift())) {
            if (!seen.has(next)) { seen.add(next); all.push(next); queue.push(next); }
        }
    }

    const byTarget = {};
    let total = 0;
    for (const host of all) {
        for (const proc of ns.ps(host)) {
            if (proc.filename !== script) continue;
            const t = proc.args[0] ?? "?";
            const inc = ns.getScriptIncome(proc.filename, host, ...proc.args);
            if (!byTarget[t]) byTarget[t] = { inc: 0, threads: 0, runners: 0 };
            byTarget[t].inc += inc;
            byTarget[t].threads += proc.threads;
            byTarget[t].runners += 1;
            total += inc;
        }
    }

    const rows = Object.entries(byTarget).sort((a, b) => a[1].inc - b[1].inc);
    ns.tprint("=== income by target (lowest first) ===");
    for (const [t, d] of rows) {
        const moneyPct = ns.getServerMoneyAvailable(t) / ns.getServerMaxMoney(t) * 100;
        const secOver = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
        ns.tprint(
            `${("$" + d.inc.toFixed(0)).padStart(11)}/s  ${t.padEnd(16)}  ` +
            `money ${moneyPct.toFixed(0).padStart(3)}%  sec +${secOver.toFixed(1)}  ` +
            `(${d.runners}r ${d.threads}t)`
        );
    }
    ns.tprint(`TOTAL: $${total.toFixed(0)}/s`);
}