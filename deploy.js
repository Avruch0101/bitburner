/** @param {NS} ns */
export async function main(ns) {
    const script = "hack.js";              // <-- must match your hack file EXACTLY (run `ls` on home)
    const target = ns.args[0] || "joesguns";
    const ramPerThread = ns.getScriptRam(script);

    if (!ramPerThread) {
        ns.tprint(`ERROR: '${script}' not found on home (or not a valid script). ` +
                  `Run 'ls' on home, copy the exact filename, and set the 'script' constant to it.`);
        return;
    }

    // breadth-first scan of the whole network from home
    const seen = new Set(["home"]);
    const queue = ["home"];
    const all = [];
    while (queue.length > 0) {
        for (const next of ns.scan(queue.shift())) {
            if (!seen.has(next)) { seen.add(next); all.push(next); queue.push(next); }
        }
    }

    let deployed = 0;
    for (const host of all) {
        if (!ns.hasRootAccess(host)) {
            let ports = 0;
            if (ns.fileExists("BruteSSH.exe", "home")) { ns.brutessh(host); ports++; }
            if (ns.fileExists("FTPCrack.exe", "home")) { ns.ftpcrack(host); ports++; }
            if (ns.fileExists("relaySMTP.exe", "home")) { ns.relaysmtp(host); ports++; }
            if (ns.fileExists("HTTPWorm.exe", "home")) { ns.httpworm(host); ports++; }
            if (ns.fileExists("SQLInject.exe", "home")) { ns.sqlinject(host); ports++; }
            if (ns.getServerNumPortsRequired(host) <= ports) ns.nuke(host);
        }
        if (!ns.hasRootAccess(host)) continue;

        const maxRam = ns.getServerMaxRam(host);
        const threads = Math.floor(maxRam / ramPerThread);
        if (threads < 1) continue;          // no room for even one thread

        ns.killall(host);
        ns.scp(script, host);
        ns.exec(script, host, threads, target);
        deployed++;
    }

    ns.tprint(`Deployed ${script} to ${deployed} servers, all hacking ${target}.`);
}