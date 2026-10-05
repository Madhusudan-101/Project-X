import argparse

import uvicorn

p = argparse.ArgumentParser(description="Model Lab — compare LLMs on resume/LinkedIn/job-scoring prompts")
p.add_argument("--host", default="127.0.0.1", help="keep local: the dashboard accepts API keys and resumes")
p.add_argument("--port", type=int, default=8765)
args = p.parse_args()

uvicorn.run("model_lab.server:app", host=args.host, port=args.port, log_level="info")
