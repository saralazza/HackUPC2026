from dataclasses import dataclass
from typing import List

from github_client import CommitData, CommitFile
from llm_client import GitHubModelsClient


@dataclass
class SummaryResult:
    summary: str
    chunk_count: int


class CommitSummarizer:
    def __init__(self, llm_client: GitHubModelsClient, max_chunk_chars: int = 12000) -> None:
        self.llm_client = llm_client
        self.max_chunk_chars = max_chunk_chars

    def summarize(self, commit_data: CommitData) -> SummaryResult:
        chunks = self._chunk_diff_by_file(commit_data.files)

        if not chunks:
            fallback = (
                "1. High-level summary of what changed\n"
                "No textual diff was available.\n\n"
                "2. Key technical changes\n"
                "The commit metadata was retrieved, but patch content is missing (likely binary or truncated files).\n\n"
                "3. Possible intent or reason\n"
                f"Based on the commit message, likely intent: {commit_data.message}\n\n"
                "4. Important or risky changes\n"
                "Risk is unknown because textual patches were not available for review."
            )
            return SummaryResult(summary=fallback, chunk_count=0)

        if len(chunks) == 1:
            summary = self.llm_client.summarize_chunk(
                commit_message=commit_data.message,
                chunk_text=chunks[0],
                chunk_number=1,
                total_chunks=1,
            )
            return SummaryResult(summary=summary, chunk_count=1)

        partials: List[str] = []
        total_chunks = len(chunks)
        for index, chunk in enumerate(chunks, start=1):
            partials.append(
                self.llm_client.summarize_chunk(
                    commit_message=commit_data.message,
                    chunk_text=chunk,
                    chunk_number=index,
                    total_chunks=total_chunks,
                )
            )

        final_summary = self.llm_client.aggregate_summary(
            commit_message=commit_data.message,
            chunk_summaries=partials,
        )
        return SummaryResult(summary=final_summary, chunk_count=total_chunks)

    def _chunk_diff_by_file(self, files: List[CommitFile]) -> List[str]:
        chunks: List[str] = []
        active_parts: List[str] = []
        active_size = 0

        for file in files:
            patch_text = (file.patch or "").strip()
            if not patch_text:
                continue

            file_block = self._build_file_block(file, patch_text)

            if len(file_block) > self.max_chunk_chars:
                # Large single-file patches are split by line while preserving order.
                split_blocks = self._split_large_text(file_block)
                for split_block in split_blocks:
                    if active_parts:
                        chunks.append("\n\n".join(active_parts))
                        active_parts = []
                        active_size = 0
                    chunks.append(split_block)
                continue

            projected_size = active_size + len(file_block) + (2 if active_parts else 0)
            if projected_size > self.max_chunk_chars and active_parts:
                chunks.append("\n\n".join(active_parts))
                active_parts = [file_block]
                active_size = len(file_block)
            else:
                active_parts.append(file_block)
                active_size = projected_size

        if active_parts:
            chunks.append("\n\n".join(active_parts))

        return chunks

    @staticmethod
    def _build_file_block(file: CommitFile, patch_text: str) -> str:
        return (
            f"FILE: {file.filename}\n"
            f"STATUS: {file.status} | +{file.additions} -{file.deletions} | CHANGES: {file.changes}\n"
            f"PATCH:\n{patch_text}"
        )

    def _split_large_text(self, text: str) -> List[str]:
        lines = text.splitlines()
        chunks: List[str] = []
        bucket: List[str] = []
        bucket_size = 0

        for line in lines:
            line_len = len(line) + 1
            if bucket and bucket_size + line_len > self.max_chunk_chars:
                chunks.append("\n".join(bucket))
                bucket = [line]
                bucket_size = line_len
            else:
                bucket.append(line)
                bucket_size += line_len

        if bucket:
            chunks.append("\n".join(bucket))

        return chunks
