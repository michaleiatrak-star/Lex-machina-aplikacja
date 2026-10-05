import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { resumeHostThread, SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

async function turn(): Promise<ProviderStreamParams> {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "host-thread",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Art. 286 KK — oszustwo." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  await executor.execute({
    query: "Czy to oszustwo z art. 286 KK?",
    provider: "openai",
    model: "account/openai/default",
    accountSessionKey: "case_0001",
    primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    modelSelectsSkills: true,
    mode: "PRAWNIK"
  });
  return calls[0]!;
}

describe("host CLI thread of an account session", () => {
  afterEach(() => {
    delete process.env.LEX_ACCOUNT_RESUME;
  });

  it("is off by default: the app sends the instructions and the thread itself", async () => {
    expect(resumeHostThread({})).toBe(false);
    const params = await turn();
    expect(params.accountContinuity).toBe("none");
    expect(params.continuityKey).toBeUndefined();
  }, 60_000);

  it("LEX_ACCOUNT_RESUME=1 resumes the matter's thread as before", async () => {
    process.env.LEX_ACCOUNT_RESUME = "1";
    const params = await turn();
    expect(params.continuityKey).toBe("case_0001");
    expect(params.accountContinuity).toBeUndefined();
  }, 60_000);
});
