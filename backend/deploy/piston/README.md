# Piston for the Online Assessment judge

The OA grades code on the **server**: FastAPI sends the candidate's code plus the test
cases to Piston, which runs it in an isolated sandbox. Nothing runs in the browser, and
hidden tests never leave the backend.

## 1. Run it (Linux host with Docker)

```bash
cd backend/deploy/piston
docker compose up -d
```

## 2. Install the two runtimes the judge uses

```bash
curl -s localhost:2000/api/v2/packages | grep -E '"language": "(python|javascript)"'   # pick versions
curl -X POST localhost:2000/api/v2/packages -H 'Content-Type: application/json' \
     -d '{"language":"python","version":"<version>"}'
curl -X POST localhost:2000/api/v2/packages -H 'Content-Type: application/json' \
     -d '{"language":"javascript","version":"<version>"}'
curl localhost:2000/api/v2/runtimes          # python + javascript (node) must be listed
```

(The container needs outbound internet to fetch packages once.)

## 3. Point the backend at it

```
OA_JUDGE_BACKEND=piston
OA_PISTON_URL=http://localhost:2000        # or your private address
```

## 4. Verify

```bash
cd backend && python scripts/check_judge.py
```

It runs a correct and a wrong solution in both languages and checks the verdicts.

## Security

* **Piston has no authentication.** Anyone who can reach it can run code on that host.
  Bind it to localhost / a private network that only the backend can reach (the compose
  file binds to 127.0.0.1). If it must be remote, put an authenticating proxy in front and
  set `OA_PISTON_TOKEN` (sent as the `Authorization` header).
* The judge limits each run to 10 s, ~512 MB and 2 s per test case, and queues requests
  (`OA_JUDGE_CONCURRENCY`, default 4). One small container handles a few concurrent
  submissions; size it for the number of candidates who will start at the same time.
* `OA_JUDGE_BACKEND=local` runs code directly on the API server **without isolation**. It
  exists for development and tests only and refuses to start unless `OA_ALLOW_LOCAL_JUDGE=1`.
