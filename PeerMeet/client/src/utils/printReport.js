/**
 * Printable version of an interview report.
 *
 * The report text comes from an AI model and from what the other person said, so none of it can be
 * trusted as HTML. Every value that goes into the page is escaped here, and the page carries a
 * Content-Security-Policy that forbids scripts as a second line of defence.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) ? escapeHtml(value) : '—';
}

export function buildPrintableHtml(report) {
  const r = report || {};
  const list = (arr) =>
    (Array.isArray(arr) ? arr : []).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const timeline = (Array.isArray(r.question_timeline) ? r.question_timeline : [])
    .map((t) => `<tr><td>${escapeHtml(t?.question)}</td><td>${escapeHtml(t?.assessment)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Interview Report</title>
    <style>
      body{font-family:Inter,Arial,sans-serif;color:#111;padding:32px;max-width:800px;margin:auto}
      h1{font-size:22px;margin-bottom:4px}
      h2{font-size:15px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px}
      .scores{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
      .score{border:1px solid #ddd;border-radius:8px;padding:10px 14px;min-width:120px}
      .score .v{font-size:20px;font-weight:700}
      .rec{display:inline-block;margin-top:12px;padding:6px 14px;border-radius:999px;border:1px solid #999;font-weight:600}
      .note{margin-top:16px;font-size:12px;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:13px}
      ul{margin:6px 0}
    </style></head><body>
    <h1>Mock Interview Report</h1>
    <div class="rec">Practice feedback: ${escapeHtml(r.final_recommendation) || '—'}</div>
    <div class="scores">
      <div class="score"><div>Overall</div><div class="v">${score(r.overall_score)}</div></div>
      <div class="score"><div>Technical</div><div class="v">${score(r.technical_score)}</div></div>
      <div class="score"><div>Communication</div><div class="v">${score(r.communication_score)}</div></div>
      <div class="score"><div>Confidence</div><div class="v">${score(r.confidence_score)}</div></div>
      <div class="score"><div>Problem Solving</div><div class="v">${score(r.problem_solving_score)}</div></div>
    </div>
    <h2>Topics Covered</h2><ul>${list(r.topics_covered)}</ul>
    <h2>Strengths</h2><ul>${list(r.strengths)}</ul>
    <h2>Weaknesses</h2><ul>${list(r.weaknesses)}</ul>
    <h2>Question Timeline</h2>
    <table><thead><tr><th>Question</th><th>Assessment</th></tr></thead><tbody>${timeline}</tbody></table>
    <h2>Suggestions</h2><ul>${list(r.suggestions)}</ul>
    <p class="note">This is practice feedback from an AI-assisted mock interview. It is not a hiring decision.</p>
    </body></html>`;
}

/**
 * Print the report from a hidden iframe: no pop-up for the browser to block, and no window.opener
 * link back to this page.
 */
export function printReport(report, doc = document) {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = buildPrintableHtml(report);
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 1000);
    }
  };
  doc.body.appendChild(frame);
}
