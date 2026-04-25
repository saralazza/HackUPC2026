from dataclasses import dataclass, field
from typing import Dict, List, Set


@dataclass
class FunctionSymbol:
    id: str
    file_path: str
    name: str
    qualified_name: str
    aliases: Set[str] = field(default_factory=set)


@dataclass
class FunctionCall:
    caller_id: str
    callee_name: str
    file_path: str


@dataclass
class ParsedFileResult:
    file_path: str
    language: str
    functions: List[FunctionSymbol] = field(default_factory=list)
    calls: List[FunctionCall] = field(default_factory=list)


@dataclass
class GraphNode:
    id: str


@dataclass
class GraphEdge:
    source: str
    target: str


@dataclass
class GraphResult:
    nodes: List[GraphNode]
    edges: List[GraphEdge]


@dataclass
class RepositoryFile:
    path: str
    content: str
    language: str


@dataclass
class ParseBundle:
    results: List[ParsedFileResult]
    stats: Dict[str, int]
