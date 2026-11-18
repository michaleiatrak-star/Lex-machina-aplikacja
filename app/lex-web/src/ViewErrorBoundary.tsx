import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "./i18n";

/**
 * A failure while drawing one part of the interface (an unexpected answer shape, a bad message)
 * stays in that part: a short notice with "Spróbuj ponownie" instead of an empty window that lost
 * the conversation on screen.
 */
export class ViewErrorBoundary extends Component<{ children: ReactNode; area: string }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: string } {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`LEX_VIEW_ERROR:${this.props.area}`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failed === null) return this.props.children;
    return (
      <div className="chat-inline-error view-error" role="alert">
        <p>{t("Nie udało się wyświetlić tej części ({area}). Dane nie zostały utracone.", { area: this.props.area })}</p>
        <button type="button" className="chat-secondary-action" onClick={() => this.setState({ failed: null })}>
          {t("Spróbuj ponownie")}
        </button>{" "}
        <button type="button" className="chat-link-button" onClick={() => window.location.reload()}>
          {t("Odśwież okno")}
        </button>
      </div>
    );
  }
}
