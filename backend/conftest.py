"""Shared pytest bootstrap: dummy credentials so nothing can reach a real Supabase."""
import logging
import os
import sys

os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "svc-role-test"
os.environ["SUPABASE_ANON_KEY"] = "anon-test"
os.environ["PEERMEET_SHARED_SECRET"] = "test-shared-secret"
for k in ("GEMINI_API_KEY", "OA_JUDGE_BACKEND", "OA_PISTON_URL", "OA_ALLOW_LOCAL_JUDGE"):
    os.environ.pop(k, None)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpx2").setLevel(logging.WARNING)
