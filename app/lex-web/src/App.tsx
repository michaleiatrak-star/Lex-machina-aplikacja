import MatterChatApp, {
  type SettingsRequest
} from "./MatterChatApp.js";
import { LocalAiSetupPanel } from "./LocalAiSetupPanel.js";
import { MaintenancePanel } from "./MaintenancePanel.js";
import { AccountSecurityPanel } from "./AccountSecurityPanel.js";
import { AdminUsersPanel } from "./AdminUsersPanel.js";
import { CaseAccessAdminPanel } from "./CaseAccessAdminPanel.js";
import { McpConnectorsPanel } from "./McpConnectorsPanel.js";
import { GOOGLE_INTEGRATION_VISIBLE, GoogleIntegrationPanel } from "./GoogleIntegrationPanel.js";
import { InvoiceSettingsPanel } from "./InvoiceSettingsPanel.js";
import { ServerAdminPanel } from "./ServerAdminPanel.js";
import { MyServerAccountPanel } from "./MyServerAccountPanel.js";
import { isDesktopShell } from "./api.js";
import { UpdatePrompt } from "./UpdatePrompt.js";
import type {
  AuthMeResponse,
  AuthenticatedUser
} from "./api.js";

export default function App({
  user,
  serverMode = false,
  onServerModeChanged,
  onAuthUpdated,
  settingsRequest,
  onLock,
  onLogout
}: {
  user: AuthenticatedUser;
  // Tryb serwerowy: bez funkcji lokalnych (CLI kont, modele lokalne), z planami i globalnymi kluczami API.
  serverMode?: boolean;
  onServerModeChanged?: (enabled: boolean) => void;
  onAuthUpdated: (
    value: AuthMeResponse
  ) => void;
  settingsRequest?: SettingsRequest | null;
  onLock: () => void;
  onLogout: () => void;
}) {
  return (
    <>
    {/* Aktualizacja wykryta wcześniej: pytanie przy starcie (desktop, administrator, bez trybu serwerowego). */}
    {isDesktopShell() && !serverMode && user.appRole === "ADMIN" ? <UpdatePrompt /> : null}
    <MatterChatApp
      user={user}
      serverMode={serverMode}
      settingsRequest={settingsRequest}
      onLock={onLock}
      onLogout={onLogout}
      settingsPanels={{
        // W trybie serwerowym model lokalny serwera instaluje i zatrzymuje administrator.
        localAi: serverMode && user.appRole !== "ADMIN" ? null : (
          <LocalAiSetupPanel
            user={user}
            embedded
          />
        ),
        // Tryb serwerowy dotyczy wdrożenia otwieranego przez przeglądarkę; w oknie aplikacji desktop panel jest ukryty.
        server:
          user.appRole === "ADMIN" && !isDesktopShell() ? (
            <ServerAdminPanel
              {...(onServerModeChanged
                ? { onModeChanged: onServerModeChanged }
                : {})}
            />
          ) : null,
        account: serverMode ? <MyServerAccountPanel /> : null,
        security: (
          <AccountSecurityPanel
            user={user}
            onAuthUpdated={
              onAuthUpdated
            }
          />
        ),
        users:
          user.appRole ===
          "ADMIN" ? (
            <>
              <AdminUsersPanel
                currentUserId={
                  user.userId
                }
              />
              <CaseAccessAdminPanel
                currentUserId={
                  user.userId
                }
              />
            </>
          ) : null,
        integrations: GOOGLE_INTEGRATION_VISIBLE ? <GoogleIntegrationPanel /> : null,
        mcp:
          user.appRole ===
          "ADMIN" ? (
            <McpConnectorsPanel />
          ) : null,
        invoices: <InvoiceSettingsPanel />,
        maintenance: (
          <MaintenancePanel
            user={user}
            embedded
          />
        )
      }}
    />
    </>
  );
}
