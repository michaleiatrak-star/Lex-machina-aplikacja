import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import {
  CoreLawActLookupError,
  lookupCoreLawAct,
  parseLegalActReference,
  shortLegalActName
} from "../src/core-law-act-lookup.js";
import { CoreLawIndex } from "../src/core-law-index.js";
import { CoreLawToolRuntime } from "../src/core-law-tool-runtime.js";
import { registerCoreLawRoutes } from "../src/http/core-law-routes.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function link(eli: string, title: string, status = "obowiązujący") {
  return { act: { ELI: eli, title, status, promulgation: "2025-01-01" } };
}

// Ustawa o podatku akcyzowym: akt DU/2004/485, t.j. DU/2023/1542 i nowszy DU/2025/126,
// po nim jedna nowelizacja. Ustawa DU/2024/1000 bez t.j., z jednym aktem zmieniającym.
const META: Record<string, Record<string, unknown>> = {
  "DU/2004/485": { title: "Ustawa z dnia 6 grudnia 2008 r. o podatku akcyzowym", type: "Ustawa", status: "obowiązujący", textPDF: true },
  "DU/2023/1542": { title: "Obwieszczenie (t.j. 2023) o podatku akcyzowym", status: "akt jednorazowy", textHTML: true },
  "DU/2025/126": { title: "Obwieszczenie (t.j. 2025) o podatku akcyzowym", status: "akt jednorazowy", textHTML: true },
  "DU/2025/900": { title: "Nowelizacja akcyzy", status: "obowiązujący", textHTML: true },
  "DU/2024/1000": { title: "Ustawa z dnia 5 lipca 2024 r. o czymś nowym", type: "Ustawa", status: "obowiązujący", textHTML: true },
  "DU/2024/1500": { title: "Ustawa o zmianie ustawy o czymś nowym", status: "obowiązujący", textHTML: true },
  "DU/1990/1": { title: "Ustawa uchylona", status: "uchylony", textHTML: true },
  "MP/2024/12": { title: "Uchwała bez tekstu", status: "obowiązujący" }
};
const REFS: Record<string, Record<string, unknown>> = {
  "DU/2004/485": {
    "Inf. o tekście jednolitym": [link("DU/2023/1542", "t.j. 2023"), link("DU/2025/126", "t.j. 2025")]
  },
  "DU/2023/1542": { "Tekst jednolity dla aktu": [link("DU/2004/485", "akcyza")] },
  "DU/2025/126": {
    "Tekst jednolity dla aktu": [link("DU/2004/485", "akcyza")],
    "Nowelizacje po tekście jednolitym": [link("DU/2025/900", "Nowelizacja akcyzy")]
  },
  "DU/2024/1000": { "Akty zmieniające": [link("DU/2024/1500", "Ustawa o zmianie ustawy o czymś nowym")] }
};

function fakeEli() {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const match = /\/acts\/((?:DU|MP)\/\d+\/\d+)(\/references|\/text\.html)?$/.exec(url);
    if (!match) return new Response("", { status: 404 });
    const eli = match[1]!;
    if (match[2] === "/references") return Response.json(REFS[eli] ?? {});
    if (match[2] === "/text.html") return new Response(`<p>Art. 1. Tekst ${eli}.</p><p>Art. 2. Dalszy przepis.</p>`);
    return META[eli] ? Response.json(META[eli]) : new Response("", { status: 404 });
  };
  return { fetcher, requested };
}

describe("legal act reference", () => {
  it("reads ISAP addresses, ELI and journal references", () => {
    expect(parseLegalActReference("https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000383")).toBe("DU/2025/383");
    expect(parseLegalActReference("WDU19640160093")).toBe("DU/1964/93");
    expect(parseLegalActReference("WMP20240000012")).toBe("MP/2024/12");
    expect(parseLegalActReference("https://eli.gov.pl/eli/DU/2025/383/ogl/pol")).toBe("DU/2025/383");
    expect(parseLegalActReference("https://api.sejm.gov.pl/eli/acts/DU/2023/1542/text.html")).toBe("DU/2023/1542");
    expect(parseLegalActReference("Dz. U. z 2025 r. poz. 126")).toBe("DU/2025/126");
    expect(parseLegalActReference("Dz.U. 1964 nr 16 poz. 93")).toBe("DU/1964/93");
    expect(parseLegalActReference("M.P. 2024 poz. 12")).toBe("MP/2024/12");
    expect(parseLegalActReference("ustawa o podatku akcyzowym")).toBeNull();
    expect(parseLegalActReference("Dz.U. 2025 poz. 0")).toBeNull();
  });
});

describe("act lookup in Sejm ELI", () => {
  it("resolves an act to its newest consolidated text", async () => {
    const { fetcher } = fakeEli();
    const act = await lookupCoreLawAct("WDU20040000485", fetcher);
    expect(act).toMatchObject({
      inputEli: "DU/2004/485",
      baseEli: "DU/2004/485",
      currentEli: "DU/2025/126",
      consolidated: true,
      amendmentsAfter: 1,
      status: "obowiązujący"
    });
  });

  it("moves an older consolidated text to the newest one", async () => {
    const { fetcher } = fakeEli();
    const act = await lookupCoreLawAct("Dz.U. 2023 poz. 1542", fetcher);
    expect(act.baseEli).toBe("DU/2004/485");
    expect(act.currentEli).toBe("DU/2025/126");
    expect(act.title).toContain("o podatku akcyzowym");
  });

  it("keeps an act without consolidated text and counts its amending acts", async () => {
    const { fetcher } = fakeEli();
    const act = await lookupCoreLawAct("DU/2024/1000", fetcher);
    expect(act).toMatchObject({ currentEli: "DU/2024/1000", consolidated: false, amendmentsAfter: 1 });
  });

  it("refuses unknown, repealed and textless acts", async () => {
    const { fetcher } = fakeEli();
    const code = (reference: string) =>
      lookupCoreLawAct(reference, fetcher).then(
        () => "OK",
        (error: CoreLawActLookupError) => error.code
      );
    expect(await code("Dz.U. 2024 poz. 7")).toBe("CORE_LAW_ACT_NOT_FOUND");
    expect(await code("DU/1990/1")).toBe("CORE_LAW_ACT_NOT_IN_FORCE");
    expect(await code("MP/2024/12")).toBe("CORE_LAW_ACT_TEXT_UNAVAILABLE");
    expect(await code("kodeks")).toBe("CORE_LAW_ACT_REFERENCE_INVALID");
    const down = await lookupCoreLawAct("DU/2024/1000", async () => {
      throw new Error("offline");
    }).catch((error: CoreLawActLookupError) => error.code);
    expect(down).toBe("CORE_LAW_ACT_SOURCE_UNAVAILABLE");
  });
});

const authService = {
  authenticateAuthorization(header: string | undefined) {
    const role = header?.replace(/^Bearer /, "");
    if (role !== "admin" && role !== "user") throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    return { user: { appRole: role === "admin" ? "ADMIN" : "USER", loginName: role } };
  }
} as unknown as AuthService;

function setup() {
  const corpus = tempDir("lex-core-acts-corpus-");
  const { fetcher } = fakeEli();
  const pdf = { extract: async () => ({ text: "", pages: 0, truncated: false, bytes: 0 }) };
  const index = new CoreLawIndex(tempDir("lex-core-acts-"), fetcher, pdf, () => Date.parse("2026-10-01T10:00:00Z"), 0);
  index.load(corpus);
  const app = express();
  app.use(express.json());
  registerCoreLawRoutes(app, { authService, index, fetcher });
  return { app, index };
}

async function settled(index: CoreLawIndex) {
  for (let i = 0; i < 50 && index.status().refreshing; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("user-added acts", () => {
  it("adds a verified act to the copy, marks its origin and removes it", async () => {
    const { app, index } = setup();
    await request(app).post("/api/core-law/acts").set("authorization", "Bearer user").send({ reference: "DU/2004/485" }).expect(403);

    const lookup = await request(app)
      .post("/api/core-law/acts/lookup")
      .set("authorization", "Bearer admin")
      .send({ reference: "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040000485" })
      .expect(200);
    expect(lookup.body.act.currentEli).toBe("DU/2025/126");
    expect(lookup.body.presentAs).toBeNull();

    await request(app).post("/api/core-law/acts").set("authorization", "Bearer admin").send({ reference: "WDU20040000485" }).expect(201);
    await settled(index);
    const act = index.status().acts.find((item) => item.eli === "DU/2025/126")!;
    expect(act).toMatchObject({ origin: "USER", addedBy: "admin", articleCount: 2 });
    expect(act.labels[0]).toBe("Ustawa o podatku akcyzowym");

    // Models see the added act, its origin and that the copy is not current.
    const tools = new CoreLawToolRuntime(index);
    expect(tools.systemPromptAppendix()).toContain("w tym 1 dodanych przez użytkowników");
    expect(tools.systemPromptAppendix()).toContain("Kopia 1 aktów nie jest aktualnym brzmieniem");
    const [listed] = await tools.runTools([{ id: "1", name: "list_core_law_acts", input: { query: "akcyz" } }]);
    expect(JSON.parse(listed!.content).acts[0]).toMatchObject({
      eli: "DU/2025/126",
      origin: "USER",
      eliCaution: "nowelizacje po tekście jednolitym (1)"
    });
    // Relations are checked right after the download: the amendment after the t.j. is known.
    expect(act.amendmentsAfter.map((item) => item.eli)).toEqual(["DU/2025/900"]);
    expect(index.currentRecord("DU/2025/126")?.articles["1"]).toContain("DU/2025/126");

    // The same act by another reference is not added twice.
    const again = await request(app)
      .post("/api/core-law/acts")
      .set("authorization", "Bearer admin")
      .send({ reference: "Dz.U. 2023 poz. 1542" })
      .expect(409);
    expect(again.body).toEqual({ error: "CORE_LAW_ACT_ALREADY_PRESENT", eli: "DU/2025/126" });

    const removed = await request(app)
      .post("/api/core-law/acts/remove")
      .set("authorization", "Bearer admin")
      .send({ eli: "DU/2025/126" })
      .expect(200);
    expect(removed.body.acts.some((item: { eli: string }) => item.eli === "DU/2025/126")).toBe(false);
    expect(index.currentRecord("DU/2025/126")).toBeNull();
    expect(removed.body.recent[0]).toMatchObject({ kind: "REMOVED", eli: "DU/2025/126" });
    await request(app).post("/api/core-law/acts/remove").set("authorization", "Bearer admin").send({ eli: "DU/2025/126" }).expect(404);
  });

  it("records amending acts of an act without consolidated text", async () => {
    const { app, index } = setup();
    await request(app).post("/api/core-law/acts").set("authorization", "Bearer admin").send({ reference: "DU/2024/1000" }).expect(201);
    await settled(index);
    const act = index.status().acts.find((item) => item.eli === "DU/2024/1000")!;
    expect(act.amendmentsAfter.map((item) => item.eli)).toEqual(["DU/2024/1500"]);
  });

  it("returns ELI refusals as errors", async () => {
    const { app } = setup();
    await request(app).post("/api/core-law/acts").set("authorization", "Bearer admin").send({ reference: "DU/1990/1" }).expect(422);
    await request(app).post("/api/core-law/acts/lookup").set("authorization", "Bearer admin").send({ reference: "x" }).expect(400);
    await request(app).post("/api/core-law/acts/lookup").set("authorization", "Bearer admin").send({}).expect(400);
  });
});

describe("core law schedule", () => {
  it("names acts briefly and checks the copy while the application runs", async () => {
    expect(shortLegalActName("Ustawa z dnia 6 grudnia 2008 r. o podatku akcyzowym", "Ustawa")).toBe(
      "Ustawa o podatku akcyzowym"
    );
    expect(shortLegalActName("Ustawa z dnia 20 maja 1971 r. - Kodeks wykroczeń", "Ustawa")).toBe("Kodeks wykroczeń");

    const { app, index } = setup();
    await request(app).post("/api/core-law/acts").set("authorization", "Bearer admin").send({ reference: "DU/2024/1000" }).expect(201);
    await settled(index);
    const runs: number[] = [];
    const original = index.refresh.bind(index);
    index.refresh = (options) => {
      runs.push(Date.now());
      return original(options);
    };
    const stop = index.startSchedule(5);
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();
    const count = runs.length;
    expect(count).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs.length).toBe(count);
  });
});
