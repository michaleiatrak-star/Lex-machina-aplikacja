import { describe, expect, it } from "vitest";
import { manualUpdateReleaseUrl } from "./MaintenancePanel.js";
import { ApiError, type UpdateStatusResponse } from "./api.js";

const status: UpdateStatusResponse = {
  currentVersion: "0.1.26",
  status: "AVAILABLE",
  checkedAt: "2026-10-10T00:00:00Z",
  latestVersion: "0.1.27",
  releaseUrl: "https://github.com/michaleiatrak-star/Lex-machina-aplikacja/releases/tag/v0.1.27"
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
