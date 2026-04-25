import re
from dataclasses import dataclass
from typing import List, Tuple

from ..models import FunctionCall, FunctionSymbol, ParsedFileResult


CALL_PATTERN = re.compile(r"\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(")
FUNCTION_DECL_PATTERN = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.MULTILINE)
FUNCTION_ASSIGN_PATTERN = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{",
    re.MULTILINE,
)
CLASS_PATTERN = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)\s*\{", re.MULTILINE)
METHOD_PATTERN = re.compile(r"(?m)^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;\n]*\)\s*\{")

KEYWORDS = {
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "function",
    "return",
    "typeof",
    "new",
    "console",
    "super",
}


@dataclass
class _FunctionSpan:
    id: str
    file_path: str
    name: str
    qualified_name: str
    aliases: set
    body_range: Tuple[int, int]


class JSParser:
    language = "javascript"

    def parse(self, file_path: str, source: str) -> ParsedFileResult:
        spans: List[_FunctionSpan] = []
        occupied_ranges: List[Tuple[int, int]] = []

        class_spans = self._extract_class_methods(file_path, source)
        spans.extend(class_spans)
        occupied_ranges.extend([span.body_range for span in class_spans])

        spans.extend(self._extract_function_declarations(file_path, source, occupied_ranges))
        spans.extend(self._extract_function_assignments(file_path, source, occupied_ranges))

        symbols = [
            FunctionSymbol(
                id=span.id,
                file_path=span.file_path,
                name=span.name,
                qualified_name=span.qualified_name,
                aliases=set(span.aliases),
            )
            for span in spans
        ]

        calls: List[FunctionCall] = []
        for span in spans:
            start, end = span.body_range
            body = source[start:end]
            for call_name in self._extract_call_names(body):
                calls.append(
                    FunctionCall(
                        caller_id=span.id,
                        callee_name=call_name,
                        file_path=file_path,
                    )
                )

        return ParsedFileResult(file_path=file_path, language=self.language, functions=symbols, calls=calls)

    def _extract_function_declarations(
        self,
        file_path: str,
        source: str,
        occupied_ranges: List[Tuple[int, int]],
    ) -> List[_FunctionSpan]:
        spans: List[_FunctionSpan] = []
        for match in FUNCTION_DECL_PATTERN.finditer(source):
            open_brace_index = source.find("{", match.start())
            close_brace_index = self._find_matching_brace(source, open_brace_index)
            if open_brace_index < 0 or close_brace_index < 0:
                continue
            if self._inside_ranges(open_brace_index, occupied_ranges):
                continue

            name = match.group(1)
            qualified = name
            spans.append(
                _FunctionSpan(
                    id=f"{file_path}:{qualified}",
                    file_path=file_path,
                    name=name,
                    qualified_name=qualified,
                    aliases={name, qualified},
                    body_range=(open_brace_index + 1, close_brace_index),
                )
            )
            occupied_ranges.append((open_brace_index + 1, close_brace_index))

        return spans

    def _extract_function_assignments(
        self,
        file_path: str,
        source: str,
        occupied_ranges: List[Tuple[int, int]],
    ) -> List[_FunctionSpan]:
        spans: List[_FunctionSpan] = []
        for match in FUNCTION_ASSIGN_PATTERN.finditer(source):
            open_brace_index = source.find("{", match.start())
            close_brace_index = self._find_matching_brace(source, open_brace_index)
            if open_brace_index < 0 or close_brace_index < 0:
                continue
            if self._inside_ranges(open_brace_index, occupied_ranges):
                continue

            name = match.group(1)
            spans.append(
                _FunctionSpan(
                    id=f"{file_path}:{name}",
                    file_path=file_path,
                    name=name,
                    qualified_name=name,
                    aliases={name},
                    body_range=(open_brace_index + 1, close_brace_index),
                )
            )
            occupied_ranges.append((open_brace_index + 1, close_brace_index))

        return spans

    def _extract_class_methods(self, file_path: str, source: str) -> List[_FunctionSpan]:
        spans: List[_FunctionSpan] = []
        for match in CLASS_PATTERN.finditer(source):
            class_name = match.group(1)
            class_open = source.find("{", match.start())
            class_close = self._find_matching_brace(source, class_open)
            if class_open < 0 or class_close < 0:
                continue

            class_body = source[class_open + 1 : class_close]
            class_body_start = class_open + 1

            for method in METHOD_PATTERN.finditer(class_body):
                method_name = method.group(1)
                if method_name == "constructor":
                    continue

                absolute_method_start = class_body_start + method.start()
                open_brace_index = source.find("{", absolute_method_start)
                close_brace_index = self._find_matching_brace(source, open_brace_index)
                if open_brace_index < 0 or close_brace_index < 0:
                    continue

                qualified = f"{class_name}.{method_name}"
                spans.append(
                    _FunctionSpan(
                        id=f"{file_path}:{qualified}",
                        file_path=file_path,
                        name=method_name,
                        qualified_name=qualified,
                        aliases={method_name, qualified},
                        body_range=(open_brace_index + 1, close_brace_index),
                    )
                )

        return spans

    @staticmethod
    def _extract_call_names(source: str) -> List[str]:
        calls: List[str] = []
        for match in CALL_PATTERN.finditer(source):
            call_name = match.group(1)
            leaf = call_name.split(".")[-1]
            if leaf in KEYWORDS:
                continue
            calls.append(call_name)
        return calls

    @staticmethod
    def _inside_ranges(position: int, ranges: List[Tuple[int, int]]) -> bool:
        for start, end in ranges:
            if start <= position <= end:
                return True
        return False

    @staticmethod
    def _find_matching_brace(source: str, open_brace_index: int) -> int:
        if open_brace_index < 0 or open_brace_index >= len(source) or source[open_brace_index] != "{":
            return -1

        depth = 0
        in_single_quote = False
        in_double_quote = False
        in_template = False
        escape = False

        for idx in range(open_brace_index, len(source)):
            ch = source[idx]

            if escape:
                escape = False
                continue

            if ch == "\\":
                escape = True
                continue

            if ch == "'" and not in_double_quote and not in_template:
                in_single_quote = not in_single_quote
                continue
            if ch == '"' and not in_single_quote and not in_template:
                in_double_quote = not in_double_quote
                continue
            if ch == "`" and not in_single_quote and not in_double_quote:
                in_template = not in_template
                continue

            if in_single_quote or in_double_quote or in_template:
                continue

            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return idx

        return -1
