import { describe, expect, it } from "vitest";
import { resourceReadOrigins } from "../src/session-executor.js";

describe("who read each module (task 10B)", () => {
  it("separates the application's preloads from the model's own reads, first read counts", () => {
    expect(
      resourceReadOrigins([
        { type: "resource_read", target: "shared/MOD-DOBRO-DZIECKA.md", status: "OK", detail: { native: true } },
        { type: "resource_read", target: "references/AUTOMAT-STANOW.md", status: "OK", detail: { detail: "runtime-preload;carried-from:CP-1a" } },
        { type: "resource_read", target: "references/AUTOMAT-STANOW.md", status: "OK", detail: { native: true } },
        { type: "resource_read", target: "references/brak.md", status: "DEGRADED" },
        { type: "skill_read", target: "pisma-procesowe-v3", status: "OK" }
      ])
    ).toEqual([
      { resource: "shared/MOD-DOBRO-DZIECKA.md", by: "MODEL" },
      { resource: "references/AUTOMAT-STANOW.md", by: "APLIKACJA" }
    ]);
  });
});
