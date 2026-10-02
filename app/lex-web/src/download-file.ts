import { isDesktopShell, saveToDownloads } from "./api.js";

// Desktop: the WebView silently ignores <a download> of a blob URL, so a "downloaded"
// document never reached the disk. There the runtime saves the file in Downloads and
// the saved path is returned; in a browser the regular download is used (null).
export async function downloadBlob(
  blob: Blob,
  filename: string
): Promise<string | null> {
  if (isDesktopShell()) {
    return (await saveToDownloads(blob, filename)).path;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking at once can cancel the download before the browser reads the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}
