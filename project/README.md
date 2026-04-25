# GitHub Commit + Repository Graph Assistant

This project now provides two independent production features:

1. Commit summarization on commit pages via LLM (existing flow, unchanged).
2. Function dependency graph on repository main pages (new flow).

## Architecture

### Existing feature (unchanged)

- Chrome extension on commit pages calls backend `/summarize`.
- Backend fetches commit diff/message and summarizes with GitHub Models.
- Summary is cached in SQLite.

### New feature (isolated)

- Chrome extension on repository main pages (`https://github.com/{owner}/{repo}`) calls backend `/graph?repo={owner}/{repo}`.
- Backend graph module fetches repository tree via GitHub API and pulls code blobs.
- Parser layer extracts functions/methods and calls:
  - Python AST parser
  - JavaScript parser
  - Generic heuristic parser fallback
- Graph builder resolves cross-file links where possible and returns directed call graph.
- Extension renders graph using Cytoscape.js below README with hover interaction and tooltip.

## Project structure

project/
  backend/
    app.py
    cache.py
    github_client.py
    llm_client.py
    summarizer.py
    graph/
      __init__.py
      analyzer.py
      graph_builder.py
      models.py
      parsers/
        __init__.py
        python_parser.py
        js_parser.py
        generic_parser.py
  extension/
    manifest.json
    content.js
    sidebar.js
    sidebar.css
    repo_main.js
    graph/
      cytoscape.min.js
      graph.js
      graph.css

## New API endpoint

GET `/graph?repo={owner}/{repo}`

Response shape:

{
  "nodes": [{ "id": "path/file.py:function_name" }],
  "edges": [{ "source": "...", "target": "..." }],
  "meta": {
    "default_branch": "main",
    "analyzed_files": 120,
    "discovered_functions": 430,
    "discovered_calls": 1290
  }
}

## Setup

### Backend

1. Open terminal in `project/backend`
2. Create and activate venv
3. Install dependencies
4. Set environment variables
5. Run Flask app

PowerShell example:

cd c:\Users\sabds\HackUPC2026\project\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$Env:GITHUB_TOKEN="<your-token>"
$Env:GITHUB_MODELS_MODEL="openai/o4-mini"
python app.py

### Extension

1. Open Chrome at `chrome://extensions`
2. Enable Developer mode
3. Load unpacked extension from:
   c:\Users\sabds\HackUPC2026\project\extension

## Usage

### Commit summarization

1. Open a commit page: `https://github.com/{owner}/{repo}/commit/{sha}`
2. Sidebar appears on the right with summary.

### Repository function graph

1. Open repository root page: `https://github.com/{owner}/{repo}`
2. Graph section is injected below README.
3. Hover a node to:
   - highlight incoming edges
   - highlight source nodes
   - dim all others
   - show tooltip with caller list

## Performance and limits

Graph analyzer uses conservative defaults:

- Max files analyzed: `GRAPH_MAX_FILES` (default 250)
- Max file size in bytes: `GRAPH_MAX_FILE_BYTES` (default 250000)
- Request timeout: `GRAPH_REQUEST_TIMEOUT` (default 20)

Set them as environment variables if needed for very large repositories.
