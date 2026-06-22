/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(700, 520);
    const React = globalThis.React;
    const h = React.createElement;
    const HOME_RESERVE = 24;   // match coordinator: GB kept free on home
    let action = null;         // set by buttons, performed by the loop (no ns calls inside click handlers)

    while (true) {
        // --- perform any pending button action in loop context ---
        if (action) {
            try {
                if (action === "copied") {
                    ns.toast("HUD copied to clipboard", "success", 1500);
                } else if (action === "pull") {
                    const pid = ns.run("pull.js");
                    ns.toast(pid ? "running pull.js" : "pull.js not found", pid ? "info" : "error", 2500);
                } else if (action === "puzzles") {
                    const pid = ns.run("puzzles.js");
                    ns.toast(pid ? "running puzzles.js" : "puzzles.js not found", pid ? "info" : "error", 2500);
                } else if (action === "restart") {
                    let cargs = [];
                    for (const p of ns.ps("home")) if (p.filename === "coordinator.js") { cargs = p.args; break; }
                    ns.scriptKill("coordinator.js", "home");
                    const pid = ns.run("coordinator.js", 1, ...cargs);
                    ns.toast(pid ? ("coordinator restarted " + (cargs.length ? cargs.join(" ") : "(defaults)")) : "coordinator.js not found", pid ? "success" : "error", 2500);
                }
            } catch (e) { ns.toast("action error: " + e, "error", 4000); }
            action = null;
        }

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

        // --- tally workers + income per target, count rooted + contracts ---
        const data = {};
        let totalPrep = 0, totalHack = 0, rooted = 0, contracts = 0;
        for (const host of all) {
            if (ns.hasRootAccess(host)) rooted++;
            try { contracts += ns.ls(host, ".cct").length; } catch (e) {}
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

        // --- pool capacity (idle threads = free RAM now; total = idle + deployed) ---
        const workerRam = Math.max(ns.getScriptRam("prep.js", "home"), ns.getScriptRam("h.js", "home")) || 1.75;
        let idle = 0;
        for (const host of all) {
            if (!ns.hasRootAccess(host)) continue;
            const maxR = ns.getServerMaxRam(host);
            if (maxR <= 0) continue;
            let avail = maxR - ns.getServerUsedRam(host);
            if (host === "home") avail -= HOME_RESERVE;
            const free = Math.floor(avail / workerRam);
            if (free > 0) idle += free;
        }
        const deployed = totalPrep + totalHack;
        const total = idle + deployed;

        // --- globals ---
        const lvl = ns.getHackingLevel();
        const cash = ns.getPlayer().money;
        let pserv = 0, cloudRam = 0, cloudMax = 0;
        try {
            const cnames = ns.cloud.getServerNames();
            pserv = cnames.length;
            for (const c of cnames) cloudRam += ns.getServerMaxRam(c);
            cloudMax = ns.cloud.getRamLimit() * ns.cloud.getServerLimit();   // max possible total cloud RAM
        } catch (e) { pserv = 0; cloudRam = 0; cloudMax = 0; }
        let liveIncome = 0;
        try { liveIncome = ns.getTotalScriptIncome()[0]; } catch (e) { liveIncome = 0; }
        let sharePow = 1;
        try { sharePow = ns.getSharePower(); } catch (e) { sharePow = 1; }
        const shareDisp = sharePow > 1.001 ? ("x" + sharePow.toFixed(3)) : "off";

        // --- theme (for sticky bar background so it covers scrolled content) ---
        let theme = {};
        try { theme = ns.ui.getTheme(); } catch (e) {}
        const bg = theme.backgroundprimary || "#1a1a1a";
        const muted = theme.secondary || "#888";

        // --- sorted target rows ---
        const rows = Object.keys(data).sort((a, b) =>
            (data[b].income - data[a].income) ||
            (data[b].hack - data[a].hack) ||
            (data[b].prep - data[a].prep));
        const rowMeta = rows.map(t => {
            const max = ns.getServerMaxMoney(t);
            const mon = max > 0 ? (ns.getServerMoneyAvailable(t) / max * 100) : 0;
            const sec = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
            return { t, mon, sec, prep: data[t].prep, hack: data[t].hack, income: data[t].income };
        });

        // --- text snapshot for the Copy button ---
        const lines = [];
        lines.push("L" + lvl + "  $" + fmt(cash) + "  farm +$" + fmt(liveIncome) + "/s  share " + shareDisp);
        lines.push("threads: total " + grp(total) + "  deployed " + grp(deployed)
            + " (" + grp(totalPrep) + " prep / " + grp(totalHack) + " hack)  idle " + grp(idle));
        lines.push("rooted " + rooted + "  pserv " + pserv + "  contracts " + contracts
            + "  cloud " + fmtRam(cloudRam) + (cloudMax ? " / " + fmtRam(cloudMax) : ""));
        lines.push("");
        lines.push(pad("TARGET", 20) + padL("MON%", 6) + padL("SEC", 7) + padL("PREP", 8) + padL("HACK", 7) + padL("$/s", 9));
        for (const r of rowMeta) {
            lines.push(pad(r.t, 20) + padL(r.mon.toFixed(1), 6) + padL("+" + r.sec.toFixed(1), 7)
                + padL(grp(r.prep), 8) + padL(grp(r.hack), 7) + padL(fmt(r.income), 9));
        }
        const snapshot = lines.join("\n");

        // --- REGION: buttons (pinned to top) ---
        const btn = (label, onClick) => h("button",
            { onClick, style: { padding: "2px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" } }, label);
        const buttonsRegion = h("div", {
            style: {
                position: "sticky", top: 0, zIndex: 10, background: bg,
                display: "flex", gap: "6px", padding: "4px 0 6px 0", flexWrap: "wrap",
                borderBottom: "1px solid " + muted, marginBottom: "6px"
            }
        },
            btn("Copy", () => { try { globalThis.navigator.clipboard.writeText(snapshot); } catch (e) {} action = "copied"; }),
            btn("Pull", () => { action = "pull"; }),
            btn("Restart Coord", () => { action = "restart"; }),
            btn("Solve Contracts", () => { action = "puzzles"; })
        );

        // --- REGION: pool table (summary values incl. total + idle threads) ---
        const lc = (s) => h("td", { style: { color: muted, padding: "1px 6px 1px 0", whiteSpace: "nowrap" } }, s);
        const vc = (s) => h("td", { style: { padding: "1px 18px 1px 0", whiteSpace: "nowrap", fontWeight: 600 } }, s);
        const prow = (...cells) => h("tr", null, ...cells);
        const poolTable = h("table", { style: { borderCollapse: "collapse", fontSize: "12px", marginBottom: "8px" } },
            h("tbody", null,
                prow(lc("Level"),    vc(String(lvl)),         lc("Cash"),      vc("$" + fmt(cash))),
                prow(lc("Farm/s"),   vc("+$" + fmt(liveIncome)), lc("Share"),   vc(shareDisp)),
                prow(lc("Total"),    vc(grp(total) + "t"),    lc("Idle"),      vc(grp(idle) + "t")),
                prow(lc("Prep"),     vc(grp(totalPrep)),      lc("Hack"),      vc(grp(totalHack))),
                prow(lc("Rooted"),   vc(String(rooted)),      lc("Pserv"),     vc(String(pserv))),
                prow(lc("Contracts"),vc(String(contracts)),   lc("Cloud RAM"), vc(fmtRam(cloudRam) + (cloudMax ? " / " + fmtRam(cloudMax) : "")))
            )
        );

        // --- REGION: farm table (per-target) ---
        const th = (s, align) => h("th", { style: { textAlign: align, padding: "2px 12px 4px 0", borderBottom: "1px solid " + muted, whiteSpace: "nowrap" } }, s);
        const td = (s, align) => h("td", { style: { textAlign: align, padding: "1px 12px 1px 0", whiteSpace: "nowrap" } }, s);
        const farmBody = rowMeta.length
            ? rowMeta.map(r => h("tr", { key: r.t },
                td(r.t, "left"),
                td(r.mon.toFixed(1), "right"),
                td("+" + r.sec.toFixed(1), "right"),
                td(grp(r.prep), "right"),
                td(grp(r.hack), "right"),
                td(fmt(r.income), "right")))
            : [h("tr", { key: "_none" }, h("td", { colSpan: 6, style: { color: muted, padding: "4px 0" } }, "(no farm workers deployed yet)"))];
        const farmTable = h("table", { style: { borderCollapse: "collapse", fontSize: "12px" } },
            h("thead", null, h("tr", null,
                th("TARGET", "left"), th("MON%", "right"), th("SEC", "right"),
                th("PREP", "right"), th("HACK", "right"), th("$/s", "right"))),
            h("tbody", null, ...farmBody)
        );

        // --- render the whole HUD as one tree ---
        ns.clearLog();
        ns.printRaw(h("div", { style: { fontFamily: "inherit", fontSize: "12px" } },
            buttonsRegion, poolTable, farmTable));

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
function grp(n) { return Math.round(n).toLocaleString("en-US"); }
function fmtRam(gb) {
    if (gb >= 1e6) return (gb / 1e6).toFixed(2) + " PB";
    if (gb >= 1e3) return (gb / 1e3).toFixed(1) + " TB";
    return Math.round(gb) + " GB";
}
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
