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
  // Tryb serwerowy: bez funkcji lokalnych (CLI kont, modele lokalne), z planami i BYOK.
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
    <MatterChatApp
      user={user}
      serverMode={serverMode}
      settingsRequest={settingsRequest}
      onLock={onLock}
      onLogout={onLogout}
      settingsPanels={{
        localAi: serverMode ? null : (
          <LocalAiSetupPanel
            user={user}
            embedded
          />
        ),
        server:
          user.appRole === "ADMIN" ? (
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
  );
}
