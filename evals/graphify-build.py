"""Build a Graphify knowledge graph for a project directory.

Optional maintainer tool — Graphify is NOT a Kailashe dependency. It is a
user-installed external tool (PyPI `graphifyy`, Apache-2.0); Kailashe only
reads the `graphify-out/graph.json` this produces (see
packages/scan/src/graphify.ts). Pinned setup:

    uv venv %TEMP%\kailashe-graphify-venv --python 3.13
    uv pip install --python %TEMP%\kailashe-graphify-venv\Scripts\python.exe graphifyy==0.9.97
    python evals/graphify-build.py <project-dir> <project-dir>\graphify-out\graph.json

Structural (AST) extraction only: deterministic and fully local — the
code-extraction half of Graphify's own recipe
(detect -> extract -> build_from_json -> cluster -> to_json).
The semantic pass over documents that the /graphify skill performs with
LLM subagents is intentionally not replicated here.
"""
import sys
from pathlib import Path

from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.detect import detect
from graphify.export import to_json
from graphify.extract import extract


def main() -> int:
    target = Path(sys.argv[1]).resolve()
    out_path = Path(sys.argv[2]).resolve()

    det = detect(target)
    files = det.get("files", {})
    code_files = [Path(p) for p in files.get("code", [])]
    print(f"detect: {det.get('total_files')} files "
          f"({len(code_files)} code, {len(files.get('document', []))} documents)")

    extraction = extract(code_files, root=target)
    print(f"extract: {len(extraction.get('nodes', []))} nodes, "
          f"{len(extraction.get('edges', []))} edges")

    graph = build_from_json(extraction, root=target)
    communities = cluster(graph)
    print(f"graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, "
          f"{len(communities)} communities")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    ok = to_json(graph, communities, str(out_path), force=True)
    print(f"to_json -> {out_path} ({'ok' if ok else 'FAILED'})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
