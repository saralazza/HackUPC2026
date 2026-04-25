import re
from dataclasses import dataclass
from typing import List, Tuple

from ..models import FunctionCall, FunctionSymbol, ParsedFileResult


GENERIC_DEF_PATTERN = re.compile(
    r"(?:^|\n)\s*(?:public|private|protected|static|final|virtual|inline|extern|async|\s)*"
    r"[A-Za-z_][\w:<>,\[\]\*\s]*\s+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*\{",
    re.MULTILINE,
)
GENERIC_CALL_PATTERN = re.compile(r"\b([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)\s*\(")

KEYWORDS = {
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "sizeof",
    "new",
    "delete",
}


@dataclass
class _DefSpan:
    symbol: FunctionSymbol
    body_range: Tuple[int, int]


class GenericParser:
    language = "generic"

    def parse(self, file_path: str, source: str) -> ParsedFileResult:
        spans = self._extract_definitions(file_path, source)
        calls: List[FunctionCall] = []

        for span in spans:
            body = source[span.body_range[0] : span.body_range[1]]
            for call_name in self._extract_calls(body):
                calls.append(
                    FunctionCall(
                        caller_id=span.symbol.id,
                        callee_name=call_name,
                        file_path=file_path,
                    )
                )

        return ParsedFileResult(
            file_path=file_path,
            language=self.language,
            functions=[span.symbol for span in spans],
            calls=calls,
        )

    def _extract_definitions(self, file_path: str, source: str) -> List[_DefSpan]:
        spans: List[_DefSpan] = []
        for match in GENERIC_DEF_PATTERN.finditer(source):
            name = match.group(1)
            open_brace_index = source.find("{", match.start())
            close_brace_index = self._find_matching_brace(source, open_brace_index)
            if open_brace_index < 0 or close_brace_index < 0:
                continue

            symbol = FunctionSymbol(
                id=f"{file_path}:{name}",
                file_path=file_path,
                name=name,
                qualified_name=name,
                aliases={name},
            )
            spans.append(_DefSpan(symbol=symbol, body_range=(open_brace_index + 1, close_brace_index)))

        return spans

    @staticmethod
    def _extract_calls(source: str) -> List[str]:
        calls: List[str] = []
        for match in GENERIC_CALL_PATTERN.finditer(source):
            call_name = match.group(1)
            leaf = call_name.split(".")[-1]
            if leaf in KEYWORDS:
                continue
            calls.append(call_name)
        return calls

    @staticmethod
    def _find_matching_brace(source: str, open_brace_index: int) -> int:
        if open_brace_index < 0 or open_brace_index >= len(source) or source[open_brace_index] != "{":
            return -1

        depth = 0
        for idx in range(open_brace_index, len(source)):
            ch = source[idx]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return idx

        return -1
