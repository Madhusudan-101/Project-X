FROM python:3.12-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml ./
RUN uv sync --no-dev
COPY . .
# Download the VAD / turn-detector model weights at build time so the first
# interview doesn't pay for it.
RUN uv run python agent.py download-files
CMD ["uv", "run", "python", "agent.py", "start"]
