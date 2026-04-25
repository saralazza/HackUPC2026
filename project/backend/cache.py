import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Optional


class SummaryCache:
    """Simple SQLite-backed cache keyed by repository and commit SHA."""

    def __init__(self, db_path: str = "cache.db") -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self._initialize()

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS summaries (
                    repo TEXT NOT NULL,
                    sha TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (repo, sha)
                )
                """
            )
            conn.commit()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        try:
            yield conn
        finally:
            conn.close()

    def get(self, repo: str, sha: str) -> Optional[str]:
        with self._lock:
            with self._connect() as conn:
                cursor = conn.execute(
                    "SELECT summary FROM summaries WHERE repo = ? AND sha = ?",
                    (repo, sha),
                )
                row = cursor.fetchone()
                return row[0] if row else None

    def set(self, repo: str, sha: str, summary: str) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO summaries (repo, sha, summary)
                    VALUES (?, ?, ?)
                    ON CONFLICT(repo, sha) DO UPDATE SET
                        summary = excluded.summary,
                        created_at = CURRENT_TIMESTAMP
                    """,
                    (repo, sha, summary),
                )
                conn.commit()
