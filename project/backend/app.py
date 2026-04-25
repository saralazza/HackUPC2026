import logging
import os
import re
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from cache import SummaryCache
from github_client import GitHubClient, GitHubClientError
from llm_client import GitHubModelsClient, LLMClientError
from summarizer import CommitSummarizer


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, resources={r"/summarize": {"origins": ["https://github.com"]}})

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    logger = logging.getLogger("commit-summarizer")

    cache_path = Path(__file__).resolve().parent / "cache.db"
    cache = SummaryCache(str(cache_path))
    github_client = GitHubClient(token=os.getenv("GITHUB_TOKEN"))

    try:
        llm_client = GitHubModelsClient()
    except LLMClientError as exc:
        logger.error("LLM configuration error during startup: %s", exc)
        llm_client = None

    repo_pattern = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    sha_pattern = re.compile(r"^[0-9a-fA-F]{7,40}$")

    @app.get("/health")
    def healthcheck():
        return jsonify({"status": "ok"})

    @app.get("/summarize")
    def summarize_commit():
        repo = (request.args.get("repo") or "").strip()
        sha = (request.args.get("sha") or "").strip()

        if not repo_pattern.match(repo):
            return jsonify({"error": "Invalid repo format. Use owner/repository."}), 400

        if not sha_pattern.match(sha):
            return jsonify({"error": "Invalid commit SHA format."}), 400

        if llm_client is None:
            return jsonify({"error": "LLM client is not configured. Set GITHUB_TOKEN."}), 500

        cached_summary = cache.get(repo, sha)
        if cached_summary is not None:
            return jsonify(
                {
                    "repo": repo,
                    "sha": sha,
                    "cached": True,
                    "summary": cached_summary,
                }
            )

        try:
            commit_data = github_client.fetch_commit(repo, sha)
            summarizer = CommitSummarizer(llm_client=llm_client)
            summary_result = summarizer.summarize(commit_data)
            cache.set(repo, sha, summary_result.summary)

            return jsonify(
                {
                    "repo": repo,
                    "sha": sha,
                    "cached": False,
                    "chunk_count": summary_result.chunk_count,
                    "summary": summary_result.summary,
                }
            )
        except GitHubClientError as exc:
            logger.exception("GitHub retrieval error for %s@%s", repo, sha)
            return jsonify({"error": f"GitHub retrieval failed: {exc}"}), 502
        except LLMClientError as exc:
            logger.exception("LLM summarization error for %s@%s", repo, sha)
            return jsonify({"error": f"LLM summarization failed: {exc}"}), 502
        except Exception as exc:
            logger.exception("Unexpected error for %s@%s", repo, sha)
            return jsonify({"error": f"Unexpected server error: {exc}"}), 500

    return app


app = create_app()


if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host=host, port=port, debug=False)
