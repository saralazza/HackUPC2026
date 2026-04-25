import ast
from dataclasses import dataclass
from typing import List, Optional

from ..models import FunctionCall, FunctionSymbol, ParsedFileResult


@dataclass
class _ContextFrame:
    name: str
    is_class: bool


class _PythonAnalyzer(ast.NodeVisitor):
    def __init__(self, file_path: str) -> None:
        self.file_path = file_path
        self.frames: List[_ContextFrame] = []
        self.active_function_ids: List[str] = []
        self.functions: List[FunctionSymbol] = []
        self.calls: List[FunctionCall] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.frames.append(_ContextFrame(name=node.name, is_class=True))
        self.generic_visit(node)
        self.frames.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.AST) -> None:
        if not hasattr(node, "name"):
            return

        function_name = str(getattr(node, "name"))
        qualifier_parts = [frame.name for frame in self.frames if frame.is_class]
        nested_parts = [frame.name for frame in self.frames if not frame.is_class]

        qualified_parts = qualifier_parts + nested_parts + [function_name]
        qualified_name = ".".join(qualified_parts)
        symbol_id = f"{self.file_path}:{qualified_name}"

        aliases = {function_name, qualified_name}
        if qualifier_parts:
            aliases.add(f"{qualifier_parts[-1]}.{function_name}")

        self.functions.append(
            FunctionSymbol(
                id=symbol_id,
                file_path=self.file_path,
                name=function_name,
                qualified_name=qualified_name,
                aliases=aliases,
            )
        )

        self.frames.append(_ContextFrame(name=function_name, is_class=False))
        self.active_function_ids.append(symbol_id)
        self.generic_visit(node)
        self.active_function_ids.pop()
        self.frames.pop()

    def visit_Call(self, node: ast.Call) -> None:
        if self.active_function_ids:
            callee_name = self._extract_callee_name(node.func)
            if callee_name:
                self.calls.append(
                    FunctionCall(
                        caller_id=self.active_function_ids[-1],
                        callee_name=callee_name,
                        file_path=self.file_path,
                    )
                )
        self.generic_visit(node)

    def _extract_callee_name(self, node: ast.AST) -> Optional[str]:
        if isinstance(node, ast.Name):
            return node.id

        if isinstance(node, ast.Attribute):
            suffix = node.attr
            value_name = self._extract_callee_name(node.value)
            if value_name:
                return f"{value_name}.{suffix}"
            return suffix

        return None


class PythonParser:
    language = "python"

    def parse(self, file_path: str, source: str) -> ParsedFileResult:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return ParsedFileResult(file_path=file_path, language=self.language)

        analyzer = _PythonAnalyzer(file_path=file_path)
        analyzer.visit(tree)

        return ParsedFileResult(
            file_path=file_path,
            language=self.language,
            functions=analyzer.functions,
            calls=analyzer.calls,
        )
