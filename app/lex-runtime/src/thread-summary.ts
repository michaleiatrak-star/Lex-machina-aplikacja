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

// The note the client puts in place of the oldest messages that do not fit
// (lex-web conversation-context.ts).
const DROPPED_NOTE = /\[Wcześniejsza część rozmowy pominięta \((\d+) wiadomości\)[^\]\n]*\]/;

export function droppedMessageCount(query: string): number | null {
  const match = DROPPED_NOTE.exec(query);
  const count = match ? Number(match[1]) : NaN;
  return Number.isInteger(count) && count > 0 ? count : null;
}

/** The client's note replaced with the summary of the omitted messages. */
export function queryWithSummary(query: string, summary: ThreadSummary): string {
  return query.replace(
    DROPPED_NOTE,
    () =>
      `[Streszczenie wcześniejszej części rozmowy (${summary.coveredMessages} wiadomości), zapisane w sprawie${summary.editedByUser ? " i poprawione przez użytkownika" : ""}; statusy przepisów nadane z rejestru weryfikacji:]\n${summary.text}\n[Koniec streszczenia]`
  );
}

// Characters of thread text per summarizing call (about half the window).
export const SUMMARY_CHUNK_CHARS: Record<string, number> = {
  anthropic: 240_000,
  google: 240_000,
  openai: 120_000,
  xai: 120_000
};

type ThreadMessage = { messageId: string; role: "user" | "assistant" | "system"; content: string };

/**
 * The summary of the first `dropped` thread messages: the stored one when it
 * already covers them (and the thread was not changed under it), otherwise
 * the stored summary updated with the messages it lacks, chunk by chunk.
 */
export async function summaryForDroppedHistory(args: {
  thread: ThreadMessage[];
  dropped: number;
  stored: ThreadSummary | null;
  chunkChars: number;
  now: string;
  summarize: (previous: string | undefined, messages: Array<{ role: "user" | "assistant"; content: string }>) => Promise<string>;
}): Promise<{ summary: ThreadSummary; generated: boolean } | null> {
  const thread = args.thread.filter(
    (message): message is ThreadMessage & { role: "user" | "assistant" } => message.role !== "system"
  );
  if (args.dropped > thread.length) return null;
  const stored =
    args.stored && thread[args.stored.coveredMessages - 1]?.messageId === args.stored.coveredUntilMessageId
      ? args.stored
      : null;
  if (stored && stored.coveredMessages >= args.dropped) return { summary: stored, generated: false };

  let text = stored?.text;
  const pending = thread.slice(stored?.coveredMessages ?? 0, args.dropped);
  while (pending.length > 0) {
    const chunk: typeof pending = [];
    let size = 0;
    while (pending.length > 0 && (chunk.length === 0 || size + pending[0]!.content.length <= args.chunkChars)) {
      const message = pending.shift()!;
      chunk.push({ ...message, content: message.content.slice(0, args.chunkChars) });
      size += Math.min(message.content.length, args.chunkChars);
    }
    text = await args.summarize(text, chunk.map((message) => ({ role: message.role, content: message.content })));
  }
  return {
    summary: {
      schemaVersion: 1,
      text: (text ?? "").slice(0, MAX_SUMMARY_CHARS),
      coveredMessages: args.dropped,
      coveredUntilMessageId: thread[args.dropped - 1]!.messageId,
      updatedAt: args.now,
      ...(stored?.editedByUser ? { editedByUser: true } : {})
    },
    generated: true
  };
}
