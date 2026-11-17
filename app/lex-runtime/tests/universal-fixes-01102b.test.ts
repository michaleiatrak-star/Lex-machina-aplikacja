import { describe, expect, it } from "vitest";
import { recordParties, subjectGoal, targetRecord } from "../src/record-parties.js";
import { processDocumentCitationMarkers } from "../src/document-citations.js";
import { questionTimeline, questionTimelinePrompt } from "../src/question-goals.js";

const HEADER = (signature: string, date: string, subject: string) =>
  `Sygn. akt: ${signature}\n\nPROTOKÓŁ\n\nDnia ${date} r.\n\nSąd Okręgowy w Katowicach\n\nna rozprawie rozpoznał sprawę\nz powództwa Jan Nowak\nprzeciwko Firma sp. z o.o.\no ${subject}\n\nRozprawę rozpoczęto o godz. 12:53`;

describe("the case subject from the record heading", () => {
  const xi = recordParties("a", HEADER("XI P 27/26", "13 listopada 2026", "wynagrodzenie za pracę, ekwiwalent za urlop,\nsprostowanie świadectwa pracy"))!;
  const vii = recordParties("b", HEADER("VII P 94/25", "17 marca 2026", "odszkodowanie"))!;
  it("reads the claims after 'o' up to the hearing notes", () => {
    expect(xi.subject).toBe("wynagrodzenie za pracę, ekwiwalent za urlop, sprostowanie świadectwa pracy");
  });
  it("targets the case the question names, else the newest record", () => {
    expect(targetRecord([vii, xi], "pismo w sprawie VII P 94/25")!.signature).toBe("VII P 94/25");
    expect(targetRecord([vii, xi], "pismo do sądu")!.signature).toBe("XI P 27/26");
  });
  it("the goal names only the heading's claims", () => {
    expect(subjectGoal(xi)).toMatch(/o wynagrodzenie za pracę.*nie dopisywać żądań spoza przedmiotu sprawy/u);
    expect(subjectGoal(null)).toBeNull();
  });
});

describe("dates in a sentence the model already linked get no second link", () => {
  const attachments = [{ documentId: "d1", title: "protokół", sourceScope: "MANUAL", chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "Dnia 17 marca 2026 r. świadek zeznał: Było zarządzenie wewnętrzne u pozwanej." }] }] as any;
  it("skips the date next to the model's own marker, links a bare one", () => {
    const linked = processDocumentCitationMarkers("Świadek 17 marca 2026 r. zeznał: „Było zarządzenie wewnętrzne u pozwanej” [[LEXDOC:d1:0]].", attachments);
    expect(linked.citations).toHaveLength(1);
    const bare = processDocumentCitationMarkers("Rozprawa odbyła się 17 marca 2026 r. w Katowicach.", attachments);
    expect(bare.citations).toHaveLength(1);
  });
});

describe("the timeline names the event date for the wording", () => {
  it("asks for the wording on the earliest event", () => {
    const timeline = questionTimeline("Wykaż, że od 09.09.2024 do 07.10.2024 byłem na L4.", [{ documentId: "l4", text: "2024-09-09 … 2024-10-07" }])!;
    expect(questionTimelinePrompt(timeline)).toContain("asOf=2024-09-09");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dockerDesktopSettingsFiles, hideDockerDashboardOnStart } from "../src/searxng-local.js";
describe("Docker Desktop starts without its dashboard", () => {
  it("sets the setting in both settings files, keeping the others", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-"));
    const store = path.join(dir, "settings-store.json");
    const legacy = path.join(dir, "settings.json");
    fs.writeFileSync(store, JSON.stringify({ AutoStart: true }));
    fs.writeFileSync(legacy, JSON.stringify({ memoryMiB: 4096 }));
    expect(hideDockerDashboardOnStart([store, legacy, path.join(dir, "missing.json")])).toBe(2);
    expect(JSON.parse(fs.readFileSync(store, "utf8"))).toEqual({ AutoStart: true, OpenUIOnStartupDisabled: true });
    expect(JSON.parse(fs.readFileSync(legacy, "utf8"))).toEqual({ memoryMiB: 4096, openUIOnStartupDisabled: true });
    expect(hideDockerDashboardOnStart([store, legacy])).toBe(0);
  });
  it("knows where Docker Desktop keeps its settings", () => {
    expect(dockerDesktopSettingsFiles("win32", { APPDATA: "C:\\U\\AppData\\Roaming" }, "C:\\U")[0]).toMatch(/Docker[\\/]settings-store\.json$/u);
    expect(dockerDesktopSettingsFiles("darwin", {}, "/Users/u")[0]).toBe("/Users/u/Library/Group Containers/group.com.docker/settings-store.json");
  });
});

import { execFileSync } from "node:child_process";
import { LocalOfficeDocumentTextExtractor, DOCX_MEDIA_TYPE } from "../src/office-document-extractor.js";
describe("a Word file: its text without OCR, only a pasted picture for OCR", () => {
  it("lists the large embedded pictures, not the logos", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docx-"));
    const file = path.join(dir, "a.docx");
    execFileSync("python3", ["-c", `
import zipfile,os,sys
with zipfile.ZipFile(sys.argv[1],"w") as z:
    z.writestr("[Content_Types].xml","<Types/>")
    z.writestr("word/document.xml","<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>Ala</w:t></w:r></w:p></w:body></w:document>")
    z.writestr("word/media/scan.jpeg", b"\\xff\\xd8"+os.urandom(40000))
    z.writestr("word/media/logo.png", b"\\x89PNG"+os.urandom(200))
`, file]);
    const extractor = new LocalOfficeDocumentTextExtractor();
    const data = new Uint8Array(fs.readFileSync(file));
    expect(await extractor.extract(data, DOCX_MEDIA_TYPE)).toContain("Ala");
    const images = await extractor.images(data, DOCX_MEDIA_TYPE);
    expect(images.map((image) => [image.name, image.mediaType])).toEqual([["word/media/scan.jpeg", "image/jpeg"]]);
    expect(images[0]!.data.byteLength).toBe(40002);
  });
});

import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
describe("a page kept whole runs no recognizer", () => {
  it("returns the text as it is even when the recognizer would fail", async () => {
    const failing = { recognize: async () => { throw new Error("PRIVACY_RECOGNIZER_UNAVAILABLE:test"); } } as any;
    const text = "Jan Kowalski, PESEL 84030315255, ul. Długa 5.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), failing).pseudonymize(text, [{ start: 0, end: text.length, action: "KEEP" } as any]);
    expect(result.text).toBe(text);
    expect(result.findings).toEqual([]);
  });
});
