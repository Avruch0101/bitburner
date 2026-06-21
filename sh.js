/** share worker — boosts faction reputation gain while you do faction work.
 *  Does nothing useful unless you are actively working for a faction in the UI.
 *  @param {NS} ns */
export async function main(ns) {
    while (true) await ns.share();
}
