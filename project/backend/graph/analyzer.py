import base64
import logging
import os
from typing import Dict, List, Tuple

import requests

from .graph_builder import GraphBuilder
from .models import ParseBundle, RepositoryFile
from .parsers.generic_parser import GenericParser
from .parsers.js_parser import JSParser
from .parsers.python_parser import PythonParser

logger = logging.getLogger(__name__)


class GraphAnalyzerError(Exception):
    pass


class RepositoryGraphAnalyzer:
    """Fetch repository sources and build a cross-file function dependency graph."""

    CODE_EXTENSIONS = {
        ".py": "python",
        ".js": "javascript",
        ".jsx": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".ts": "javascript",
        ".tsx": "javascript",
        ".java": "generic",
        ".c": "generic",
        ".h": "generic",
        ".cpp": "generic",
        ".cc": "generic",
        ".hpp": "generic",
        ".cs": "generic",
        ".go": "generic",
        ".rs": "generic",
        ".php": "generic",
        ".rb": "generic",
    }

    def __init__(self, token: str | None = None) -> None:
        self.token = token
        self.timeout_seconds = int(os.getenv("GRAPH_REQUEST_TIMEOUT", "20"))
        self.max_files = int(os.getenv("GRAPH_MAX_FILES", "250"))
        self.max_file_bytes = int(os.getenv("GRAPH_MAX_FILE_BYTES", "250000"))

        self.python_parser = PythonParser()
        self.js_parser = JSParser()
        self.generic_parser = GenericParser()
        self.graph_builder = GraphBuilder()

    def build_graph(self, repo: str) -> Dict[str, List[Dict[str, str]]]:
        default_branch = self._fetch_default_branch(repo)
        tree = self._fetch_tree(repo, default_branch)
        repository_files = self._fetch_repository_files(repo, default_branch, tree)

        parse_bundle = self._parse_repository_files(repository_files)
        graph = self.graph_builder.build(parse_bundle.results)

        return {
            "nodes": [{"id": node.id} for node in graph.nodes],
            "edges": [{"source": edge.source, "target": edge.target} for edge in graph.edges],
            "meta": {
                "default_branch": default_branch,
                "analyzed_files": parse_bundle.stats.get("analyzed_files", 0),
                "discovered_functions": parse_bundle.stats.get("discovered_functions", 0),
                "discovered_calls": parse_bundle.stats.get("discovered_calls", 0),
            },
        }

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "repo-graph-analyzer/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _fetch_default_branch(self, repo: str) -> str:
        url = f"https://api.github.com/repos/{repo}"
        response = requests.get(url, headers=self._headers(), timeout=self.timeout_seconds)
        if response.status_code >= 400:
            raise GraphAnalyzerError(f"Unable to fetch repository metadata ({response.status_code}).")

        payload = response.json()
        branch = payload.get("default_branch")
        if not branch:
            raise GraphAnalyzerError("Repository default branch not found.")
        return str(branch)

    def _fetch_tree(self, repo: str, branch: str) -> List[Dict[str, object]]:
        url = f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1"
        response = requests.get(url, headers=self._headers(), timeout=self.timeout_seconds)
        if response.status_code >= 400:
            raise GraphAnalyzerError(f"Unable to fetch repository tree ({response.status_code}).")

        payload = response.json()
        tree = payload.get("tree") or []
        if not isinstance(tree, list):
            raise GraphAnalyzerError("Repository tree payload is invalid.")

        return tree

    def _fetch_repository_files(
        self,
        repo: str,
        branch: str,
        tree: List[Dict[str, object]],
    ) -> List[RepositoryFile]:
        code_blobs: List[Tuple[str, str, str]] = []

        for item in tree:
            if item.get("type") != "blob":
                continue

            path = str(item.get("path") or "")
            sha = str(item.get("sha") or "")
            size = int(item.get("size") or 0)
            language = self._language_for_path(path)

            if not language:
                continue
            if not sha:
                continue
            if size <= 0 or size > self.max_file_bytes:
                continue

            code_blobs.append((path, sha, language))

        if not code_blobs:
            return []

        if len(code_blobs) > self.max_files:
            logger.info(
                "Graph analyzer limiting file scan for %s on branch %s from %d to %d files",
                repo,
                branch,
                len(code_blobs),
                self.max_files,
            )
            code_blobs = code_blobs[: self.max_files]

        files: List[RepositoryFile] = []
        for path, sha, language in code_blobs:
            try:
                content = self._fetch_blob_content(repo, sha)
                if content:
                    files.append(RepositoryFile(path=path, content=content, language=language))
            except Exception as exc:
                logger.warning("Failed to fetch blob for %s (%s): %s", path, sha, exc)

        return files

    def _fetch_blob_content(self, repo: str, sha: str) -> str:
        url = f"https://api.github.com/repos/{repo}/git/blobs/{sha}"
        response = requests.get(url, headers=self._headers(), timeout=self.timeout_seconds)

        if response.status_code >= 400:
            raise GraphAnalyzerError(f"Blob fetch failed ({response.status_code})")

        payload = response.json()
        encoding = payload.get("encoding")
        content = payload.get("content")

        if encoding != "base64" or not content:
            return ""

        try:
            decoded = base64.b64decode(content)
            return decoded.decode("utf-8", errors="ignore")
        except Exception as exc:
            logger.warning("Unable to decode blob %s: %s", sha, exc)
            return ""

    def _parse_repository_files(self, files: List[RepositoryFile]) -> ParseBundle:
        parsed_results = []
        discovered_functions = 0
        discovered_calls = 0

        for file in files:
            if file.language == "python":
                result = self.python_parser.parse(file.path, file.content)
            elif file.language == "javascript":
                result = self.js_parser.parse(file.path, file.content)
            else:
                result = self.generic_parser.parse(file.path, file.content)

            discovered_functions += len(result.functions)
            discovered_calls += len(result.calls)
            parsed_results.append(result)

        return ParseBundle(
            results=parsed_results,
            stats={
                "analyzed_files": len(files),
                "discovered_functions": discovered_functions,
                "discovered_calls": discovered_calls,
            },
        )

    def _language_for_path(self, path: str) -> str | None:
        lower_path = path.lower()
        for ext, language in self.CODE_EXTENSIONS.items():
            if lower_path.endswith(ext):
                return language
        return None
