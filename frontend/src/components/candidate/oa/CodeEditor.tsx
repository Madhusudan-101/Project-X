import { useRef, type ClipboardEvent, type KeyboardEvent, type UIEvent } from "react";
const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python 3",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
};

interface Props {
  languages: string[];
  language: string;
  value: string;
  onChange: (code: string) => void;
  onLanguageChange: (language: string) => void;
  onPaste?: () => void;
  disabled?: boolean;
}

/**
 * Plain editor with a line-number gutter, Tab = 2 spaces and auto-indent on
 * Enter (one extra level after `:` or an opening bracket). Deliberately
 * dependency-free; swapping in CodeMirror later only touches this file.
 */
export function CodeEditor({
  languages,
  language,
  value,
  onChange,
  onLanguageChange,
  onPaste,
  disabled,
}: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = Math.max(1, value.split("\n").length);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    if (e.key === "Tab") {
      e.preventDefault();
      onChange(value.slice(0, s) + "  " + value.slice(end));
      requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 2));
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const current = value.slice(lineStart, s);
      const indent = /^\s*/.exec(current)?.[0] ?? "";
      const opens = /[:{[(]\s*$/.test(current);
      const insert = "\n" + indent + (opens ? "  " : "");
      onChange(value.slice(0, s) + insert + value.slice(end));
      requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + insert.length));
    }
  };

  const onScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className="flex h-full min-h-[22rem] flex-col overflow-hidden rounded-lg border border-border bg-[#0f1320] text-slate-100">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Language
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={languages.length < 2 || disabled}
            className="rounded border border-white/15 bg-transparent px-2 py-1 text-xs text-slate-100 disabled:opacity-70"
          >
            {languages.map((l) => (
              <option key={l} value={l} className="text-black">
                {LANGUAGE_LABELS[l] ?? l}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-500">Tab = 2 spaces</span>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={gutter}
          aria-hidden
          className="w-10 shrink-0 select-none overflow-hidden border-r border-white/10 py-4 pr-2 text-right font-mono text-[13px] leading-6 text-slate-600"
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onPaste={(_e: ClipboardEvent) => onPaste?.()}
          readOnly={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label="Code editor"
          className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent p-4 font-mono text-[13px] leading-6 outline-none"
        />
      </div>
    </div>
  );
}
