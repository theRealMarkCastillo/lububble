import { useEffect, useRef, useState } from "react";

import { api } from "./api";
import type { ChatLine } from "./types";

interface Attach {
  name: string;
  isImage: boolean;
  url?: string;
}

function namesOf(text: string): string[] {
  const marker = text.indexOf("📎");
  if (marker === -1) return [];
  return text.slice(marker).split("📎")[1]?.trim().split(/ {3}/).filter(Boolean) ?? [];
}

export function ChatPanel({
  projectId,
  lines,
  addLine,
  onSend,
  busy,
}: {
  projectId: string;
  lines: ChatLine[];
  addLine: (line: ChatLine, append: boolean) => void;
  onSend: (prompt: string, attachments: Attach[]) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attach[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  async function addFiles(files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files).slice(0, 6 - attachments.length)) {
      try {
        const uploaded = await api.upload(projectId, file);
        setAttachments((prev) => [
          ...prev,
          {
            name: uploaded.name,
            isImage: uploaded.isImage,
            url: api.uploadsUrl(projectId, uploaded.name),
          },
        ]);
      } catch (e) {
        addLine({ kind: "err", text: `upload failed: ${(e as Error).message}` }, false);
      }
    }
  }

  function submit() {
    if (busy || (!draft.trim() && !attachments.length)) return;
    onSend(draft.trim(), attachments);
    setDraft("");
    setAttachments([]);
  }

  return (
    <div className="chat">
      <div className="log" ref={logRef}>
        {lines.map((line, i) => {
          const names = line.kind === "u" ? namesOf(line.text) : [];
          return (
            <div key={i} className={line.kind}>
              {names.length ? renderWithAttachments(projectId, line.text, names) : line.text}
            </div>
          );        })}
      </div>
      {attachments.length > 0 && (
        <div className="attach-row pending">
          {attachments.map((att) => (
            <span key={att.name} className="chip">
              {att.isImage && att.url ? <img src={att.url} alt={att.name} /> : "📄"} {att.name}
              <button
                type="button"
                className="chip-x"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.name !== att.name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          placeholder={busy ? "agent working…" : "Describe a change… you can also attach files and images"}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files || []);
            if (pasted.length) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          autoFocus
        />
        <button type="button" className="attach" onClick={() => inputRef.current?.click()} disabled={busy}>
          📎
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button className="primary" disabled={busy || (!draft.trim() && !attachments.length)}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function renderWithAttachments(projectId: string, text: string, names: string[]): React.ReactNode {
  const [body] = text.split("📎");
  return (
    <>
      {body}
      <div className="attach-row">
        {names.map((name) => (
          <a key={name} href={api.uploadsUrl(projectId, name)} target="_blank" rel="noreferrer" className="chip">
            <img
              src={api.uploadsUrl(projectId, name)}
              alt={name}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            {name}
          </a>
        ))}
      </div>
    </>
  );
}
