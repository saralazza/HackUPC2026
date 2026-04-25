# HackUPC2026

Production-ready system that summarizes GitHub commits for developers.

## Architecture

- Chrome extension runs only on commit pages:
  - `https://github.com/*/*/commit/*`
- Extension extracts `owner/repo` and `commit SHA` from URL.
- Extension calls local Flask backend:
  - `GET /summarize?repo={owner}/{repo}&sha={sha}`
- Backend fetches commit message and diff from GitHub:
  - Preferred: GitHub REST API
  - Fallback: commit page parsing + patch fallback path
- Backend chunks large diffs by file/size.
- Backend sends each chunk with commit message to GitHub Models API.
- Backend aggregates chunk summaries into one final summary.
- Backend caches summary in SQLite by `repo + sha`.
- Extension renders summary in a fixed right sidebar.

## Project structure

project/
  backend/
    app.py
    github_client.py
    llm_client.py
    summarizer.py
    cache.py
    requirements.txt
    cache.db (created at runtime)
  extension/
    manifest.json
    content.js
    sidebar.css
    sidebar.js
  README.md

## Prerequisites

- Python 3.10+
- Chrome (or Chromium browser supporting Manifest V3)
- GitHub personal access token with access to GitHub Models

## Backend setup

1. Open terminal in `project/backend`
2. Create virtual environment
3. Install dependencies
4. Set environment variables
5. Run Flask app

### PowerShell commands

```powershell
cd c:\Users\sabds\HackUPC2026\project\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:GITHUB_TOKEN="<your_github_token>"
$env:GITHUB_MODELS_MODEL="openai/gpt-4.1-mini"
# Optional override if endpoint changes
# $env:GITHUB_MODELS_ENDPOINT="https://models.github.ai/inference/chat/completions"
python app.py
```

Backend listens on `http://127.0.0.1:5000`.

Health check:

```powershell
curl "http://127.0.0.1:5000/health"
```

## Extension setup

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder:
   - `c:\Users\sabds\HackUPC2026\project\extension`

## Usage

1. Start backend (`python app.py`).
2. Open any GitHub commit page, for example:
   - `https://github.com/owner/repo/commit/<sha>`
3. Extension injects right sidebar automatically.
4. Sidebar shows loading state while backend summarizes.
5. Summary appears with cache/chunk metadata.
6. Reloading same commit uses cache and avoids duplicate LLM call.

## API contract

`GET /summarize?repo={owner}/{repo}&sha={commit_sha}`

Success response example:

```json
{
  "repo": "octocat/Hello-World",
  "sha": "7fd1a60b01f91b314f59951fdfc8c8f4f88f8d87",
  "cached": false,
  "chunk_count": 2,
  "summary": "...developer-focused markdown summary..."
}
```

Error response example:

```json
{
  "error": "GitHub retrieval failed: ..."
}
```

## Notes for production hardening

- Add request authentication between extension and backend if needed.
- Add rate limiting and retry policies for external APIs.
- Add observability (structured logs, metrics, tracing).
- Add tests (unit + integration + browser E2E).
- Optionally add persistent queue for long-running summarization.
