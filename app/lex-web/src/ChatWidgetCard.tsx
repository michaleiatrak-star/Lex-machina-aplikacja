import { useEffect, useRef, useState } from "react";
import { ApiError, chatWidgetFrameUrl, registerChatWidget } from "./api.js";
import { downloadBlob } from "./download-file.js";
import type { ChatWidget } from "./workspace-client.js";

type Props = {
  widget: ChatWidget;
  // window.sendPrompt(text) w widgecie: tekst jako kolejna wiadomość użytkownika.
  onPrompt?: (text: string) => void;
};

type WidgetMessage =
  | { type: "prompt"; text: string }
  | { type: "save"; filename: string; base64: string }
  | { type: "size"; height: number }
  | { type: "error"; message: string };

function readMessage(data: unknown, widgetId: string): WidgetMessage | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (raw.lexWidget !== widgetId) return null;
  if (raw.type === "prompt" && typeof raw.text === "string") return { type: "prompt", text: raw.text.slice(0, 20_000) };
  if (raw.type === "save" && typeof raw.filename === "string" && typeof raw.base64 === "string") {
    return { type: "save", filename: raw.filename.slice(0, 160), base64: raw.base64 };
  }
  if (raw.type === "size" && typeof raw.height === "number") return { type: "size", height: raw.height };
  if (raw.type === "error" && typeof raw.message === "string") return { type: "error", message: raw.message.slice(0, 300) };
  return null;
}

// Widget skilla w czacie: ramka z adresu runtime z własnym CSP (bez sieci, bez formularzy),
// sandbox bez same-origin, więc widget nie ma dostępu do aplikacji ani danych sprawy.
export function ChatWidgetCard({ widget, onPrompt }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [widgetId, setWidgetId] = useState("");
  const [height, setHeight] = useState(420);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    void registerChatWidget(widget)
      .then((result) => {
        if (!cancelled) setWidgetId(result.widgetId);
      })
      .catch((failure) => {
        if (!cancelled) setError(`Nie udało się otworzyć widgetu (${failure instanceof ApiError ? failure.code : String(failure)}).`);
      });
    return () => {
      cancelled = true;
    };
  }, [widget, reload]);

  useEffect(() => {
    if (!widgetId) return;
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = readMessage(event.data, widgetId);
      if (!message) return;
      if (message.type === "size") setHeight(Math.min(1400, Math.max(160, message.height + 8)));
      if (message.type === "error") setError(`Błąd w widgecie: ${message.message}`);
      if (message.type === "prompt") {
        if (onPrompt) {
          onPrompt(message.text);
          setStatus("Wysłano do czatu.");
        }
      }
      if (message.type === "save") {
        const bytes = Uint8Array.from(atob(message.base64), (char) => char.charCodeAt(0));
        void downloadBlob(new Blob([bytes]), message.filename)
          .then((saved) => setStatus(saved ? `Zapisano: ${saved}` : `Pobrano: ${message.filename}`))
          .catch((failure) => setError(`Nie udało się zapisać pliku (${failure instanceof ApiError ? failure.code : String(failure)}).`));
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [widgetId, onPrompt]);

  return (
    <section className="chat-widget-card" aria-label={`Widget: ${widget.title}`}>
      <header className="chat-widget-header">
        <strong>{widget.title}</strong>
        {widget.source ? <span className="field-help">{widget.source}</span> : null}
        <span className="chat-widget-actions">
          <button type="button" className="chat-secondary-action" onClick={() => setReload((value) => value + 1)}>
            Odśwież
          </button>
          <button type="button" className="chat-secondary-action" onClick={() => setOpen((value) => !value)}>
            {open ? "Zwiń" : "Rozwiń"}
          </button>
        </span>
      </header>
      {error ? <p className="chat-inline-error">{error}</p> : null}
      {open && widgetId ? (
        <iframe
          ref={frame}
          key={widgetId}
          className="chat-widget-frame"
          title={`Widget: ${widget.title}`}
          src={chatWidgetFrameUrl(widgetId)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height }}
        />
      ) : null}
      {status ? <p className="field-help" role="status">{status}</p> : null}
    </section>
  );
}
