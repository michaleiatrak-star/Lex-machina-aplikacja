import { describe, expect, it } from "vitest";
import { provisionFailureText } from "./MatterChatApp.js";

describe("pobieranie klienta konta: komunikaty błędów", () => {
  it("nazywa przyczynę zamiast surowego kodu", () => {
    expect(provisionFailureText("ACCOUNT_SESSION_CLI_PROVISION_FAILED:google:1:ETIMEDOUT")).toContain("sieć lub serwer npm");
    expect(provisionFailureText("ACCOUNT_SESSION_COMMAND_TIMEOUT")).toContain("10 minut");
    expect(provisionFailureText("ACCOUNT_SESSION_CLI_PROVISIONER_NOT_AVAILABLE:xai")).toContain("brak npm");
    expect(provisionFailureText("")).toContain("nieznany błąd");
  });
});
