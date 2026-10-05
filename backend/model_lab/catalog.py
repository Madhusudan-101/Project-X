"""
Model catalog for the Model Lab.

This is a *seed* list — model IDs change often, so the dashboard also has a
"Discover" button (see providers.discover_models) that pulls the live list from
each provider, and a free-text "custom model" box. Anything not marked
`current=True` is a candidate to try, not something the app uses today.

`price` is (input $/1M tokens, output $/1M tokens) and is only filled where the
number is well known; leave None otherwise — the dashboard then just shows token
counts. Prices are approximate and for relative comparison only.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

# provider id → connection details
PROVIDERS: Dict[str, Dict[str, str]] = {
    "gemini": {"label": "Google Gemini", "kind": "gemini", "key_env": "GEMINI_API_KEY"},
    "anthropic": {"label": "Anthropic Claude", "kind": "anthropic", "key_env": "ANTHROPIC_API_KEY"},
    "openai": {
        "label": "OpenAI", "kind": "openai", "key_env": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1",
    },
    "openrouter": {
        "label": "OpenRouter (any model, one key)", "kind": "openai", "key_env": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "groq": {
        "label": "Groq (fast open models)", "kind": "openai", "key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
    },
    "deepseek": {
        "label": "DeepSeek", "kind": "openai", "key_env": "DEEPSEEK_API_KEY",
        "base_url": "https://api.deepseek.com/v1",
    },
    "mistral": {
        "label": "Mistral", "kind": "openai", "key_env": "MISTRAL_API_KEY",
        "base_url": "https://api.mistral.ai/v1",
    },
}

# (provider, model id, note, current-in-app, price, native PDF support)
_Seed = Tuple[str, str, str, bool, Optional[Tuple[float, float]], bool]

_SEED: List[_Seed] = [
    # ── Gemini: what the app uses today + the obvious upgrade/downgrade paths
    ("gemini", "gemini-3.5-flash", "Primary model in the app today", True, None, True),
    ("gemini", "gemini-3.1-flash-lite", "App fallback #1 — cheapest/fastest", True, None, True),
    ("gemini", "gemini-2.0-flash", "App fallback #2", True, (0.10, 0.40), True),
    ("gemini", "gemini-2.5-flash", "Previous-gen flash, stable", False, (0.30, 2.50), True),
    ("gemini", "gemini-2.5-flash-lite", "Previous-gen lite", False, None, True),
    ("gemini", "gemini-2.5-pro", "Higher-quality Gemini; slower/pricier", False, (1.25, 10.00), True),
    # ── Anthropic
    ("anthropic", "claude-haiku-4-5-20251001", "Cheap + fast Claude", False, (1.00, 5.00), True),
    ("anthropic", "claude-sonnet-5-5", "Balanced Claude", False, None, True),
    ("anthropic", "claude-opus-5-5", "High-quality Claude", False, None, True),
    ("anthropic", "claude-fable-5-1", "Top-tier Claude", False, None, True),
    # ── OpenAI
    ("openai", "gpt-5-mini", "Cheap OpenAI — verify ID with Discover", False, None, False),
    ("openai", "gpt-5", "Flagship OpenAI — verify ID with Discover", False, None, False),
    ("openai", "gpt-4.1-mini", "Non-reasoning, predictable JSON", False, (0.40, 1.60), False),
    # ── Open-weight / budget options (OpenRouter = one key for all of these)
    ("openrouter", "nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (120B MoE) — free tier, 262K ctx", False, (0.0, 0.0), False),
    ("openrouter", "deepseek/deepseek-chat", "DeepSeek V3 line — very cheap", False, None, False),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct", "Open Llama 70B", False, None, False),
    ("openrouter", "qwen/qwen-2.5-72b-instruct", "Open Qwen 72B", False, None, False),
    ("openrouter", "mistralai/mistral-large", "Mistral Large", False, None, False),
    ("groq", "llama-3.3-70b-versatile", "Llama 70B on Groq — very low latency", False, None, False),
    ("deepseek", "deepseek-chat", "DeepSeek direct API", False, None, False),
    ("mistral", "mistral-large-latest", "Mistral direct API", False, None, False),
]


def seed_models() -> List[dict]:
    return [
        {
            "provider": p, "model": m, "note": note, "current": cur,
            "price": list(price) if price else None, "native_pdf": pdf,
        }
        for p, m, note, cur, price, pdf in _SEED
    ]


def price_for(provider: str, model: str) -> Optional[Tuple[float, float]]:
    for p, m, _n, _c, price, _pdf in _SEED:
        if p == provider and m == model:
            return price
    return None


def native_pdf(provider: str, model: str) -> bool:
    for p, m, _n, _c, _price, pdf in _SEED:
        if p == provider and m == model:
            return pdf
    return PROVIDERS[provider]["kind"] in ("gemini", "anthropic")
