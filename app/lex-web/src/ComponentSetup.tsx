import { currentLocale, t } from "./i18n";
import { useEffect, useState, type ReactNode } from "react";
import { isDesktopShell } from "./api.js";

type Setup = { phase: "pending" | "running" | "done" | "failed" | "unneeded"; progress?: { message?: string; step?: number; received?: number } };
function invoke<T>(command: string): Promise<T> {
  return (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<T> } }).__TAURI_INTERNALS__.invoke(command);
}
export function ComponentSetupView({ value, error, onStart, onFinish }: { value: Setup; error: string; onStart: () => void; onFinish: () => void }) {
  const running = value.phase === "running";
  const done = value.phase === "done";
  return <main className="component-setup"><section aria-labelledby="setup-title">
    <span className="component-setup-brand">LEX MACHINA</span>
    <h1 id="setup-title">{done ? "Wszystko gotowe" : "Przygotowanie aplikacji"}</h1>
    <p>{done ? t("Możesz już otworzyć aplikację.") : t("Sprawdzimy, które narzędzia są już na komputerze. Pobierzemy tylko brakujące lub wymagające aktualizacji.")}</p>
    {running ? <>
      <p role="status">{value.progress?.message || t("Sprawdzam, co trzeba przygotować…")}</p>
      <progress aria-label={t("Przygotowanie aplikacji")} />
      {value.progress?.received ? <p>{t("Pobrano")} {(value.progress.received / 1024 / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} {t("MB bieżącego pliku")}</p> : null}
      <p className="component-setup-note">{t("Może to potrwać kilka minut. Zamknięcie aplikacji przerwie przygotowanie; przy kolejnym otwarciu możesz spróbować ponownie.")}</p>
    </> : null}
    {value.phase === "failed" || error ? <p role="alert">{error || t("Nie udało się dokończyć przygotowania. Sprawdź połączenie z internetem i wolne miejsce na dysku, a potem spróbuj ponownie.")}</p> : null}
    {!running && !done ? <button onClick={onStart}>{value.phase === "failed" ? t("Spróbuj ponownie") : t("Przygotuj aplikację")}</button> : null}
    {done ? <button onClick={onFinish}>{t("Otwórz Lex Machina")}</button> : null}
    <p className="component-setup-note">{t("Twoje sprawy i dokumenty pozostają na miejscu.")}</p>
  </section></main>;
}
export function ComponentSetup({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Setup | null>(isDesktopShell() ? null : { phase: "unneeded" });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isDesktopShell()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await invoke<Setup>("component_setup_status");
        if (alive) { setValue(next); setError(""); }
        if (alive && next.phase !== "unneeded") timer = setTimeout(() => void poll(), 700);
      } catch {
        if (alive) { setValue({ phase: "failed" }); setError(t("Nie udało się sprawdzić przygotowania aplikacji. Zamknij ją i otwórz ponownie.")); }
      }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  if (value?.phase === "unneeded") return <>{children}</>;
  if (!value) return <main className="component-setup"><p role="status">{t("Sprawdzam przygotowanie aplikacji…")}</p></main>;
  const action = async (command: string) => {
    setError("");
    try { await invoke(command); setValue(await invoke<Setup>("component_setup_status")); }
    catch { setError(t("Nie udało się rozpocząć tego kroku. Zamknij aplikację i spróbuj ponownie.")); }
  };
  return <ComponentSetupView value={value} error={error} onStart={() => void action("component_setup_start")} onFinish={() => void action("component_setup_finish")} />;
}
