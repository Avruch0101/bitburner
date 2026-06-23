/** hud1.js -- always-on display: RAM gauge, collapsed fleet status, launch controls.
 *  Base Netscript only -- no Singularity calls -> cheap, fits in any RAM situation.
 *
 *  Replaces hud.js as the always-on monitor. Removes info already shown by the standard
 *  Overview panel (HP/money/hacking/stats/working-state). Per-target harvest+batch detail
 *  is available on-demand via the "list" buttons (dumped to terminal). For faction rep
 *  and aug planning, launch hud2.js (Singularity-driven, RAM-expensive).
 *
 *  Must be added to pull.js. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(560, 480);
    const React = globalThis.React;
    const h = React.createElement;
    const HOME_RESERVE = 24;   // match coordinator: GB kept free on home
    let action = null;
    let pendingDump = null;    // "harvest" | "batch" -- printed to terminal next loop

    while (true) {
        // --- pending button actions ---
        if (action) {
            try {
                if (action === "pull") {
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
                    ns.toast(pid ? ("coord restarted " + (cargs.length ? cargs.join(" ") : "(defaults)")) : "coordinator.js not found", pid ? "success" : "error", 2500);
                } else if (action === "hud2") {
                    const pid = ns.run("hud2.js");
                    ns.toast(pid ? "launched hud2" : "hud2.js not found or insufficient RAM", pid ? "info" : "error", 2500);
                } else if (action === "killhud2") {
                    const killed = ns.scriptKill("hud2.js", "home");
                    ns.toast(killed ? "killed hud2" : "hud2 not running", killed ? "info" : "warning", 2000);
                }
            } catch (e) { ns.toast("action error: " + e, "error", 4000); }
            action = null;
        }

        // --- BFS network scan ---
        const seen = new Set(["home"]), q = ["home"], all = ["home"];
        while (q.length) {
            const c = q.shift();
            for (const n of ns.scan(c)) if (!seen.has(n)) { seen.add(n); q.push(n); all.push(n); }
        }

        // --- tally workers, income, controllers ---
        const data = {};            // harvest per target
        const batchData = {};       // batch per target
        const batchTargets = new Set();
        const controllers = [];
        const BATCH_WORKERS = new Set(["bhack.js", "bgrow.js", "bweaken.js"]);
        let totalPrep = 0, totalHack = 0, totalBatch = 0, rooted = 0, contracts = 0;
        for (const host of all) {
            if (ns.hasRootAccess(host)) rooted++;
            try { contracts += ns.ls(host, ".cct").length; } catch (e) {}
            const hackHere = new Set();
            for (const p of ns.ps(host)) {
                if (p.filename === "coordinator.js") { controllers.push({ kind: "coord", label: p.args.join(" "), pid: p.pid }); continue; }
                if (p.filename === "bbatch2.js") { if (p.args[0]) batchTargets.add(p.args[0]); controllers.push({ kind: "batch", label: String(p.args[0] || "?"), pid: p.pid }); continue; }
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
                } else if (BATCH_WORKERS.has(p.filename)) {
                    if (!batchData[t]) batchData[t] = { threads: 0 };
                    batchData[t].threads += p.threads;
                    totalBatch += p.threads;
                }
            }
            for (const t of hackHere) data[t].income += ns.getScriptIncome("h.js", host, t);
        }
        const harvestIncome = Object.values(data).reduce((s, d) => s + d.income, 0);
        const harvestServers = Object.keys(data).filter(t => !batchTargets.has(t)).length;

        // --- pool capacity (idle threads + total) ---
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
        const total = idle + deployed + totalBatch;

        // --- RAM gauge: home, cloud, network ---
        const homeMax = ns.getServerMaxRam("home");
        const homeUsed = ns.getServerUsedRam("home");
        let cloudUsed = 0, cloudMax = 0, cloudCount = 0;
        const cloudSet = new Set();
        try {
            const cnames = ns.cloud.getServerNames();
            cloudCount = cnames.length;
            for (const c of cnames) {
                cloudSet.add(c);
                cloudMax += ns.getServerMaxRam(c);
                cloudUsed += ns.getServerUsedRam(c);
            }
        } catch (e) {}
        let netUsed = 0, netMax = 0, netCount = 0;
        for (const host of all) {
            if (host === "home" || cloudSet.has(host)) continue;
            if (!ns.hasRootAccess(host)) continue;
            const m = ns.getServerMaxRam(host); if (m <= 0) continue;
            netMax += m;
            netUsed += ns.getServerUsedRam(host);
            netCount++;
        }

        // --- live income, share, batch income (aggregate-derived) ---
        let liveIncome = 0;
        try { liveIncome = ns.getTotalScriptIncome()[0]; } catch (e) {}
        const batchIncome = Math.max(0, liveIncome - harvestIncome);
        let sharePow = 1;
        try { sharePow = ns.getSharePower(); } catch (e) {}
        const shareDisp = sharePow > 1.001 ? ("x" + sharePow.toFixed(3)) : "off";

        // --- terminal dump (pending from a list-button click last render) ---
        if (pendingDump === "harvest") {
            ns.tprint("=== harvest detail ===");
            ns.tprint("server                   MON%   SEC    PREP    HACK      $/s");
            const sorted = Object.entries(data).filter(([t]) => !batchTargets.has(t)).sort((a, b) => b[1].income - a[1].income);
            for (const [t, d] of sorted) {
                const max = ns.getServerMaxMoney(t) || 1;
                const cur = ns.getServerMoneyAvailable(t);
                const sec = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
                ns.tprint(
                    t.padEnd(24) + (cur / max * 100).toFixed(1).padStart(5) + "  " +
                    ("+" + sec.toFixed(1)).padStart(5) + "  " +
                    String(d.prep).padStart(6) + "  " +
                    String(d.hack).padStart(6) + "  " +
                    ("$" + fmt(d.income)).padStart(9)
                );
            }
            pendingDump = null;
        } else if (pendingDump === "batch") {
            ns.tprint("=== batch detail ===  (per-server income not directly readable; aggregate $" + fmt(batchIncome) + "/s)");
            ns.tprint("server                   MON%   SEC   threads");
            const sorted = Object.entries(batchData).sort((a, b) => b[1].threads - a[1].threads);
            for (const [t, d] of sorted) {
                const max = ns.getServerMaxMoney(t) || 1;
                const cur = ns.getServerMoneyAvailable(t);
                const sec = ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t);
                ns.tprint(
                    t.padEnd(24) + (cur / max * 100).toFixed(1).padStart(5) + "  " +
                    ("+" + sec.toFixed(1)).padStart(5) + "  " +
                    String(d.threads).padStart(7)
                );
            }
            pendingDump = null;
        }

        // --- theme ---
        let theme = {};
        try { theme = ns.ui.getTheme(); } catch (e) {}
        const bg = theme.backgroundprimary || "#1a1a1a";
        const muted = theme.secondary || "#888";
        const panelBg = theme.welllight || "rgba(255,255,255,0.04)";
        const panelBorder = theme.well || "#2a2a2a";
        const titleColor = theme.primary || "#5fb3d8";
        const moneyColor = theme.money || "#ffd166";
        const incomeColor = theme.money || "#5ce06c";
        const warnColor = theme.errorlight || "#e06c5c";
        const hackColor = theme.hack || "#5fb3d8";
        const shareColor = sharePow > 1.001 ? (theme.hack || "#5ce06c") : muted;

        const panel = (title, ...children) => h("div", {
            style: { background: panelBg, border: "1px solid " + panelBorder, borderRadius: 4, padding: "6px 8px", marginBottom: 6 },
        },
            h("div", { style: { color: titleColor, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 } }, title),
            ...children
        );

        const row = (a, b) => h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, lineHeight: 1.5 } },
            h("span", null, a), h("span", null, b)
        );

        // RAM bar: label, filled proportion, numbers + percent
        const ramBar = (label, used, max, count) => {
            const pct = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0;
            const barColor = pct > 90 ? warnColor : (pct > 75 ? moneyColor : incomeColor);
            const countStr = count !== undefined ? " (" + count + ")" : "";
            return h("div", { style: { marginBottom: 4 } },
                h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11 } },
                    h("span", null, label + countStr),
                    h("span", { style: { color: muted } }, fmtGB(used) + " / " + fmtGB(max) + "  " + pct + "%")
                ),
                h("div", { style: { height: 6, background: panelBorder, borderRadius: 2, overflow: "hidden", marginTop: 2 } },
                    h("div", { style: { width: pct + "%", height: "100%", background: barColor } })
                )
            );
        };

        const btn = (label, onClick, color) => h("button", {
            onClick: onClick,
            style: {
                padding: "3px 8px", fontSize: 11, background: "transparent",
                border: "1px solid " + (color || panelBorder), color: color || muted,
                borderRadius: 3, cursor: "pointer", marginRight: 4, marginBottom: 3,
            },
        }, label);

        // controller uptime via getRunningScript
        const ctrlRows = controllers.map(c => {
            let up = "?";
            try { const info = ns.getRunningScript(c.pid); if (info) up = fmtTime(info.onlineRunningTime); } catch (e) {}
            return h("div", { key: c.pid, style: { display: "flex", justifyContent: "space-between", fontSize: 11 } },
                h("span", null, c.kind === "coord" ? ("coord " + c.label) : ("batch " + c.label)),
                h("span", { style: { color: muted } }, up)
            );
        });

        // --- render ---
        ns.clearLog();
        ns.printRaw(h("div", { style: { fontFamily: "monospace", background: bg, padding: 6 } },
            panel("RAM",
                ramBar("home", homeUsed, homeMax),
                ramBar("cloud", cloudUsed, cloudMax, cloudCount),
                ramBar("network", netUsed, netMax, netCount),
            ),
            panel("FLEET",
                row("rooted", rooted),
                row("contracts", h("span", { style: { color: contracts > 0 ? incomeColor : muted } }, contracts)),
                row("share", h("span", { style: { color: shareColor } }, shareDisp)),
                row("income", h("span", { style: { color: incomeColor } }, "$" + fmt(liveIncome) + "/s")),
                h("div", { style: { borderTop: "1px solid " + panelBorder, marginTop: 4, paddingTop: 4 } }),
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 } },
                    h("span", null, "harvest"),
                    h("span", null, harvestServers + " srv  " + (totalPrep + totalHack) + " t  $" + fmt(harvestIncome) + "/s"),
                    btn("list", () => { pendingDump = "harvest"; }),
                ),
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginTop: 2 } },
                    h("span", null, "batch"),
                    h("span", null, Object.keys(batchData).length + " srv  " + totalBatch + " t  $" + fmt(batchIncome) + "/s"),
                    btn("list", () => { pendingDump = "batch"; }),
                ),
                h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: muted, marginTop: 4 } },
                    h("span", null, "threads"),
                    h("span", null, "dep " + deployed + "  batch " + totalBatch + "  idle " + idle + "  tot " + total)
                ),
            ),
            panel("CONTROLLERS",
                ...(ctrlRows.length === 0 ? [h("div", { style: { color: muted, fontSize: 11 } }, "(none)")] : ctrlRows)
            ),
            panel("CONTROLS",
                h("div", { style: { display: "flex", flexWrap: "wrap" } },
                    btn("pull", () => { action = "pull"; }, hackColor),
                    btn("puzzles", () => { action = "puzzles"; }, hackColor),
                    btn("restart coord", () => { action = "restart"; }, hackColor),
                    btn("launch hud2", () => { action = "hud2"; }, titleColor),
                    btn("kill hud2", () => { action = "killhud2"; }, warnColor),
                )
            ),
        ));

        await ns.sleep(2000);
    }
}

function fmt(n) {
    if (!isFinite(n)) return "--";
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + "t";
    if (a >= 1e9)  return (n / 1e9).toFixed(2)  + "b";
    if (a >= 1e6)  return (n / 1e6).toFixed(2)  + "m";
    if (a >= 1e3)  return (n / 1e3).toFixed(1)  + "k";
    return n.toFixed(0);
}
function fmtGB(gb) {
    if (gb >= 1e6) return (gb / 1e6).toFixed(2) + "PB";
    if (gb >= 1e3) return (gb / 1e3).toFixed(2) + "TB";
    return gb.toFixed(0) + "GB";
}
function fmtTime(secs) {
    secs = Math.floor(secs);
    const m = Math.floor(secs / 60), s = secs % 60;
    if (m >= 60) { const hr = Math.floor(m / 60), mm = m % 60; return hr + "h" + mm + "m"; }
    return m + "m" + s + "s";
}
