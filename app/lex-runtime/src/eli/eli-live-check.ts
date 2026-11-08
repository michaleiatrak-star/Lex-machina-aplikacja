// Live check of every country's ELI example address and API from this machine's network:
// `npm run eli:check`. Prints one row per country; an answer other than 2xx is shown, never
// hidden (a portal block, a proxy refusal and a moved service look different).
import { ELI_COUNTRIES, EU_ELI } from "./eli-countries.js";

type Row = { code: string; target: string; url: string; result: string };

async function probe(url: string, accept = "application/json, text/html;q=0.8, */*;q=0.5"): Promise<string> {
  try {
    const response = await fetch(url, { headers: { accept }, redirect: "follow", signal: AbortSignal.timeout(25_000) });
    return `${response.status} ${response.headers.get("content-type")?.split(";")[0] ?? ""}`.trim();
  } catch (error) {
    return `BŁĄD ${error instanceof Error ? error.message : String(error)}`.slice(0, 80);
  }
}

function sparql(endpoint: string): string {
  return `${endpoint}?query=${encodeURIComponent("ASK {?s ?p ?o}")}`;
}

export async function eliLiveCheck(): Promise<Row[]> {
  const rows: Row[] = [];
  const jobs: Array<Promise<void>> = [];
  const add = (code: string, target: string, url: string, accept?: string) =>
    jobs.push(probe(url, accept).then((result) => void rows.push({ code, target, url, result })));
  for (const country of ELI_COUNTRIES) {
    if (country.example) add(country.code, "adres", country.example);
    if (country.api) {
      const { kind, probe: path, url: base } = country.api;
      // A probe given as a path is joined to the API; one with a placeholder ("{…}") is not sent.
      const url = kind === "SPARQL" ? sparql(base) : path.startsWith("http") ? path : path.startsWith("/") && !path.includes("{") ? `${base}${path}` : base;
      add(country.code, `API ${country.api.kind}`, url, country.api.kind === "SPARQL" ? "application/sparql-results+json" : undefined);
    }
  }
  add("EU", "API SPARQL", sparql(EU_ELI.url), "application/sparql-results+json");
  await Promise.all(jobs);
  return rows.sort((a, b) => a.code.localeCompare(b.code) || a.target.localeCompare(b.target));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const row of await eliLiveCheck()) console.log(`${row.code}\t${row.target}\t${row.result}\t${row.url}`);
}
