import { currentLocale, t } from "./i18n";
import { useEffect, useState } from "react";
import { getApplicationDownloadProgress, type ApplicationDownloadProgress as Progress } from "./api.js";

export function downloadDescription(value: Progress): string {
  if (value.phase === "checking") return "Sprawdzam pobrane pliki…";
  if (value.phase === "ready") return t("Aktualizacja jest gotowa do instalacji.");
  if (value.phase === "failed") return t("Pobieranie zostało przerwane. Możesz spróbować ponownie.");
  const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 1 });
  return value.total ? `Pobieram aktualizację: ${mb(value.received)} z ${mb(value.total)} MB` : `Pobieram aktualizację: ${mb(value.received)} MB`;
}
export function ApplicationDownloadProgress() {
  const [value, setValue] = useState<Progress>({ phase: "idle", received: 0 });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await getApplicationDownloadProgress(); if (alive) setValue(next); } catch { /* Download request reports errors. */ }
      if (alive) timer = setTimeout(() => void poll(), 600);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const determinate = value.phase === "downloading" && value.total && value.total > 0;
  return <div className="update-prompt-progress">
    <p role="status">{downloadDescription(value)}</p>
    <progress aria-label={t("Pobieranie aktualizacji")} max={determinate ? value.total : undefined} value={determinate ? value.received : undefined} />
  </div>;
}
