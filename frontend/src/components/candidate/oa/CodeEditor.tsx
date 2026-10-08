import type { KeyboardEvent } from "react";

const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python 3",
  javascript: "JavaScript",
  java: "Java",
  cpp: "C++",
  sql: "SQL",
};

interface Props {
  languages: string[];
  language: string;
  value: string;
  onChange: (code: string) => void;
  onLanguageChange: (language: string) => void;
}

/** Plain monospace editor: Tab inserts two spaces instead of leaving the field. */
export function CodeEditor({ languages, language, value, onChange, onLanguageChange }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    onChange(value.slice(0, s) + "  " + value.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = s + 2;
    });
  };

  return (
    <div className="flex h-full min-h-[24rem] flex-col overflow-hidden rounded-lg border border-border bg-[#0f1320] text-slate-100">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Language
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={languages.length < 2}
            className="rounded border border-white/15 bg-transparent px-2 py-1 text-xs text-slate-100 disabled:opacity-70"
          >
            {languages.map((l) => (
              <option key={l} value={l} className="text-black">
                {LANGUAGE_LABELS[l] ?? l}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-500">Tab inserts 2 spaces</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Code editor"
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-6 outline-none"
      />
    </div>
  );
}
