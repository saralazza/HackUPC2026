import datetime as dt
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class GitHubClientError(Exception):
    pass


@dataclass
class CommitFile:
    filename: str
    status: str
    additions: int
    deletions: int
    changes: int
    patch: str


@dataclass
class CommitData:
    repo: str
    sha: str
    message: str
    files: List[CommitFile]


class GitHubClient:
    def __init__(self, token: Optional[str] = None, timeout_seconds: int = 20) -> None:
        self.token = token
        self.timeout_seconds = timeout_seconds

    def fetch_commit(self, repo: str, sha: str) -> CommitData:
        try:
            return self._fetch_commit_via_api(repo, sha)
        except Exception as exc:
            logger.warning("GitHub API failed for %s@%s. Falling back to HTML path. Error: %s", repo, sha, exc)
            return self._fetch_commit_via_html(repo, sha)

    def _api_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "commit-summarizer/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _fetch_commit_via_api(self, repo: str, sha: str) -> CommitData:
        url = f"https://api.github.com/repos/{repo}/commits/{sha}"
        response = requests.get(url, headers=self._api_headers(), timeout=self.timeout_seconds)

        if response.status_code >= 400:
            raise GitHubClientError(f"GitHub API returned {response.status_code}: {response.text[:300]}")

        payload = response.json()
        message = payload.get("commit", {}).get("message", "").strip()
        files_payload = payload.get("files") or []

        files: List[CommitFile] = []
        for item in files_payload:
            files.append(
                CommitFile(
                    filename=item.get("filename", "unknown"),
                    status=item.get("status", "modified"),
                    additions=int(item.get("additions", 0) or 0),
                    deletions=int(item.get("deletions", 0) or 0),
                    changes=int(item.get("changes", 0) or 0),
                    patch=item.get("patch") or "",
                )
            )

        if not message:
            raise GitHubClientError("API response did not contain a commit message.")

        return CommitData(repo=repo, sha=sha, message=message, files=files)

    def _fetch_commit_via_html(self, repo: str, sha: str) -> CommitData:
        commit_page_url = f"https://github.com/{repo}/commit/{sha}"
        response = requests.get(commit_page_url, timeout=self.timeout_seconds)

        if response.status_code >= 400:
            raise GitHubClientError(f"Commit page unavailable ({response.status_code}).")

        soup = BeautifulSoup(response.text, "html.parser")

        title_node = soup.select_one("div.commit-title")
        if title_node is None:
            title_node = soup.select_one("h1")

        message = title_node.get_text(" ", strip=True) if title_node else "Commit message unavailable"

        files = self._extract_files_from_html(soup)

        # If structured diff blocks are not available in HTML, use patch text endpoint as a best-effort fallback.
        if not files:
            files = self._extract_files_from_patch_text(repo, sha)

        return CommitData(repo=repo, sha=sha, message=message, files=files)

    def _extract_files_from_html(self, soup: BeautifulSoup) -> List[CommitFile]:
        files: List[CommitFile] = []

        for file_block in soup.select("div.file"):
            filename = "unknown"
            header = file_block.select_one("div.file-header")
            if header and header.has_attr("data-path"):
                filename = str(header.get("data-path"))

            patch_lines: List[str] = []
            for line in file_block.select("td.blob-code"):
                text = line.get_text("", strip=False)
                marker = " "
                classes = line.get("class") or []
                class_name = " ".join(classes)
                if "blob-code-addition" in class_name:
                    marker = "+"
                elif "blob-code-deletion" in class_name:
                    marker = "-"
                patch_lines.append(f"{marker}{text.rstrip()}")

            patch_text = "\n".join(patch_lines).strip()
            if patch_text:
                files.append(
                    CommitFile(
                        filename=filename,
                        status="modified",
                        additions=0,
                        deletions=0,
                        changes=0,
                        patch=patch_text,
                    )
                )

        return files

    def _extract_files_from_patch_text(self, repo: str, sha: str) -> List[CommitFile]:
        patch_url = f"https://github.com/{repo}/commit/{sha}.patch"
        response = requests.get(patch_url, timeout=self.timeout_seconds)
        if response.status_code >= 400:
            logger.warning("Patch endpoint unavailable (%s). Returning empty diff.", response.status_code)
            return []

        text = response.text
        blocks = text.split("diff --git ")
        files: List[CommitFile] = []

        for block in blocks:
            block = block.strip()
            if not block:
                continue

            lines = block.splitlines()
            first_line = lines[0] if lines else ""
            filename = self._filename_from_diff_header(first_line)
            patch = "diff --git " + block

            files.append(
                CommitFile(
                    filename=filename,
                    status="modified",
                    additions=0,
                    deletions=0,
                    changes=0,
                    patch=patch,
                )
            )

        return files

    @staticmethod
    def _filename_from_diff_header(header: str) -> str:
        # Typical format: a/path/to/file b/path/to/file
        parts = header.split(" ")
        if len(parts) >= 2 and parts[1].startswith("b/"):
            return parts[1][2:]
        if len(parts) >= 2:
            return parts[1]
        return "unknown"

    def fetch_file_history(
        self,
        repo: str,
        path: str,
        *,
        since: Optional[str] = None,
        per_page: int = 100,
    ) -> List[Dict[str, Any]]:
        url = f"https://api.github.com/repos/{repo}/commits"
        params: Dict[str, Any] = {"path": path, "per_page": max(1, min(per_page, 100))}
        if since:
            params["since"] = since
        response = requests.get(
            url,
            params=params,
            headers=self._api_headers(),
            timeout=self.timeout_seconds,
        )

        if response.status_code >= 400:
            raise GitHubClientError(f"GitHub API error {response.status_code}: {response.text[:300]}")

        payload = response.json()
        if not isinstance(payload, list):
            raise GitHubClientError("Unexpected response shape for file history.")
        return payload

    @staticmethod
    def parse_commit_date(commit_payload: Dict[str, Any]) -> Optional[dt.datetime]:
        date_text = (
            commit_payload.get("commit", {})
            .get("author", {})
            .get("date")
        )
        if not date_text:
            return None

        try:
            normalized = str(date_text).replace("Z", "+00:00")
            return dt.datetime.fromisoformat(normalized)
        except Exception:
            return None
