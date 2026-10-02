import { describe, expect, it } from "vitest";
import { artifactStemProblem, splitArtifactFilename } from "./artifact-filename.js";

describe("artifact filename", () => {
  it("splits the extension off", () => {
    expect(splitArtifactFilename("Pozew.v2.docx")).toEqual({ stem: "Pozew.v2", extension: ".docx" });
    expect(splitArtifactFilename(".docx")).toEqual({ stem: ".docx", extension: "" });
  });

  it("accepts a Polish name and rejects Windows-invalid ones", () => {
    expect(artifactStemProblem("Wezwanie do zapłaty – Kowalski", ".docx")).toBe("");
    for (const stem of ["", "a/b", "a:b", "a?b", "a|b", "CON", "lpt1", "pismo.", "a".repeat(180)]) {
      expect(artifactStemProblem(stem, ".docx"), stem).not.toBe("");
    }
  });
});
