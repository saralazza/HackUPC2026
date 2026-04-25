import logging
import os
from typing import Dict, List

import requests

logger = logging.getLogger(__name__)


class LLMClientError(Exception):
    pass


class GitHubModelsClient:
    """Minimal chat-completions client for GitHub Models API."""

    def __init__(self) -> None:
        self.token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
        self.endpoint = os.getenv(
            "GITHUB_MODELS_ENDPOINT",
            "https://models.github.ai/inference/chat/completions",
        )
        self.model = os.getenv("GITHUB_MODELS_MODEL", "openai/gpt-4.1-mini")
        self.timeout_seconds = int(os.getenv("LLM_TIMEOUT_SECONDS", "60"))

        if not self.token:
            raise LLMClientError("Missing GITHUB_TOKEN (or GH_TOKEN) for GitHub Models API.")

    def summarize_chunk(self, commit_message: str, chunk_text: str, chunk_number: int, total_chunks: int) -> str:
        system_prompt = (
            "You are an expert software engineer. Summarize commit diff content for developers. "
            "Be concise, technically precise, and avoid fluff."
        )

        user_prompt = (
            "Summarize this commit chunk.\n\n"
            f"Chunk {chunk_number}/{total_chunks}\n"
            "Return markdown with exactly these sections:\n"
            "1. High-level summary\n"
            "2. Key technical changes\n"
            "3. Possible intent\n"
            "4. Important or risky changes\n\n"
            f"Commit message:\n{commit_message}\n\n"
            f"Diff chunk:\n{chunk_text}\n"
        )

        return self._chat(system_prompt, user_prompt)

    def aggregate_summary(self, commit_message: str, chunk_summaries: List[str]) -> str:
        system_prompt = (
            "You are an expert software engineer. Build one final commit summary for developers "
            "from multiple partial summaries."
        )

        joined_chunks = "\n\n---\n\n".join(
            f"Chunk summary {idx + 1}:\n{text}" for idx, text in enumerate(chunk_summaries)
        )

        user_prompt = (
            "Create one cohesive final summary. Remove duplication and preserve important risk details.\n"
            "Return markdown with exactly these sections:\n"
            "1. High-level summary of what changed\n"
            "2. Key technical changes\n"
            "3. Possible intent or reason\n"
            "4. Important or risky changes\n\n"
            f"Commit message:\n{commit_message}\n\n"
            f"Chunk summaries:\n{joined_chunks}"
        )

        return self._chat(system_prompt, user_prompt)

    def _chat(self, system_prompt: str, user_prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        payload: Dict[str, object] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        # Newer reasoning-capable models (for example openai/o4-mini) require max_completion_tokens.
        response = self._post_chat_with_token_limit(headers, payload, "max_completion_tokens")

        if response.status_code == 400 and "max_completion_tokens" in response.text and "unsupported" in response.text.lower():
            # Fallback for models that only accept the legacy max_tokens parameter.
            response = self._post_chat_with_token_limit(headers, payload, "max_tokens")

        if response.status_code >= 400:
            raise LLMClientError(f"GitHub Models API error {response.status_code}: {response.text[:500]}")

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            logger.error("Unexpected GitHub Models response: %s", data)
            raise LLMClientError("Malformed response from GitHub Models API.") from exc

        return str(content).strip()

    def _post_chat_with_token_limit(
        self,
        headers: Dict[str, str],
        base_payload: Dict[str, object],
        token_field: str,
    ) -> requests.Response:
        payload = dict(base_payload)
        payload[token_field] = 1200

        return requests.post(
            self.endpoint,
            headers=headers,
            json=payload,
            timeout=self.timeout_seconds,
        )

    def summarize_file_history(self, repo: str, path: str, commits: List[Dict[str, object]]) -> str:
        commits_text = "\n".join(
            [
                "- "
                + str((c.get("commit") or {}).get("author", {}).get("date", ""))[:10]
                + ": "
                + str((c.get("commit") or {}).get("message", "")).split("\n")[0]
                for c in commits
            ]
        )

        system_prompt = (
            "You are an expert software engineer. Analyze the commit history of a file "
            "and explain clearly what changed over time and why."
        )

        user_prompt = (
            f"Here is the commit history for the file `{path}` in the repository `{repo}`.\n\n"
            f"Commits:\n{commits_text}\n\n"
            "For each commit, explain what likely changed in the file and why it was useful. "
            "Then write a brief overall summary of the file's evolution. "
            "Use markdown formatting."
        )

        return self._chat(system_prompt, user_prompt)
