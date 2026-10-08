import { useMemo } from "react";

/**
 * Renders problem statements (authored as HTML). The server already strips
 * everything but a small tag allowlist; this is a second, independent pass —
 * attributes are NEVER copied across, and unknown elements are unwrapped.
 * Client-only: during SSR (no DOMParser) it renders nothing.
 */
const ALLOWED = new Set([
  "P",
  "BR",
  "CODE",
  "PRE",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "SUP",
  "SUB",
  "SPAN",
  "DIV",
  "H3",
  "H4",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "BLOCKQUOTE",
]);
const DROP = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "NOSCRIPT",
  "SVG",
  "MATH",
]);

function clean(node: Node, out: Node, doc: Document) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ""));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (DROP.has(el.tagName)) return;
      if (ALLOWED.has(el.tagName)) {
        const copy = doc.createElement(el.tagName.toLowerCase());
        clean(el, copy, doc);
        out.appendChild(copy);
      } else {
        clean(el, out, doc); // unwrap unknown elements, keep their text
      }
    }
  });
}

function sanitizeHtml(raw: string): string {
  if (typeof DOMParser === "undefined") return "";
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const target = parsed.createElement("div");
  clean(parsed.body, target, parsed);
  return target.innerHTML;
}

export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <div
      className={
        "text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_p:first-child]:mt-0 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 " +
        (className ?? "")
      }
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
