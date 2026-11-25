export type OrderedCaseWorkflowId =
  | "EVIDENCE_ANALYSIS_V1"
  | "WITNESS_QUESTIONING_V1";

export const ORDERED_CASE_WORKFLOW_SEQUENCES:
  Readonly<
    Record<
      OrderedCaseWorkflowId,
      readonly string[]
    >
  > = {
    EVIDENCE_ANALYSIS_V1: [
      "AD-KROK0-BLOKADA",
      "AD-KROK0a-MODE",
      "AD-KROK0b-SDVER",
      "AD-KROK0c-STINIT",
      "AD-KROK1-INTAKE",
      "AD-KROK2-ROUTER",
      "AD-BLOKG-STRONY",
      "AD-BLOKJ-LAPSUSY",
      "AD-BLOKH-DIS",
      "AD-KROK3-WYKONANIE",
      "AD-KROK4-DASHBOARD"
    ],
    WITNESS_QUESTIONING_V1: [
      "PRE-W1a-SD-VER",
      "PRE-W1a.4-RZ-SHOW",
      "KROK-PRE-W1-INTELLIGENCE",
      "KROK-0-KONTEKST",
      "W1-INTAKE",
      "W1-SUPPLEMENT",
      "W2-THESES-AND-MODEL",
      "CHECKPOINT-W2",
      "W3-QUESTIONS",
      "W4-REHEARSAL",
      "W5-BINDER",
      "W6-LIVE-DIRECT"
    ]
  } as const;

const OPTIONAL_CHECKPOINTS:
  Readonly<
    Record<
      OrderedCaseWorkflowId,
      ReadonlySet<string>
    >
  > = {
    EVIDENCE_ANALYSIS_V1:
      new Set([
        "AD-BLOKG-STRONY",
        "AD-BLOKJ-LAPSUSY",
        "AD-BLOKH-DIS"
      ]),
    WITNESS_QUESTIONING_V1:
      new Set([
        "W1-SUPPLEMENT",
        "W4-REHEARSAL",
        "W5-BINDER",
        "W6-LIVE-DIRECT"
      ])
  };

export type OrderedCaseCheckpointOutcome =
  | "DONE"
  | "NA";

export type OrderedCaseWorkflowEvent = {
  sequence: number;
  at: string;
  checkpoint: string;
  outcome:
    OrderedCaseCheckpointOutcome;
  auditRefs: string[];
  reason?: string;
};

export type OrderedCaseWorkflowState = {
  schemaVersion: 1;
  workflowId:
    OrderedCaseWorkflowId;
  caseId: string;
  revision: number;
  status:
    | "ACTIVE"
    | "COMPLETE";
  closedCheckpoints: string[];
  history:
    OrderedCaseWorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  // What each closed step established (its answer), for the later steps (task 03.4): a local
  // model with a short history does not lose the earlier steps.
  findings?: Record<string, { text: string; at: string }>;
};

const FINDING_MAX = 12_000;
const FINDINGS_MAX = 16;

/** The closed step's answer kept for the later steps (the disclaimer dropped, bounded). */
export function withOrderedFinding(input: OrderedCaseWorkflowState, checkpoint: string, answer: string, at = new Date().toISOString()): OrderedCaseWorkflowState {
  const text = answer.replace(/\n-{3,}\n⚖️[\s\S]*$/u, "").replace(/\n{3,}/gu, "\n\n").trim().slice(0, FINDING_MAX);
  if (!text || input.findings?.[checkpoint]?.text === text) return input;
  const entries = Object.entries({ ...(input.findings ?? {}), [checkpoint]: { text, at } }).slice(-FINDINGS_MAX);
  return { ...input, findings: Object.fromEntries(entries) };
}

/** The earlier steps' findings for the step now running, in the workflow's order, within the budget. */
export function orderedFindingsPrompt(state: Pick<OrderedCaseWorkflowState, "workflowId" | "findings">, current: string, budget: number): string | null {
  const order = ORDERED_CASE_WORKFLOW_SEQUENCES[state.workflowId] as readonly string[];
  const before = order.slice(0, Math.max(0, order.indexOf(current))).filter((checkpoint) => state.findings?.[checkpoint]);
  if (!before.length) return null;
  const total = before.reduce((sum, checkpoint) => sum + state.findings![checkpoint]!.text.length + 40, 0);
  const share = total <= budget ? Number.POSITIVE_INFINITY : Math.max(800, Math.floor(budget / before.length));
  return [
    "# USTALENIA Z ZAMKNIĘTYCH KROKÓW TEJ SPRAWY (zapisane przez aplikację)",
    "Wyniki wcześniejszych kroków tej procedury: opieraj na nich ten krok; nie ustalaj ich od nowa i nie pomijaj; rozbieżność z dokumentami wskaż wprost.",
    ...before.map((checkpoint) => {
      const text = state.findings![checkpoint]!.text;
      return `## ${checkpoint}\n${text.length > share ? `${text.slice(0, share)}\n[… skrócono: ${text.length - share} znaków]` : text}`;
    })
  ].join("\n\n");
}

export type OrderedCaseExecutionPermit = {
  workflowId:
    OrderedCaseWorkflowId;
  caseId: string;
  revision: number;
  checkpoint: string;
};

const CASE_ID =
  /^case_[a-f0-9]{32}$/;
const AUDIT_REF =
  /^[A-Za-z0-9._:/-]{3,240}$/;
const CONTROL =
  /[\x00-\x1f\x7f]/g;
const HISTORY_MAX = 160;

function validIso(
  value: string
): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !Number.isNaN(
      Date.parse(value)
    )
  );
}

function sequence(
  workflowId:
    OrderedCaseWorkflowId
): readonly string[] {
  return (
    ORDERED_CASE_WORKFLOW_SEQUENCES[
      workflowId
    ]
  );
}

function sanitizeAuditRefs(
  values:
    readonly string[]
): string[] {
  const refs = [
    ...new Set(
      values.map(
        (value) =>
          value.trim()
      )
    )
  ];
  if (
    refs.length < 1 ||
    refs.length > 64 ||
    refs.some(
      (value) =>
        !AUDIT_REF.test(value)
    )
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_AUDIT_REFS_INVALID"
    );
  }
  return refs;
}

function sanitizeReason(
  value: string
): string {
  const reason = value
    .normalize("NFKC")
    .replace(
      CONTROL,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  if (
    reason.length < 3 ||
    reason.length > 500
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_NA_REASON_INVALID"
    );
  }
  return reason;
}

function clone(
  state:
    OrderedCaseWorkflowState
): OrderedCaseWorkflowState {
  return {
    ...state,
    closedCheckpoints: [
      ...state.closedCheckpoints
    ],
    history:
      state.history.map(
        (event) => ({
          ...event,
          auditRefs: [
            ...event.auditRefs
          ]
        })
      )
  };
}

export function createOrderedCaseWorkflowState(
  workflowId:
    OrderedCaseWorkflowId,
  caseId: string,
  at =
    new Date().toISOString()
): OrderedCaseWorkflowState {
  if (
    !CASE_ID.test(caseId) ||
    !validIso(at)
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_INITIAL_STATE_INVALID"
    );
  }
  return {
    schemaVersion: 1,
    workflowId,
    caseId,
    revision: 1,
    status: "ACTIVE",
    closedCheckpoints: [],
    history: [],
    createdAt: at,
    updatedAt: at
  };
}

export function nextOrderedCaseCheckpoint(
  input:
    OrderedCaseWorkflowState
): string | null {
  const state =
    validateOrderedCaseWorkflowState(
      input
    );
  return (
    sequence(
      state.workflowId
    )[
      state.closedCheckpoints
        .length
    ] ?? null
  );
}

export function validateOrderedCaseWorkflowState(
  input:
    OrderedCaseWorkflowState
): OrderedCaseWorkflowState {
  if (
    input.schemaVersion !== 1 ||
    ![
      "EVIDENCE_ANALYSIS_V1",
      "WITNESS_QUESTIONING_V1"
    ].includes(
      input.workflowId
    ) ||
    !CASE_ID.test(
      input.caseId
    ) ||
    !Number.isSafeInteger(
      input.revision
    ) ||
    input.revision < 1 ||
    ![
      "ACTIVE",
      "COMPLETE"
    ].includes(
      input.status
    ) ||
    !Array.isArray(
      input.closedCheckpoints
    ) ||
    !Array.isArray(
      input.history
    ) ||
    input.history.length >
      HISTORY_MAX ||
    !validIso(
      input.createdAt
    ) ||
    !validIso(
      input.updatedAt
    )
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_STATE_INVALID"
    );
  }

  const expected =
    sequence(
      input.workflowId
    );
  if (
    input.closedCheckpoints
      .length >
      expected.length ||
    input.closedCheckpoints
      .some(
        (
          checkpoint,
          index
        ) =>
          checkpoint !==
            expected[index]
      ) ||
    input.history.length !==
      input.closedCheckpoints
        .length
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_PREFIX_INVALID"
    );
  }

  let prior = 0;
  input.history.forEach(
    (event, index) => {
      if (
        !Number.isSafeInteger(
          event.sequence
        ) ||
        event.sequence <= prior ||
        !validIso(event.at) ||
        event.checkpoint !==
          input.closedCheckpoints[
            index
          ] ||
        ![
          "DONE",
          "NA"
        ].includes(
          event.outcome
        )
      ) {
        throw new Error(
          "ORDERED_WORKFLOW_HISTORY_INVALID"
        );
      }
      sanitizeAuditRefs(
        event.auditRefs
      );
      if (
        event.outcome === "NA"
      ) {
        if (
          !OPTIONAL_CHECKPOINTS[
            input.workflowId
          ].has(
            event.checkpoint
          ) ||
          typeof event.reason !==
            "string"
        ) {
          throw new Error(
            "ORDERED_WORKFLOW_NA_STATE_INVALID"
          );
        }
        sanitizeReason(
          event.reason
        );
      } else if (
        event.reason !==
          undefined
      ) {
        throw new Error(
          "ORDERED_WORKFLOW_HISTORY_INVALID"
        );
      }
      prior =
        event.sequence;
    }
  );

  const complete =
    input.closedCheckpoints
      .length ===
    expected.length;
  if (
    (
      complete &&
      input.status !==
        "COMPLETE"
    ) ||
    (
      !complete &&
      input.status !==
        "ACTIVE"
    )
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_STATUS_INVALID"
    );
  }

  return clone(input);
}

export function requireOrderedCaseExecutionPermit(
  input:
    OrderedCaseWorkflowState
): OrderedCaseExecutionPermit {
  const state =
    validateOrderedCaseWorkflowState(
      input
    );
  const checkpoint =
    nextOrderedCaseCheckpoint(
      state
    );
  if (!checkpoint) {
    throw new Error(
      "ORDERED_WORKFLOW_ALREADY_COMPLETE"
    );
  }
  return {
    workflowId:
      state.workflowId,
    caseId:
      state.caseId,
    revision:
      state.revision,
    checkpoint
  };
}

function close(
  input:
    OrderedCaseWorkflowState,
  permit:
    OrderedCaseExecutionPermit,
  outcome:
    OrderedCaseCheckpointOutcome,
  auditRefs:
    readonly string[],
  at: string,
  reason?: string
): OrderedCaseWorkflowState {
  const state =
    validateOrderedCaseWorkflowState(
      input
    );
  if (
    permit.workflowId !==
      state.workflowId ||
    permit.caseId !==
      state.caseId ||
    permit.revision !==
      state.revision
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_PERMIT_STALE"
    );
  }

  const expected =
    nextOrderedCaseCheckpoint(
      state
    );
  if (
    !expected ||
    permit.checkpoint !==
      expected
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_CHECKPOINT_OUT_OF_ORDER"
    );
  }
  if (!validIso(at)) {
    throw new Error(
      "ORDERED_WORKFLOW_TIMESTAMP_INVALID"
    );
  }
  if (
    outcome === "NA" &&
    !OPTIONAL_CHECKPOINTS[
      state.workflowId
    ].has(expected)
  ) {
    throw new Error(
      "ORDERED_WORKFLOW_NA_NOT_ALLOWED"
    );
  }

  const refs =
    sanitizeAuditRefs(
      auditRefs
    );
  const cleanReason =
    outcome === "NA"
      ? sanitizeReason(
          reason ?? ""
        )
      : undefined;

  state.closedCheckpoints
    .push(expected);
  state.revision += 1;
  state.updatedAt = at;
  state.history.push({
    sequence:
      (state.history.at(-1)
        ?.sequence ?? 0) + 1,
    at,
    checkpoint:
      expected,
    outcome,
    auditRefs: refs,
    ...(cleanReason
      ? {
          reason:
            cleanReason
        }
      : {})
  });
  state.history =
    state.history.slice(
      -HISTORY_MAX
    );
  state.status =
    state.closedCheckpoints
      .length ===
      sequence(
        state.workflowId
      ).length
      ? "COMPLETE"
      : "ACTIVE";

  return validateOrderedCaseWorkflowState(
    state
  );
}

export function completeOrderedCaseExecution(
  input:
    OrderedCaseWorkflowState,
  permit:
    OrderedCaseExecutionPermit,
  auditRefs:
    readonly string[],
  at =
    new Date().toISOString()
): OrderedCaseWorkflowState {
  return close(
    input,
    permit,
    "DONE",
    auditRefs,
    at
  );
}

export function markOrderedCaseCheckpointNotApplicable(
  input:
    OrderedCaseWorkflowState,
  permit:
    OrderedCaseExecutionPermit,
  reason: string,
  auditRefs:
    readonly string[],
  at =
    new Date().toISOString()
): OrderedCaseWorkflowState {
  return close(
    input,
    permit,
    "NA",
    auditRefs,
    at,
    reason
  );
}

export function orderedCaseWorkflowSequence(
  workflowId:
    OrderedCaseWorkflowId
): string[] {
  return [
    ...sequence(
      workflowId
    )
  ];
}
