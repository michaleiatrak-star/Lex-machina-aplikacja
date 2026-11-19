// Builds the core-law copy shipped with the installers: every act the act maps of the bundled
// corpus name (the RAG of Polish law), read from the Sejm ELI API by the application's own
// CoreLawIndex, newer consolidated texts and amendments after them included. An existing seed
// directory is updated, not rebuilt: only what ELI changed since is read again.
//
//   node dist/core-law-seed-build.js <corpus> <seed-dir> [--max-minutes N] [--full-catalog]
//
// Exit code 0 also when some acts have no text in ELI (scans without OCR): the installed
// application reads those itself with its local OCR.
import fs from "node:fs";
import path from "node:path";
import { CoreLawIndex, extractCoreActs } from "./core-law-index.js";
import { refreshEliCatalog } from "./eli-catalog.js";
export async function buildCoreLawSeed(corpus, seedDir, maxMinutes = 120, fullCatalog = false) {
    // fullCatalog: every Polish act in force with a consolidated text (eli-catalog.ts: the in-force
    // t.j. announcements, their base acts, the newest t.j. and the amendments after it), not only
    // the acts the act maps name. The installed application keeps checking them daily.
    process.env.LEX_ELI_FULL_CATALOG = fullCatalog ? "1" : "0";
    const started = Date.now();
    fs.mkdirSync(seedDir, { recursive: true });
    if (fullCatalog) {
        const mapDomains = new Map(extractCoreActs(path.resolve(corpus)).map((ref) => [ref.eli, ref.domains]));
        for (let part = 0; part < 50 && Date.now() - started < maxMinutes * 60_000; part += 1) {
            const result = await refreshEliCatalog({ directory: path.resolve(seedDir), mapDomains: (eli) => mapDomains.get(eli) ?? [] }).catch(() => null);
            if (result?.complete)
                break;
            await new Promise((resolve) => setTimeout(resolve, 30_000));
        }
    }
    const index = new CoreLawIndex(path.resolve(seedDir));
    index.load(path.resolve(corpus));
    const missing = () => index.summaries().filter((act) => !act.fetchedAt && !act.unavailable);
    // A run stops after a few failures in a row (ELI busy): it is resumed after a pause.
    for (let pass = 0; pass < (fullCatalog ? 30 : 6) && Date.now() - started < maxMinutes * 60_000; pass += 1) {
        const left = missing().map((act) => act.eli);
        if (pass > 0 && left.length === 0)
            break;
        await index.refresh(pass === 0 ? {} : { force: true, only: left });
        if (missing().length === 0)
            break;
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    const summaries = index.summaries();
    // An act held as another map row's newer t.j. (its own row has no state) is held.
    const held = (act) => Boolean(act.fetchedAt) || index.record(act.currentEli) !== null || index.record(act.eli) !== null;
    return {
        acts: summaries.length,
        withText: summaries.filter(held).length,
        withoutArticles: summaries.filter((act) => held(act) && act.fetchedAt && act.articleCount === 0).map((act) => act.eli),
        missing: summaries
            .filter((act) => !held(act))
            .map((act) => ({ eli: act.eli, reason: act.unavailable ?? act.lastError ?? "brak tekstu w ELI" })),
        newerConsolidated: summaries.filter((act) => act.currentEli !== act.eli).map((act) => ({ eli: act.eli, currentEli: act.currentEli })),
        minutes: Math.round((Date.now() - started) / 60_000)
    };
}
const invoked = process.argv[1] && path.resolve(process.argv[1]).replace(/\.(ts|js)$/u, "") === path.resolve(new URL(import.meta.url).pathname).replace(/\.(ts|js)$/u, "");
if (invoked) {
    const [corpus, seedDir] = process.argv.slice(2);
    const maxAt = process.argv.indexOf("--max-minutes");
    const maxMinutes = maxAt > 0 ? Number(process.argv[maxAt + 1]) : 120;
    const fullCatalog = process.argv.includes("--full-catalog");
    if (!corpus || !seedDir) {
        process.stderr.write("usage: core-law-seed-build <corpus> <seed-dir> [--max-minutes N]\n");
        process.exit(2);
    }
    const report = await buildCoreLawSeed(corpus, seedDir, maxMinutes, fullCatalog);
    fs.writeFileSync(path.join(seedDir, "seed-report.json"), JSON.stringify({ builtAt: new Date().toISOString(), ...report }, null, 1));
    process.stdout.write(`CORE_LAW_SEED acts=${report.acts} withText=${report.withText} withoutArticles=${report.withoutArticles.length} missing=${report.missing.length} newerTj=${report.newerConsolidated.length} minutes=${report.minutes}\n`);
}
