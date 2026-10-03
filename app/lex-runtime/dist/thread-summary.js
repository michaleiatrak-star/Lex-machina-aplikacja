export const MAX_SUMMARY_CHARS = 24_000;
export function validThreadSummary(value) {
    if (!value || typeof value !== "object")
        return null;
    const raw = value;
    if (raw.schemaVersion !== 1 ||
        typeof raw.text !== "string" ||
        raw.text.length > MAX_SUMMARY_CHARS ||
        typeof raw.coveredMessages !== "number" ||
        !Number.isInteger(raw.coveredMessages) ||
        raw.coveredMessages < 1 ||
        typeof raw.coveredUntilMessageId !== "string" ||
        typeof raw.updatedAt !== "string") {
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
