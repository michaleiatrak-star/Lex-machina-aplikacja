import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDirectImages, MAX_DIRECT_IMAGES } from "../src/direct-images.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const png = { name: "wyrok-skan.png", mediaType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUg==" };

describe("images sent as they are", () => {
  it("accepts PNG/JPEG base64 within the limits and rejects anything else", () => {
    expect(parseDirectImages(undefined)).toEqual([]);
    expect(parseDirectImages([png])).toEqual([png]);
    expect(parseDirectImages([{ ...png, mediaType: "image/gif" }])).toBeNull();
    expect(parseDirectImages([{ ...png, data: "<script>alert(1)</script>" }])).toBeNull();
    expect(parseDirectImages(Array.from({ length: MAX_DIRECT_IMAGES + 1 }, () => png))).toBeNull();
    expect(parseDirectImages([{ ...png, name: "a]\n[b" }])?.[0]?.name).toBe("a b");
  });

  async function run(vision: boolean) {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "anthropic",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      supportsImages: () => vision,
      async stream(received: ProviderStreamParams) {
        calls.push(received);
        return { fullText: "Na obrazie widać wyrok z 12 maja 2026 r." };
      }
    } as never);
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    await executor.execute({
      query: "Jakie daty są na tym dokumencie?",
      provider: "anthropic",
      model: "account/anthropic/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "LAIK",
      directImages: [png]
    } as never);
    return calls;
  }

  it("a model with vision gets the image and the note; a text model is told it cannot see it", async () => {
    const seen = await run(true);
    const first = seen[0]!;
    expect(first.messages.flatMap((message) => message.images ?? [])).toEqual([{ mediaType: "image/png", data: png.data }]);
    expect(JSON.stringify(first.messages)).toContain("OBRAZY PRZESŁANE BEZPOŚREDNIO");
    const blind = (await run(false))[0]!;
    expect(blind.messages.flatMap((message) => message.images ?? [])).toEqual([]);
    expect(JSON.stringify(blind.messages)).toContain("NIEDOSTARCZONE");
  }, 120_000);
});
