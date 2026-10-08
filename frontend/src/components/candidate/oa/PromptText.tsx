import { Fragment } from "react";

/**
 * Renders the small markdown subset question prompts use: paragraphs,
 * `- ` lists, pipe tables, **bold** and `code`. Deliberately not a full
 * markdown engine — prompts are authored by us/companies, and building
 * React nodes (never innerHTML) keeps them inert.
 */

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function PromptText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.trim().startsWith("|"))) {
          const rows = lines.filter((l) => !/^\|?\s*:?-{2,}/.test(l.trim().replace(/^\|/, "")));
          const [head, ...body] = rows.map(cells);
          return (
            <div key={bi} className="overflow-x-auto">
              <table className="min-w-[16rem] border-collapse text-sm">
                <thead>
                  <tr>
                    {head.map((h, i) => (
                      <th
                        key={i}
                        className="border border-border bg-muted/50 px-3 py-1.5 text-left"
                      >
                        {inline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className="border border-border px-3 py-1.5">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, i) => (
                <li key={i}>{inline(l.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {l.trim().startsWith("- ") ? `• ${l.trim().slice(2)}` : inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
