import { describe, expect, it } from "vitest";
import { friendlyError, manualUpdateInstruction, manualUpdateReleaseUrl } from "./MaintenancePanel.js";
import { ApiError, type UpdateStatusResponse } from "./api.js";

const status: UpdateStatusResponse = {
  currentVersion: "0.1.30",
  status: "AVAILABLE",
  checkedAt: "2026-10-10T00:00:00Z",
  latestVersion: "0.1.31",
  releaseUrl: "https://github.com/michaleiatrak-star/Lex-machina-aplikacja/releases/tag/v0.1.31"
};

describe("manualUpdateReleaseUrl (macOS: update by opening the new .pkg)", () => {
  it("opens the discovered release page when the runtime asks for a manual install", () => {
    const error = new ApiError("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED", 409);
    expect(manualUpdateReleaseUrl(error, status)).toBe(status.releaseUrl);
  });

  it("does nothing for other errors or without a release page", () => {
    expect(manualUpdateReleaseUrl(new ApiError("APPLICATION_UPDATE_NOT_AVAILABLE", 409), status)).toBeNull();
    expect(
      manualUpdateReleaseUrl(new ApiError("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED", 409), {
        ...status,
        releaseUrl: undefined
      })
    ).toBeNull();
    expect(manualUpdateReleaseUrl(new ApiError("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED", 409), null)).toBeNull();
  });

  it("accepts only an https GitHub release page", () => {
    const error = new ApiError("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED", 409);
    for (const releaseUrl of [
      "http://github.com/owner/repo/releases/tag/v1",
      "https://github.com.evil.example/owner/repo/releases/tag/v1",
      "https://github.com/owner/repo/archive/v1.zip",
      "javascript:alert(1)"
    ]) {
      expect(manualUpdateReleaseUrl(error, { ...status, releaseUrl })).toBeNull();
    }
  });
});

describe("manualUpdateInstruction", () => {
  it("names the installer of the user's system", () => {
    expect(manualUpdateInstruction("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toContain(".pkg");
    expect(manualUpdateInstruction("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0")).toContain("Online-x64-Setup.exe");
  });
});

describe("MaintenancePanel friendlyError", () => {
  it("brak instalatora w wydaniu nie jest opisywany jako błąd Authenticode", () => {
    const text = friendlyError(new Error("APPLICATION_UPDATE_INSTALLER_NOT_VERIFIED"));
    expect(text).toContain("nie zawiera instalatora");
    expect(text).not.toContain("Authenticode");
  });

  it("błędy podpisu nadal wskazują politykę Authenticode", () => {
    expect(friendlyError(new Error("APPLICATION_UPDATE_SIGNER_NOT_TRUSTED"))).toContain("Authenticode");
  });

  it("blokada kanału skilli przez politykę podpisu ma własny komunikat", () => {
    expect(friendlyError(new Error("SKILL_CHANNEL_SIGNED_POLICY_BLOCKED"))).toContain("podpisanych skilli");
  });
});
