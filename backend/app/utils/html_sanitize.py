"""Tiny allowlist HTML sanitizer for imported problem statements.

Statements were authored as HTML (with Tailwind classes) and are rendered to
candidates, so anything we store must be inert. Keeps a small set of text-level
tags, drops EVERY attribute, and discards <script>/<style> content entirely.
The frontend runs a second, independent sanitizer before rendering.
"""

from __future__ import annotations

import html
from html.parser import HTMLParser
from typing import List

ALLOWED = {
    "p", "br", "code", "pre", "strong", "b", "em", "i", "u", "ul", "ol", "li", "sup", "sub",
    "span", "div", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "blockquote",
}
VOID = {"br"}
DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"}


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: List[str] = []
        self._skip = 0
        self._open: List[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in DROP_CONTENT:
            self._skip += 1
            return
        if self._skip or tag not in ALLOWED:
            return
        self.out.append(f"<{tag}>")
        if tag not in VOID:
            self._open.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag in ALLOWED and not self._skip:
            self.out.append(f"<{tag}>" if tag in VOID else f"<{tag}></{tag}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in DROP_CONTENT:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip or tag not in ALLOWED or tag in VOID:
            return
        if tag in self._open:
            while self._open:
                t = self._open.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.out.append(html.escape(data, quote=False))

    def close_all(self) -> str:
        while self._open:
            self.out.append(f"</{self._open.pop()}>")
        return "".join(self.out)


def sanitize_html(raw: str) -> str:
    p = _Sanitizer()
    p.feed(raw or "")
    p.close()
    return p.close_all()
