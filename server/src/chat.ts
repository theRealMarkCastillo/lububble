/*
 * Chat history belongs to the Hermes session (one persistent session per
 * project, held by the pooled agent process). This module is a UI mirror
 * only: in-memory per-project line state so the chat panel survives page
 * reloads. Deliberately not persisted to disk.
 */

export interface ChatLine {
  kind: string;
  text: string;
}

const lines = new Map<string, ChatLine[]>();

export function readChat(projectId: string): ChatLine[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) throw new Error("invalid project id");
  return [...(lines.get(projectId) ?? [])];
}

export function appendChatLine(projectId: string, line: ChatLine, append: boolean): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) throw new Error("invalid project id");
  const list = lines.get(projectId) ?? [];
  const last = list[list.length - 1];
  const mergeable = append && (line.kind === "a" || line.kind === "t") && last?.kind === line.kind;
  list.push(mergeable ? { kind: line.kind, text: last.text + line.text } : line);
  lines.set(projectId, list);
}

export function dropChat(projectId: string): void {
  lines.delete(projectId);
}

export function chunkText(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as unknown as { text?: string }[]).map((piece) => piece.text ?? "").join("");
  }
  if (content && typeof content === "object") {
    const t = (content as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

export function planMarker(status: string): string {
  if (status === "completed") return "[x]";
  if (status === "in_progress") return "[~]";
  return "[ ]";
}

export function mapAgentUpdateToLines(
  payload: { method: string; params: Record<string, unknown> } | Record<string, unknown>,
): { line: ChatLine; append: boolean } | null {
  const params = (payload as { params?: Record<string, unknown> })?.params ?? (payload as { update?: Record<string, unknown> });
  const update = (params as { update?: Record<string, unknown> })?.update;
  if (!update) return null;
  if (update.sessionUpdate === "agent_message_chunk") return { line: { kind: "a", text: chunkText(update.content) }, append: true };
  if (update.sessionUpdate === "user_message_chunk") {
    const text = chunkText(update.content);
    return text ? { line: { kind: "u", text }, append: false } : null;
  }
  if (update.sessionUpdate === "agent_thought_chunk") return { line: { kind: "t", text: chunkText(update.content) }, append: true };
  if (update.sessionUpdate === "tool_call") {
    const call = update as { title?: string; status?: string };
    return { line: { kind: "tc", text: `▸ ${call.title ?? "tool"}${call.status ? ` · ${call.status}` : ""}` }, append: false };
  }
  if (update.sessionUpdate === "plan") {
    const plan = update as { entries?: { content?: string; status?: string }[] };
    return {
      line: {
        kind: "sys",
        text: (plan.entries ?? []).map((entry) => `${planMarker(entry.status ?? "")} ${entry.content ?? ""}`).join("\n"),
      },
      append: false,
    };
  }
  return null;
}
