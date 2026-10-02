import { timingSafeEqual } from "node:crypto";
import type { LocalAuthService } from "../auth/service.js";
import { AuthError } from "../auth/service.js";
import {
  generateGoogleRecoverySecret,
  validateNewPassword
} from "../auth/crypto.js";
import type {
  AuthClock,
  AuthenticatedContext,
  AuthSuccess,
  GoogleRecoveryLinkView
} from "../auth/types.js";
import {
  GOOGLE_SCOPES,
  loadGoogleOAuthConfig,
  type GoogleOAuthClientConfig
} from "./config.js";
import {
  createAppDataFile,
  deleteAppDataFile,
  readAppDataFile
} from "./drive-appdata.js";
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  GoogleOAuthError,
  randomUrlToken,
  revokeGoogleToken,
  validateIdTokenFromTokenEndpoint,
  type FetchLike
} from "./oauth.js";

export type GoogleRecoveryAuth = Pick<
  LocalAuthService,
  | "reauthenticate"
  | "linkGoogleRecovery"
  | "unlinkGoogleRecovery"
  | "googleRecoveryStatus"
  | "recoverAccountWithGoogle"
>;

export class GoogleIntegrationError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number
  ) {
    super(code);
    this.name = "GoogleIntegrationError";
  }
}

const RECOVERY_SCOPES = [
  ...GOOGLE_SCOPES.identity,
  ...GOOGLE_SCOPES.recoveryEscrow
];
const ESCROW_FORMAT = "lex-machina-google-recovery-v1";
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 16;

type FlowStatus = "PENDING" | "DONE" | "FAILED";

type FlowBase = {
  flowId: string;
  flowToken: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
  status: FlowStatus;
  error?: string;
};

type LinkFlow = FlowBase & {
  purpose: "link";
  userId: string;
  sessionId: string;
  result?: GoogleRecoveryLinkView;
};

type RecoverFlow = FlowBase & {
  purpose: "recover";
  loginName: string;
  newPassword?: string;
  result?: AuthSuccess;
};

type Flow = LinkFlow | RecoverFlow;

export type GoogleFlowStart = {
  flowId: string;
  flowToken: string;
  authorizationUrl: string;
};

export type GoogleFlowResult<T> =
  | { status: "PENDING" }
  | { status: "FAILED"; error: string }
  | { status: "DONE"; result: T };

function escrowFileName(userId: string): string {
  return `lex-machina-recovery-${userId}.json`;
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return (
    left.byteLength === right.byteLength &&
    timingSafeEqual(left, right)
  );
}

export class GoogleRecoveryController {
  private readonly flows = new Map<string, Flow>();
  private readonly fetchImpl: FetchLike;
  private readonly clock: AuthClock;
  private readonly loadConfig: () => GoogleOAuthClientConfig | null;

  constructor(
    private readonly auth: GoogleRecoveryAuth,
    options: {
      fetch?: FetchLike;
      clock?: AuthClock;
      loadConfig?: () => GoogleOAuthClientConfig | null;
    } = {}
  ) {
    this.fetchImpl =
      options.fetch ?? ((input, init) => fetch(input, init));
    this.clock = options.clock ?? { now: () => Date.now() };
    this.loadConfig =
      options.loadConfig ?? (() => loadGoogleOAuthConfig());
  }

  private config(): GoogleOAuthClientConfig {
    let config: GoogleOAuthClientConfig | null;
    try {
      config = this.loadConfig();
    } catch {
      config = null;
    }
    if (!config) {
      throw new GoogleIntegrationError(
        "GOOGLE_NOT_CONFIGURED",
        503
      );
    }
    return config;
  }

  isConfigured(): boolean {
    try {
      return this.loadConfig() !== null;
    } catch {
      return false;
    }
  }

  status(actor: AuthenticatedContext): {
    configured: boolean;
    recovery: GoogleRecoveryLinkView | null;
  } {
    return {
      configured: this.isConfigured(),
      recovery: this.auth.googleRecoveryStatus(
        actor.user.userId
      )
    };
  }

  private purgeExpired(): void {
    const now = this.clock.now();
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt <= now) {
        if (flow.purpose === "recover") {
          delete flow.newPassword;
        }
        this.flows.delete(id);
      }
    }
  }

  private open(
    config: GoogleOAuthClientConfig,
    redirectUri: string,
    flow:
      | Omit<LinkFlow, keyof FlowBase>
      | Omit<RecoverFlow, keyof FlowBase>
  ): GoogleFlowStart {
    this.purgeExpired();
    const pending = [...this.flows.values()].filter(
      (item) => item.status === "PENDING"
    ).length;
    if (pending >= MAX_PENDING_FLOWS) {
      throw new GoogleIntegrationError(
        "GOOGLE_TOO_MANY_PENDING_FLOWS",
        429
      );
    }
    const pkce = createPkcePair();
    const base: FlowBase = {
      flowId: randomUrlToken(16),
      flowToken: randomUrlToken(),
      state: randomUrlToken(),
      nonce: randomUrlToken(),
      codeVerifier: pkce.verifier,
      redirectUri,
      expiresAt: this.clock.now() + FLOW_TTL_MS,
      status: "PENDING"
    };
    this.flows.set(base.flowId, { ...base, ...flow } as Flow);
    return {
      flowId: base.flowId,
      flowToken: base.flowToken,
      authorizationUrl: buildAuthorizationUrl({
        config,
        redirectUri,
        scopes: RECOVERY_SCOPES,
        state: base.state,
        nonce: base.nonce,
        codeChallenge: pkce.challenge
      })
    };
  }

  async startLink(
    actor: AuthenticatedContext,
    password: string,
    redirectUri: string
  ): Promise<GoogleFlowStart> {
    const config = this.config();
    await this.auth.reauthenticate(
      actor,
      password,
      "google_recovery_link"
    );
    return this.open(config, redirectUri, {
      purpose: "link",
      userId: actor.user.userId,
      sessionId: actor.session.sessionId
    });
  }

  startRecovery(
    loginName: string,
    newPassword: string,
    redirectUri: string
  ): GoogleFlowStart {
    const config = this.config();
    try {
      validateNewPassword(newPassword);
    } catch {
      throw new AuthError("INVALID_RECOVERY_REQUEST", 400);
    }
    // Starting never reveals whether the login exists or is linked.
    return this.open(config, redirectUri, {
      purpose: "recover",
      loginName: loginName.slice(0, 256),
      newPassword
    });
  }

  async unlink(
    actor: AuthenticatedContext,
    password: string
  ): Promise<{ unlinked: boolean }> {
    await this.auth.reauthenticate(
      actor,
      password,
      "google_recovery_unlink"
    );
    // The secret left in Drive is useless without the local envelope.
    return {
      unlinked: this.auth.unlinkGoogleRecovery(actor)
    };
  }

  // Returns whether the browser page should report success.
  async handleCallback(query: {
    state?: unknown;
    code?: unknown;
    error?: unknown;
  }): Promise<boolean> {
    this.purgeExpired();
    const state =
      typeof query.state === "string" ? query.state : "";
    const flow = [...this.flows.values()].find(
      (item) =>
        item.status === "PENDING" &&
        state.length > 0 &&
        sameToken(item.state, state)
    );
    if (!flow) {
      return false;
    }
    const fail = (code: string): false => {
      flow.status = "FAILED";
      flow.error = code;
      if (flow.purpose === "recover") {
        delete flow.newPassword;
      }
      return false;
    };
    if (typeof query.code !== "string" || query.error) {
      return fail("GOOGLE_CONSENT_DENIED");
    }

    let accessToken: string | undefined;
    try {
      const config = this.config();
      const tokens = await exchangeAuthorizationCode({
        fetch: this.fetchImpl,
        config,
        code: query.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri
      });
      accessToken = tokens.accessToken;
      // Granular consent lets the user untick the Drive app folder.
      if (
        !GOOGLE_SCOPES.recoveryEscrow.every((scope) =>
          tokens.scopes.includes(scope)
        )
      ) {
        return fail("GOOGLE_SCOPE_DENIED");
      }
      if (!tokens.idToken) {
        return fail("GOOGLE_ID_TOKEN_INVALID");
      }
      const identity = validateIdTokenFromTokenEndpoint({
        idToken: tokens.idToken,
        clientId: config.clientId,
        nonce: flow.nonce,
        nowMs: this.clock.now()
      });

      if (flow.purpose === "link") {
        flow.result = await this.completeLink(
          flow,
          identity,
          tokens.accessToken
        );
      } else {
        const newPassword = flow.newPassword ?? "";
        delete flow.newPassword;
        const token = tokens.accessToken;
        flow.result = await this.auth.recoverAccountWithGoogle({
          loginName: flow.loginName,
          googleSub: identity.sub,
          newPassword,
          readSecret: (fileId) =>
            this.readEscrow(token, fileId)
        });
      }
      flow.status = "DONE";
      return true;
    } catch (error) {
      return fail(
        error instanceof GoogleOAuthError ||
          error instanceof GoogleIntegrationError ||
          error instanceof AuthError
          ? error.code
          : "GOOGLE_FLOW_FAILED"
      );
    } finally {
      // Recovery keeps no standing Google access.
      if (accessToken) {
        await revokeGoogleToken(this.fetchImpl, accessToken);
      }
    }
  }

  private async completeLink(
    flow: LinkFlow,
    identity: { sub: string; email: string },
    accessToken: string
  ): Promise<GoogleRecoveryLinkView> {
    const secret = generateGoogleRecoverySecret();
    let fileId: string | undefined;
    try {
      fileId = await createAppDataFile({
        fetch: this.fetchImpl,
        accessToken,
        name: escrowFileName(flow.userId),
        content: JSON.stringify({
          format: ESCROW_FORMAT,
          userId: flow.userId,
          secret: secret.toString("base64url")
        })
      });
      return await this.auth.linkGoogleRecovery({
        userId: flow.userId,
        sessionId: flow.sessionId,
        googleSub: identity.sub,
        googleEmail: identity.email,
        secret,
        driveFileId: fileId
      });
    } catch (error) {
      if (fileId) {
        await deleteAppDataFile({
          fetch: this.fetchImpl,
          accessToken,
          fileId
        });
      }
      throw error;
    } finally {
      secret.fill(0);
    }
  }

  private async readEscrow(
    accessToken: string,
    fileId: string
  ): Promise<Buffer> {
    const text = await readAppDataFile({
      fetch: this.fetchImpl,
      accessToken,
      fileId
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      parsed.format !== ESCROW_FORMAT ||
      typeof parsed.secret !== "string"
    ) {
      throw new GoogleOAuthError("GOOGLE_ESCROW_INVALID");
    }
    // A file from another user or account fails the envelope's AAD check.
    return Buffer.from(parsed.secret, "base64url");
  }

  result(
    flowId: string,
    flowToken: string
  ): GoogleFlowResult<AuthSuccess | GoogleRecoveryLinkView> {
    this.purgeExpired();
    const flow = this.flows.get(flowId);
    if (!flow || !sameToken(flow.flowToken, flowToken)) {
      throw new GoogleIntegrationError(
        "GOOGLE_FLOW_NOT_FOUND",
        404
      );
    }
    if (flow.status === "PENDING") {
      return { status: "PENDING" };
    }
    // A finished flow is read once.
    this.flows.delete(flowId);
    if (flow.status === "FAILED" || !flow.result) {
      return {
        status: "FAILED",
        error: flow.error ?? "GOOGLE_FLOW_FAILED"
      };
    }
    return { status: "DONE", result: flow.result };
  }
}
