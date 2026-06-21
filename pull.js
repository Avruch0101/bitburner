/** @param {NS} ns */
export async function main(ns) {
    // ---- edit these three once, to match your repo ----
    const USER = "Avruch0101";
    const REPO = "bitburner";
    const BRANCH = "main";
    // ---------------------------------------------------
    const files = [
        "pull.js",
        "coordinator.js", "prep.js", "h.js", "g.js", "w.js",
        "farm-status.js", "diagnose-income.js", "earners.js", "status.js",
        "hud.js"
    ];
    const base = "https://raw.githubusercontent.com/" + USER + "/" + REPO + "/" + BRANCH + "/";
    let ok = 0;
    let miss = 0;
    for (const f of files) {
        const got = await ns.wget(base + f + "?ts=" + Date.now(), f);
        if (got) { ok++; ns.tprint("OK   " + f); }
        else { miss++; ns.tprint("MISS " + f); }
    }
    ns.tprint("pull done: " + ok + " ok, " + miss + " missing");
}
