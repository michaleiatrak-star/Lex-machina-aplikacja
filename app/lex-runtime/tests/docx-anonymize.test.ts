import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { SecureCaseUploadStore } from "../src/case-secure-store.js";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";
import { alignProtected, anonymizeDocx, protectedPageText } from "../src/docx-anonymize.js";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { DOCX_MEDIA_TYPE, LocalOfficeDocumentTextExtractor } from "../src/office-document-extractor.js";

const PYTHON = process.env.LEX_STORAGE_PYTHON ?? "python3";

// A DOCX as Word writes it: runs split inside a name, a footnote, a comment with its author,
// a tracked deletion, a mailto link (field and relationship), the same header twice, metadata.
const BUILD = String.raw`
import sys, zipfile
NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"'
filler = "".join('<w:p><w:r><w:t>Akapit %d uzasadnienia bez danych osobowych, tylko tekst prawny o umowie.</w:t></w:r></w:p>' % i for i in range(int(sys.argv[2])))
doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' \
  '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Powód: Jan </w:t></w:r><w:r><w:t>Kowal</w:t></w:r><w:r><w:t xml:space="preserve">ski, PESEL 44051401359</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' \
  + filler + \
  '<w:p><w:r><w:t>Pozwana: Anna Nowak</w:t></w:r><w:del w:id="9" w:author="Jan Kowalski"><w:r><w:delText>Piotr Zieliński</w:delText></w:r></w:del><w:r><w:commentReference w:id="0"/></w:r></w:p>' \
  '<w:p><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:jan.kowalski@example.com" </w:instrText></w:r><w:r><w:t>jan.kowalski@example.com</w:t></w:r></w:p>' \
  '<w:sectPr/></w:body></w:document>'
hdr = '<?xml version="1.0" encoding="UTF-8"?><w:hdr ' + NS + '><w:p><w:r><w:t>Kancelaria Jan Kowalski</w:t></w:r></w:p></w:hdr>'
fn = '<?xml version="1.0" encoding="UTF-8"?><w:footnotes ' + NS + '><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Pełnomocnik Anna Nowak.</w:t></w:r></w:p></w:footnote></w:footnotes>'
cm = '<?xml version="1.0" encoding="UTF-8"?><w:comments ' + NS + '><w:comment w:id="0" w:author="Jan Kowalski" w:initials="JK"><w:p><w:r><w:t>Dopytać Jana Kowalskiego</w:t></w:r></w:p></w:comment></w:comments>'
core = '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pozew Jan Kowalski</dc:title><dc:creator>Jan Kowalski</dc:creator><cp:lastModifiedBy>Jan Kowalski</cp:lastModifiedBy></cp:coreProperties>'
rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:jan.kowalski@example.com" TargetMode="External"/></Relationships>'
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for name, body in (("word/document.xml", doc), ("word/header1.xml", hdr), ("word/header3.xml", hdr), ("word/footnotes.xml", fn), ("word/comments.xml", cm), ("docProps/core.xml", core), ("word/_rels/document.xml.rels", rels)):
        z.writestr(name, body)
    z.writestr("word/media/image1.png", b"png")
`;

const READ = String.raw`
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
sys.stdout.write("\n".join(name + "\t" + z.read(name).decode("utf-8", "replace").replace("\n", " ") for name in z.namelist()))
`;

const available = spawnSync(PYTHON, ["-c", "import zipfile"]).status === 0;

function fixture(filler = 0): Buffer {
  const file = `${process.env.TMPDIR ?? "/tmp"}/lex-docx-anon-${process.pid}-${filler}.docx`;
  const built = spawnSync(PYTHON, ["-c", BUILD, file, String(filler)], { encoding: "utf8" });
  expect(built.stderr).toBe("");
  const data = spawnSync(PYTHON, ["-c", "import sys; sys.stdout.buffer.write(open(sys.argv[1], 'rb').read())", file]);
  return data.stdout as Buffer;
}

function parts(data: Buffer): Map<string, string> {
  const file = `${process.env.TMPDIR ?? "/tmp"}/lex-docx-anon-out-${process.pid}.docx`;
  spawnSync(PYTHON, ["-c", "import sys; open(sys.argv[1], 'wb').write(sys.stdin.buffer.read())", file], { input: data });
  const out = spawnSync(PYTHON, ["-c", READ, file], { encoding: "utf8" }).stdout;
  return new Map(out.split("\n").map((line) => line.split("\t") as [string, string]));
}

// Persons as the morphology would find them; the identifiers are the pseudonymizer's own.
const recognizer = {
  recognize: async (text: string) =>
    [...text.matchAll(/Jan Kowalski|Jana Kowalskiego|Anna Nowak/gu)].map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
      kind: "PERSON" as const,
      value: match[0]
    }))
};

function service(maxChunkChars = 24_000) {
  return new LocalPrivateDocumentService(
    new CompleteDocumentIngestor({ extract: async () => ({ bytes: 0, pages: [] }) }),
    recognizer,
    maxChunkChars,
    undefined,
    undefined,
    undefined,
    new LocalOfficeDocumentTextExtractor()
  );
}

describe("anonymized version as a .docx", () => {
  it("aligns tokens with the source; the text between them must be the source's own", () => {
    const source = "Jan Kowalski, ul. Długa 5, Warszawa, i Anna Nowak.";
    const protectedText = "[PII:PERSON:0001], [PII:ADDRESS:0001], Warszawa, i [PII:PERSON:0002|NOM].";
    const surfaces = (token: string) =>
      ({ "[PII:PERSON:0001]": ["Jan Kowalski"], "[PII:ADDRESS:0001]": ["ul. Długa 5"], "[PII:PERSON:0002]": ["Anna Nowak"] })[token] ?? [];
    expect(alignProtected(source, protectedText, surfaces)).toEqual([
      [0, 12, "[PII:PERSON:0001]"],
      [14, 25, "[PII:ADDRESS:0001]"],
      [39, 49, "[PII:PERSON:0002|NOM]"]
    ]);
    // An address with a comma: its known form wins over the first ", " after it.
    expect(alignProtected("ul. Długa 5, 00-001 Warszawa, dalej", "[PII:ADDRESS:0001], dalej", () => ["ul. Długa 5, 00-001 Warszawa"])).toEqual([
      [0, 28, "[PII:ADDRESS:0001]"]
    ]);
    expect(() => alignProtected("Jan Kowalski mówi", "[PII:PERSON:0001] pisze", () => [])).toThrow("DOCX_ANONYMIZED_ALIGNMENT_FAILED");
    expect(protectedPageText([{ text: "[STRONA 1 · CZĘŚĆ 1/2 · DIGITAL]\nAla " }, { text: "[STRONA 1 · CZĘŚĆ 2/2 · DIGITAL]\nma kota" }])).toBe("Ala ma kota");
  });

  it.skipIf(!available)("reads headers, footers, footnotes and comments; leaves deleted text out", async () => {
    const text = await new LocalOfficeDocumentTextExtractor().extract(fixture(), DOCX_MEDIA_TYPE);
    expect(text).toBe(
      [
        "Powód: Jan Kowalski, PESEL 44051401359[przypis 1]",
        "Pozwana: Anna Nowak[komentarz 0]",
        "jan.kowalski@example.com",
        "Nagłówek strony:",
        "Kancelaria Jan Kowalski",
        "Przypisy:",
        "[przypis 1]  Pełnomocnik Anna Nowak.",
        "Komentarze:",
        "[komentarz 0] Dopytać Jana Kowalskiego"
      ].join("\n\n")
    );
  });

  it.skipIf(!available)("the copy reads as the anonymized version, keeps the formatting and has no value anywhere", async () => {
    for (const [filler, chunkChars] of [[0, 24_000], [30, 900]] as const) {
      const data = fixture(filler);
      const current = service(chunkChars);
      const review = await current.review(data, DOCX_MEDIA_TYPE);
      const finalized = await current.finalizeReview(review.documentId, []);
      if (filler) expect(finalized.chunks.length).toBeGreaterThan(1);
      const plan = current.anonymizedDocxPlan(review.documentId);
      const output = await anonymizeDocx(data, plan);
      expect(output.warnings).toEqual(["MEDIA_NOT_ANONYMIZED:1"]);

      expect(await new LocalOfficeDocumentTextExtractor().extract(output.data, DOCX_MEDIA_TYPE)).toBe(plan.expected);
      const files = parts(output.data);
      const all = [...files.values()].join("\n");
      for (const value of ["Kowalski", "Kowalskiego", "Nowak", "44051401359", "jan.kowalski@example.com", "Zieliński"]) {
        expect(all).not.toContain(value);
      }
      const body = files.get("word/document.xml")!;
      // The bold run holds the token; the namespaces Word needs (mc:Ignorable) stay.
      expect(body).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Powód: \[PII:PERSON:\d{4}\]<\/w:t>/u);
      expect(body).toContain('mc:Ignorable="w14"');
      expect(body).toContain('HYPERLINK "mailto:[PII:EMAIL:0001]"');
      expect(files.get("word/header3.xml")).toMatch(/Kancelaria \[PII:PERSON:\d{4}\]/u);
      expect(files.get("word/comments.xml")).toContain('w:author="Autor" w:initials="A"');
      expect(files.get("docProps/core.xml")).toContain("<dc:creator></dc:creator>");
      expect(files.get("word/_rels/document.xml.rels")).toContain('Target="mailto:[PII:EMAIL:0001]"');
    }
  });

  it.skipIf(!available)("a source read differently (an older reading) is refused, not guessed", async () => {
    const data = fixture();
    const current = service();
    const review = await current.review(data, DOCX_MEDIA_TYPE);
    await current.finalizeReview(review.documentId, []);
    const plan = current.anonymizedDocxPlan(review.documentId);
    await expect(anonymizeDocx(data, { ...plan, source: plan.source.split("\n\nNagłówek")[0]! })).rejects.toThrow(
      "DOCX_ANONYMIZED_SOURCE_CHANGED"
    );
  });
});

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("HTTP: download the anonymized .docx of a case file", () => {
  it.skipIf(!available)("gives the .docx with symbols to the case's user only; other files are refused", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-docx-anon-http-"));
    roots.push(root);
    const skills = fs.mkdtempSync(path.join(os.tmpdir(), "lex-docx-anon-skills-"));
    roots.push(skills);
    const store = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(store, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(store, auth, files);
    const uploads = new SecureCaseUploadStore({ rootDir: root });
    const data = fixture();
    const documents = service();
    const review = await documents.review(data, DOCX_MEDIA_TYPE);
    await documents.finalizeReview(review.documentId, []);
    const restoreDocument = vi.fn(async () => undefined);
    const app = createLexHttpApp({
      registry: new LexSkillRegistry(skills),
      modelCatalog: { list: async () => [] },
      authService: auth,
      caseFileStore: files,
      secureCaseUploadStore: uploads,
      caseAccessService: cases,
      documentService: { restoreDocument, anonymizedDocxPlan: (id: string) => documents.anonymizedDocxPlan(id) } as never
    } as never);
    const login = await auth.bootstrap({ loginName: "owner", displayName: "Owner", password: "Docx anonymized strong password 2026" });
    const context = { user: login.user, session: login.session };
    const localCase = await cases.createCase(context, "DOCX");
    const save = (filename: string, mediaType: string, body: Uint8Array) =>
      cases.withCaseDataKey(context, localCase.caseId, "WRITE", (caseDataKey) =>
        uploads.saveUpload({ caseId: localCase.caseId, filename, mediaType, data: body, caseDataKey, keyVersion: localCase.keyVersion })
      );
    const stored = await save("Pozew Kowalski.docx", DOCX_MEDIA_TYPE, data);
    const url = `/api/cases/${localCase.caseId}/files/${stored.uploadId}/anonymized-docx`;

    expect((await request(app).post(url).send({ documentId: review.documentId })).status).toBe(401);
    const response = await request(app).post(url).set("Authorization", `Bearer ${login.sessionToken}`).send({ documentId: review.documentId });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ filename: "Pozew Kowalski (zanonimizowany).docx", warnings: ["MEDIA_NOT_ANONYMIZED:1"] });
    expect(restoreDocument).toHaveBeenCalledWith(expect.objectContaining({ caseId: localCase.caseId, documentId: review.documentId }));
    const all = [...parts(Buffer.from(response.body.data, "base64")).values()].join("\n");
    for (const value of ["Kowalski", "Nowak", "44051401359", "Zieliński"]) expect(all).not.toContain(value);

    const pdf = await save("skan.pdf", "application/pdf", Buffer.from("%PDF-1.7"));
    const refused = await request(app)
      .post(`/api/cases/${localCase.caseId}/files/${pdf.uploadId}/anonymized-docx`)
      .set("Authorization", `Bearer ${login.sessionToken}`)
      .send({ documentId: review.documentId });
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: "DOCX_ANONYMIZED_MEDIA_UNSUPPORTED" });
    expect((await request(app).post(url).set("Authorization", `Bearer ${login.sessionToken}`).send({})).status).toBe(400);
  });
});
