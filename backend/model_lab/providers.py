"""
Provider adapters: one `call_model()` that sends the same system prompt, user
text and (optionally) PDFs to Gemini, Anthropic, or any OpenAI-compatible API
and returns raw text + token usage + latency.

Schema enforcement: Gemini gets the real `response_schema` (as in the app).
Other providers get the JSON schema appended to the system prompt plus JSON
mode where available — so "does this model follow the schema unaided" is part
of what the comparison measures.
"""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from .catalog import PROVIDERS


@dataclass
class PdfInput:
    name: str
    data: bytes


@dataclass
class CallResult:
    text: str
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    latency_s: float
    finish_reason: Optional[str] = None


class ProviderError(RuntimeError):
    pass


def api_key_for(provider: str, overrides: Dict[str, str]) -> Optional[str]:
    return overrides.get(provider) or os.getenv(PROVIDERS[provider]["key_env"]) or None


def _base_url(provider: str) -> str:
    """Default endpoint, overridable via <PROVIDER>_BASE_URL (e.g. a local Ollama / proxy)."""
    return os.getenv(f"{provider.upper()}_BASE_URL") or PROVIDERS[provider]["base_url"]


def _schema_suffix(schema: Dict[str, Any]) -> str:
    return (
        "\n\nReturn ONLY a single JSON object (no prose, no markdown fences) that conforms to "
        "this JSON Schema:\n" + json.dumps(schema)
    )


async def call_model(
    *,
    provider: str,
    model: str,
    api_key: str,
    system: str,
    user_parts: List[str],
    pdfs: List[PdfInput],
    schema: Dict[str, Any],
    temperature: float,
    max_output_tokens: int,
    timeout_s: float,
) -> CallResult:
    kind = PROVIDERS[provider]["kind"]
    t0 = time.perf_counter()
    if kind == "gemini":
        res = await _gemini(model, api_key, system, user_parts, pdfs, schema, temperature, max_output_tokens, timeout_s)
    elif kind == "anthropic":
        res = await _anthropic(model, api_key, system, user_parts, pdfs, schema, temperature, max_output_tokens, timeout_s)
    else:
        if pdfs:
            raise ProviderError("OpenAI-compatible adapter takes text only — use 'extracted text' input mode.")
        res = await _openai_compat(
            _base_url(provider), provider, model, api_key, system, user_parts, schema,
            temperature, max_output_tokens, timeout_s,
        )
    res.latency_s = round(time.perf_counter() - t0, 2)
    return res


# ── Gemini ───────────────────────────────────────────────────────────

async def _gemini(model, api_key, system, user_parts, pdfs, schema, temperature, max_tokens, timeout_s) -> CallResult:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    contents: List[Any] = [types.Part.from_bytes(data=p.data, mime_type="application/pdf") for p in pdfs]
    contents += user_parts
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=temperature,
        max_output_tokens=max_tokens,
        http_options=types.HttpOptions(timeout=int(timeout_s * 1000)),
    )
    resp = await client.aio.models.generate_content(model=model, contents=contents, config=config)
    usage = resp.usage_metadata
    finish = str(resp.candidates[0].finish_reason) if resp.candidates else None
    return CallResult(
        text=resp.text or "",
        input_tokens=getattr(usage, "prompt_token_count", None),
        # thoughts are billed as output; include them so cost comparison is honest
        output_tokens=(getattr(usage, "candidates_token_count", 0) or 0) + (getattr(usage, "thoughts_token_count", 0) or 0)
        if usage else None,
        latency_s=0,
        finish_reason=finish,
    )


# ── Anthropic ────────────────────────────────────────────────────────

async def _anthropic(model, api_key, system, user_parts, pdfs, schema, temperature, max_tokens, timeout_s) -> CallResult:
    content: List[Dict[str, Any]] = [
        {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(p.data).decode()},
        }
        for p in pdfs
    ]
    content += [{"type": "text", "text": t} for t in user_parts]
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system + _schema_suffix(schema),
        "messages": [{"role": "user", "content": content}],
    }
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout_s) as http:
        r = await http.post("https://api.anthropic.com/v1/messages", json=body, headers=headers)
        if r.status_code == 400 and "temperature" in r.text:  # some newer models reject it
            body.pop("temperature")
            r = await http.post("https://api.anthropic.com/v1/messages", json=body, headers=headers)
    _raise_for_status(r)
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {})
    return CallResult(text, usage.get("input_tokens"), usage.get("output_tokens"), 0, data.get("stop_reason"))


# ── OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Mistral) ──

async def _openai_compat(base_url, provider, model, api_key, system, user_parts, schema, temperature, max_tokens, timeout_s) -> CallResult:
    body: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system + _schema_suffix(schema)},
            {"role": "user", "content": "\n\n".join(user_parts)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": temperature,
    }
    # OpenAI's newer models want max_completion_tokens; everyone else still uses max_tokens.
    body["max_completion_tokens" if provider == "openai" else "max_tokens"] = max_tokens
    headers = {"Authorization": f"Bearer {api_key}", "content-type": "application/json"}

    async with httpx.AsyncClient(timeout=timeout_s) as http:
        r = await http.post(f"{base_url}/chat/completions", json=body, headers=headers)
        # Degrade gracefully for models that reject a param (reasoning models: temperature;
        # some open models: json_object mode). Retry once without the offending field.
        if r.status_code == 400:
            low = r.text.lower()
            if "temperature" in low:
                body.pop("temperature", None)
            if "response_format" in low or "json_object" in low:
                body.pop("response_format", None)
            r = await http.post(f"{base_url}/chat/completions", json=body, headers=headers)
    _raise_for_status(r)
    data = r.json()
    choice = (data.get("choices") or [{}])[0]
    usage = data.get("usage", {})
    return CallResult(
        (choice.get("message") or {}).get("content") or "",
        usage.get("prompt_tokens"), usage.get("completion_tokens"), 0, choice.get("finish_reason"),
    )


def _raise_for_status(r: httpx.Response) -> None:
    if r.status_code >= 400:
        raise ProviderError(f"HTTP {r.status_code}: {r.text[:600]}")


# ── Live model discovery ─────────────────────────────────────────────

async def discover_models(provider: str, api_key: str) -> List[str]:
    kind = PROVIDERS[provider]["kind"]
    if kind == "gemini":
        from google import genai
        client = genai.Client(api_key=api_key)
        out = []
        async for m in await client.aio.models.list():
            if "generateContent" in (m.supported_actions or []):
                out.append((m.name or "").removeprefix("models/"))
        return sorted(out)
    async with httpx.AsyncClient(timeout=30) as http:
        if kind == "anthropic":
            r = await http.get(
                "https://api.anthropic.com/v1/models?limit=100",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
        else:
            r = await http.get(
                f"{_base_url(provider)}/models", headers={"Authorization": f"Bearer {api_key}"}
            )
    _raise_for_status(r)
    return sorted(m["id"] for m in r.json().get("data", []))
