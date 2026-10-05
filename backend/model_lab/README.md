# Model Lab

Local dashboard for comparing LLMs on the app's three PDF-driven AI tasks, using the
**production prompts, response schemas and pydantic validators** from `app/services/candidate`:

| Task | Source agent | Input |
|---|---|---|
| Resume audit | `resume_analyzer_agent` | resume PDF (+ optional portfolio JSON) |
| Job scoring engine | `job_scoring_agent` | resume PDF + JD + weight sliders (+ optional portfolio / prior audit JSON) |
| LinkedIn audit | `linkedin_analyzer_agent` | LinkedIn "Save to PDF" export (+ optional resume for cross-check) |

## Run

```bash
cd backend
pip install -r requirements.txt        # google-genai, httpx, pypdf are already there
python -m model_lab                    # http://127.0.0.1:8765
```

Keys are read from `backend/.env` (or pasted in the UI for the session only):
`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
`DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`. Only providers you tick need a key. Set
`<PROVIDER>_BASE_URL` (e.g. `OPENAI_BASE_URL`) to point an OpenAI-compatible provider at Ollama / a proxy.

## How to use it

1. Pick a task, upload the PDF(s), tick models. Ones marked **in app** are what production uses today.
2. **Run comparison** — models run strictly one after another on identical input.
3. Compare the table (score, latency, tokens, ~cost, schema validity), read the side-by-side outputs,
   star each one and mark the **best**. Runs are saved to `model_lab/results/` (git-ignored) and
   reloadable from "Past runs".

## Reading the results

- **Schema check failed** means the output didn't validate against the production pydantic model — in the
  app that'd be a fallback/500. Gemini gets the real `response_schema`; other providers only get the schema in
  the prompt + JSON mode, so this also measures how reliably they follow it without constrained decoding.
- **Input mode**: *extracted text* (default) gives every model byte-identical input. *Native PDF* mimics
  production for Gemini/Claude (they read the PDF directly, incl. layout) and falls back to text elsewhere.
- Run the **same resume 2–3 times** and use resumes of different quality (strong / weak / one with fake claims).
  The score spread across models is itself a signal: wide disagreement means read the rationales.
- `~Cost` needs a price in `catalog.py` (only filled where well known); token counts are always shown.

## Keeping the model list current

`catalog.py` is a seed list — IDs change often. Use the **Discover** button per provider to pull the live
model list, or **Add custom model**. Entries flagged "verify ID" were not confirmed against a live account.

The task builders in `tasks.py` mirror how the production agents assemble their prompts; if those change
materially, update them there.
