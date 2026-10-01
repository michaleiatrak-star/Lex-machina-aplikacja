import { describe, expect, it } from "vitest";
import { provisionFailureText } from "./MatterChatApp.js";

describe("pobieranie klienta konta: komunikaty błędów", () => {
  it("nazywa przyczynę zamiast surowego kodu", () => {
    expect(provisionFailureText("ACCOUNT_SESSION_CLI_PROVISION_FAILED:google:1:npm error code ETIMEDOUT")).toContain("brak połączenia z serwerem npm");
    const missingNode = provisionFailureText(
      "ACCOUNT_SESSION_CLI_PROVISION_FAILED:xai:1:npm error 'node' is not recognized as an internal or external command"
    );
    expect(missingNode).toContain("brak wymaganego programu");
    expect(missingNode).toContain("'node' is not recognized");
    expect(provisionFailureText("ACCOUNT_SESSION_COMMAND_TIMEOUT")).toContain("10 minut");
    expect(provisionFailureText("ACCOUNT_SESSION_CLI_PROVISIONER_NOT_AVAILABLE:xai")).toContain("brak npm");
    expect(provisionFailureText("")).toContain("nieznany błąd");
  });
});
