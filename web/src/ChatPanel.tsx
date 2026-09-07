import { useEffect, useRef, useState } from "react";

import type { ChatLine } from "./types";

export function ChatPanel({
  lines,
  onSend,
  busy,
}: {
  projectId: string;
  lines: ChatLine[];
  addLine: (line: ChatLine, append: boolean) => void;
  onSend: (prompt: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  function submit() {
    if (busy || !draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  }

  return (
    <div className="chat">
      <div className="log" ref={logRef}>
        {lines.map((line, i) => (
          <div key={i} className={line.kind}>
            {line.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          placeholder={busy ? "agent working…" : "Describe a change… e.g. 'add a signup form'"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          autoFocus
        />
        <button className="primary" disabled={busy || !draft.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}
