/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(660, 460);

    while (true) {
        // --- scan the whole network ---
        const seen = new Set(["home"]);
        const queue = ["home"];
        const all = ["home"];
        while (queue.length) {
            const cur = queue.shift();
            for (const n of ns.scan(cur)) {
                if (!seen.has(n)) { seen.add(n); queue.push(n); all.push(n); }
            }
        }

        // --- tally workers + income per target ---
        const data = {};
        let totalPrep = 0;
        let totalHack = 0;
        let rooted = 0;
        for (const host of all) {
            if (ns.hasRootAccess(host)) rooted++;
            const hackHere = new Set();
            for (const p of ns.ps(host)) {
                const t = p.args[0];
                if (!t) continue;
                if (p.filename === "prep.js") {
                    if (!data[t]) data[t] = { prep: 0, hack: 0, income: 0 };
                    data[t].prep += p.threads;
                    totalPrep += p.threads;
                } else if (p.filename === "h.js") {
                    if (!data[t]) data[t] = { prep: 0, hack: 0, income: 0 };
                    data[t].hack += p.threads;
                    totalHack += p.threads;
                    hackHere.add(t);
                }
            }
            for (const t of hackHere) data[t].income += ns.getScriptIncome("h.js", host, t);
        }

        // --- globals ---
        const lvl = ns.getHackingLevel();
        const cash = ns.getPlayer().money;
        let pserv = 0;
        try { pserv = ns.cloud.getServerNames().length; } catch (e) { pserv = 0; }
        let totalIncome = 0;
        for (const t in data) totalIncome += data[t].income;

        // --- render ---
        ns.clearLog();
        ns.print("L" + lvl + "    $" + fmt(cash) + "    farm +$" + fmt(totalIncome) + "/s");
        ns.print("pool " + totalPrep + " prep + " + totalHack + " hack = " + (totalPrep + totalHack) + "t     rooted " + rooted + "     pserv " + pserv);
        ns.print("--------------------------------------------------------");
        ns.print(pad("TARGET", 20) + padL("MON%", 6) + padL("SEC", 7) + padL("PREP", 6) + padL("HACK", 6) + padL("$/s", 9));
        const rows = Object.keys(data).sort((a, b) =>
            (data[b].income - data[a].income) ||
            (data[b].hack - data[a].hack) ||
            (data[b].prep - data[a].prep));
        for (const t of rows) {
            const max = ns.getServerMaxMoney(t);
            const mon = max > 0 ? (ns.getServerMoneyAvailable(t) / max * 100) : 0;
            const sec = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
            const d = data[t];
            ns.print(
                pad(t, 20) +
                padL(mon.toFixed(1), 6) +
                padL("+" + sec.toFixed(1), 7) +
                padL(String(d.prep), 6) +
                padL(String(d.hack), 6) +
                padL(fmt(d.income), 9)
            );
        }
        if (rows.length === 0) ns.print("(no farm workers deployed yet)");

        await ns.sleep(2000);
    }
}

function fmt(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return n.toFixed(0);
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
