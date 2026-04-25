import datetime as dt
import math
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from github_client import CommitData, CommitFile, GitHubClient
from graph.analyzer import RepositoryGraphAnalyzer

from .metrics import (
    compute_change_frequency,
    compute_code_churn,
    compute_structural_risk,
    normalize_change_frequency,
    normalize_churn,
    normalize_structural_risk,
)


class RiskAnalyzerError(Exception):
    pass


@dataclass
class _MatchedCommit:
    sha: str
    author: str
    additions: int
    deletions: int


class FunctionRiskAnalyzer:
    def __init__(self, github_client: GitHubClient, graph_analyzer: RepositoryGraphAnalyzer) -> None:
        self.github_client = github_client
        self.graph_analyzer = graph_analyzer
        self.graph_cache_ttl_seconds = 300
        self._graph_cache: Dict[str, Tuple[float, Dict[str, object]]] = {}

    def analyze(self, repo: str, function_id: str, time_window_days: int = 90) -> Dict[str, object]:
        file_path, function_name = self._split_function_id(function_id)
        since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=time_window_days)).isoformat()

        commit_history = self.github_client.fetch_file_history(
            repo,
            file_path,
            since=since,
            per_page=100,
        )

        matched_commits = self._match_commits_for_function(repo, commit_history, file_path, function_name)
        try:
            fan_in, fan_out = self._compute_structural_degree(repo, function_id)
        except Exception:
            fan_in, fan_out = 0, 0

        total_additions = sum(item.additions for item in matched_commits)
        total_deletions = sum(item.deletions for item in matched_commits)
        matched_commit_count = len(matched_commits)

        churn_raw = compute_code_churn(total_additions, total_deletions, matched_commit_count)
        frequency_raw = compute_change_frequency(matched_commit_count, time_window_days=time_window_days)
        structural_raw = compute_structural_risk(fan_in=fan_in, fan_out=fan_out)

        churn_norm = normalize_churn(churn_raw)
        frequency_norm = normalize_change_frequency(frequency_raw)
        structural_norm = normalize_structural_risk(structural_raw)

        risk_score = self._clamp(
            (0.2 * churn_norm) + (0.2 * frequency_norm) + (0.6 * structural_norm),
            low=0.0,
            high=100.0,
        )

        author_entropy = self._compute_author_entropy([item.author for item in matched_commits])

        return {
            "function": function_id,
            "risk_score": int(round(risk_score)),
            "metrics": {
                "churn": int(round(churn_norm)),
                "change_frequency": int(round(frequency_norm)),
                "structural_risk": int(round(structural_norm)),
                "cyclomatic_complexity": None,
                "author_entropy": int(round(author_entropy)),
            },
        }

    def _split_function_id(self, function_id: str) -> Tuple[str, str]:
        if ":" not in function_id:
            raise RiskAnalyzerError("Invalid function_id format. Use file.py:function_name")

        file_path, function_name = function_id.split(":", 1)
        file_path = file_path.strip().lstrip("/")
        function_name = function_name.strip()

        if not file_path or not function_name:
            raise RiskAnalyzerError("Invalid function_id format. Use file.py:function_name")

        return file_path, function_name

    def _match_commits_for_function(
        self,
        repo: str,
        commit_history: List[Dict[str, object]],
        file_path: str,
        function_name: str,
    ) -> List[_MatchedCommit]:
        matched: List[_MatchedCommit] = []

        for history_item in commit_history:
            sha = str(history_item.get("sha") or "").strip()
            if not sha:
                continue

            try:
                commit_data = self.github_client.fetch_commit(repo, sha)
            except Exception:
                continue
            target_file = self._find_target_file(commit_data, file_path)
            if target_file is None:
                continue

            if not self._patch_matches_function(target_file.patch, function_name):
                continue

            additions, deletions = self._resolved_line_counts(target_file)
            author = self._extract_author(history_item)
            matched.append(
                _MatchedCommit(
                    sha=sha,
                    author=author,
                    additions=additions,
                    deletions=deletions,
                )
            )

        return matched

    @staticmethod
    def _find_target_file(commit_data: CommitData, file_path: str) -> Optional[CommitFile]:
        normalized_target = file_path.strip().lstrip("/")

        for item in commit_data.files:
            candidate = item.filename.strip().lstrip("/")
            if candidate == normalized_target:
                return item

        for item in commit_data.files:
            candidate = item.filename.strip().lstrip("/")
            if candidate.endswith(normalized_target):
                return item

        return None

    def _patch_matches_function(self, patch: str, function_name: str) -> bool:
        if not patch:
            return False

        qualified = function_name.strip()
        leaf = qualified.split(".")[-1]
        class_prefix = qualified.split(".")[0] if "." in qualified else ""

        leaf_pattern = re.compile(rf"\b{re.escape(leaf)}\b")
        py_signature = re.compile(rf"\bdef\s+{re.escape(leaf)}\s*\(")
        js_signature = re.compile(rf"\b{re.escape(leaf)}\s*\(")

        for line in patch.splitlines():
            if not line:
                continue
            if line.startswith("+++") or line.startswith("---"):
                continue
            if not (line.startswith("+") or line.startswith("-") or line.startswith("@@")):
                continue

            body = line[1:] if line[0] in "+-" else line
            lowered = body.lower()
            if qualified.lower() in lowered:
                return True
            if leaf_pattern.search(body):
                return True
            if py_signature.search(body) or js_signature.search(body):
                return True
            if class_prefix and class_prefix in body and leaf in body:
                return True

        return False

    @staticmethod
    def _resolved_line_counts(commit_file: CommitFile) -> Tuple[int, int]:
        if commit_file.additions > 0 or commit_file.deletions > 0:
            return commit_file.additions, commit_file.deletions

        additions = 0
        deletions = 0
        for line in commit_file.patch.splitlines():
            if line.startswith("+++") or line.startswith("---"):
                continue
            if line.startswith("+"):
                additions += 1
            elif line.startswith("-"):
                deletions += 1

        return additions, deletions

    @staticmethod
    def _extract_author(history_item: Dict[str, object]) -> str:
        author = history_item.get("author") if isinstance(history_item, dict) else None
        if isinstance(author, dict):
            login = str(author.get("login") or "").strip()
            if login:
                return login

        commit = history_item.get("commit") if isinstance(history_item, dict) else None
        if isinstance(commit, dict):
            commit_author = commit.get("author")
            if isinstance(commit_author, dict):
                name = str(commit_author.get("name") or "").strip()
                if name:
                    return name

        return "unknown"

    def _compute_structural_degree(self, repo: str, function_id: str) -> Tuple[int, int]:
        graph_payload = self._get_graph_payload(repo)
        edges = graph_payload.get("edges") if isinstance(graph_payload, dict) else []
        if not isinstance(edges, list):
            return 0, 0

        fan_in = 0
        fan_out = 0
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            source = edge.get("source")
            target = edge.get("target")
            if source == function_id:
                fan_out += 1
            if target == function_id:
                fan_in += 1

        return fan_in, fan_out

    def _get_graph_payload(self, repo: str) -> Dict[str, object]:
        now = time.time()
        cached = self._graph_cache.get(repo)
        if cached:
            cached_at, payload = cached
            if now - cached_at <= self.graph_cache_ttl_seconds:
                return payload

        payload = self.graph_analyzer.build_graph(repo)
        self._graph_cache[repo] = (now, payload)
        return payload

    @staticmethod
    def _compute_author_entropy(authors: List[str]) -> float:
        clean_authors = [author for author in authors if author]
        if not clean_authors:
            return 0.0

        counts = Counter(clean_authors)
        total = float(sum(counts.values()))
        if total <= 0.0:
            return 0.0

        entropy = 0.0
        for count in counts.values():
            probability = count / total
            entropy -= probability * math.log2(probability)

        max_entropy = math.log2(len(counts)) if len(counts) > 1 else 0.0
        if max_entropy <= 0.0:
            return 0.0

        return (entropy / max_entropy) * 100.0

    @staticmethod
    def _clamp(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))
