import type {
  CaseRole
} from "./auth/types.js";

export type CaseKind =
  | "MATTER"
  | "FIRM_KNOWLEDGE";
import type {
  CaseKeyEnvelope
} from "./case-crypto.js";

export type StoredUserSharingKeys = {
  userId: string;
  algorithm: "X25519";
  publicKeyDer: Buffer;
  privateKeyWrapNonce: Buffer;
  privateKeyWrapCiphertext: Buffer;
  privateKeyWrapTag: Buffer;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredCaseRecord = {
  caseId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  keyVersion: number;
  caseKind: CaseKind;
  displayName?: string;
  archivedAt?: string;
};

export type StoredCaseAccess = {
  caseId: string;
  userId: string;
  role: CaseRole;
  canReidentify: boolean;
  envelope: CaseKeyEnvelope;
  grantedByUserId: string;
  grantedAt: string;
};

// Administrator overview of who may open which case. Metadata only: no case
// key, envelope or content; changes still go through the case OWNER, who
// holds the case key needed to wrap it for another user.
export type CaseAccessOverviewItem = {
  caseId: string;
  caseKind: CaseKind;
  displayName?: string;
  archivedAt?: string;
  updatedAt: string;
  viewerRole?: CaseRole;
  canManage: boolean;
  members: Array<{
    userId: string;
    loginName: string;
    displayName: string;
    status: string;
    role: CaseRole;
    canReidentify: boolean;
    grantedAt: string;
  }>;
};

export type CaseListItem =
  StoredCaseRecord & {
    role: CaseRole;
    canReidentify: boolean;
  };
