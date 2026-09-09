#!/bin/bash
cd /home/pranjal-garg/Project-X/backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
