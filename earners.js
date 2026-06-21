/** @param {NS} ns */
export async function main(ns) {
    const seen = new Set(["home"]), queue = ["home"], all = ["home"];
    while (queue.length) { const c = queue.shift(); for (const n of ns.scan(c)) if (!seen.has(n)) { seen.add(n); all.push(n); queue.push(n); } }

    const agg = {};
    let total = 0;
    for (const host of all) {
        for (const p of ns.ps(host)) {
            const inc = ns.getScriptIncome(p.filename, host, ...p.args);
            const key = `${p.filename} -> ${p.args[0] ?? "-"}`;
            if (!agg[key]) agg[key] = { inc: 0, threads: 0, n: 0 };
            agg[key].inc += inc; agg[key].threads += p.threads; agg[key].n += 1;
            total += inc;
        }
    }
    const rows = Object.entries(agg)
        .filter(([k, d]) => d.inc > 0 || k.startsWith("h.js") || k.startsWith("hack.js"))
        .sort((a, b) => b[1].inc - a[1].inc);
    ns.tprint("=== income by script -> target ===");
    for (const [k, d] of rows) ns.tprint(`$${d.inc.toFixed(0).padStart(10)}/s  ${k}  (${d.n}proc ${d.threads}t)`);
    ns.tprint(`TOTAL $${total.toFixed(0)}/s`);
}