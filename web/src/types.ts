export type ChatLine = { kind: "u" | "a" | "t" | "sys" | "err" | "tc"; text: string };

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
