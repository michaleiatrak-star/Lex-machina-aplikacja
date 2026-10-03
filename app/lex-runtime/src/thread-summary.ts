/**
 * Summary of the part of a matter's thread that no longer fits the model's
 * window: written by the model, kept in the encrypted case workspace, and
 * open to review and correction by the user.
 */
export type ThreadSummary = {
  schemaVersion: 1;
  text: string;
  // The first coveredMessages thread messages (system messages excluded).
  coveredMessages: number;
  coveredUntilMessageId: string;
  updatedAt: string;
  editedByUser?: boolean;
};

export const MAX_SUMMARY_CHARS = 24_000;

export function validThreadSummary(value: unknown): ThreadSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ThreadSummary>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.text !== "string" ||
    raw.text.length > MAX_SUMMARY_CHARS ||
    typeof raw.coveredMessages !== "number" ||
    !Number.isInteger(raw.coveredMessages) ||
    raw.coveredMessages < 1 ||
    typeof raw.coveredUntilMessageId !== "string" ||
    typeof raw.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    text: raw.text,
    coveredMessages: raw.coveredMessages,
    coveredUntilMessageId: raw.coveredUntilMessageId,
    updatedAt: raw.updatedAt,
    ...(raw.editedByUser ? { editedByUser: true } : {})
  };
}
