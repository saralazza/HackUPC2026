from collections import defaultdict
from typing import Dict, Iterable, List, Set, Tuple

from .models import FunctionSymbol, GraphEdge, GraphNode, GraphResult, ParsedFileResult


class GraphBuilder:
    """Build a normalized dependency graph from parser outputs."""

    def build(self, parsed_results: Iterable[ParsedFileResult]) -> GraphResult:
        symbols_by_id: Dict[str, FunctionSymbol] = {}
        alias_index: Dict[str, Set[str]] = defaultdict(set)
        file_alias_index: Dict[str, Dict[str, Set[str]]] = defaultdict(lambda: defaultdict(set))

        parsed_results_list = list(parsed_results)
        for result in parsed_results_list:
            for symbol in result.functions:
                symbols_by_id[symbol.id] = symbol
                aliases = set(symbol.aliases)
                aliases.add(symbol.name)
                aliases.add(symbol.qualified_name)

                for alias in aliases:
                    alias_index[alias].add(symbol.id)
                    file_alias_index[symbol.file_path][alias].add(symbol.id)

        edge_pairs: Set[Tuple[str, str]] = set()

        for result in parsed_results_list:
            for call in result.calls:
                if call.caller_id not in symbols_by_id:
                    continue

                targets = self._resolve_targets(
                    callee_name=call.callee_name,
                    caller_id=call.caller_id,
                    caller_file=result.file_path,
                    alias_index=alias_index,
                    file_alias_index=file_alias_index,
                )
                for target in targets:
                    edge_pairs.add((call.caller_id, target))

        nodes = [GraphNode(id=symbol_id) for symbol_id in sorted(symbols_by_id.keys())]
        edges = [GraphEdge(source=source, target=target) for source, target in sorted(edge_pairs)]
        return GraphResult(nodes=nodes, edges=edges)

    def _resolve_targets(
        self,
        callee_name: str,
        caller_id: str,
        caller_file: str,
        alias_index: Dict[str, Set[str]],
        file_alias_index: Dict[str, Dict[str, Set[str]]],
    ) -> List[str]:
        candidates = []
        raw = callee_name.strip()
        if not raw:
            return []

        candidates.append(raw)
        if "." in raw:
            candidates.append(raw.split(".")[-1])

        seen: Set[str] = set()
        ordered_candidates: List[str] = []
        for candidate in candidates:
            if candidate not in seen:
                ordered_candidates.append(candidate)
                seen.add(candidate)

        # Prefer in-file resolution to reduce cross-file false positives.
        in_file_targets: Set[str] = set()
        file_aliases = file_alias_index.get(caller_file, {})
        for candidate in ordered_candidates:
            in_file_targets.update(file_aliases.get(candidate, set()))

        if len(in_file_targets) == 1:
            return list(in_file_targets)

        global_targets: Set[str] = set()
        for candidate in ordered_candidates:
            global_targets.update(alias_index.get(candidate, set()))

        if len(global_targets) == 1:
            return list(global_targets)

        # Recursion fallback: unresolved self-call by local function name.
        caller_leaf = caller_id.split(":", 1)[-1].split(".")[-1]
        if raw == caller_leaf:
            return [caller_id]

        return []
