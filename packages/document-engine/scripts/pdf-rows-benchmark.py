"""Paired synthetic _rows measurements; no PDFs, OCR, or external services.

Run from the repository root with the same venv used for the Python tests.
Timing, traced Python memory, and AST-instrumented operation counts are separate.
"""
from __future__ import annotations

import argparse
import ast
import builtins
from datetime import datetime, timezone
import gc
import hashlib
import importlib.metadata
import inspect
import json
import math
from pathlib import Path
import platform
import statistics
import sys
import textwrap
import time
import tracemalloc

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from pdf_report_rows_test import _baseline_rows, row_fixture
from write.pdf_report import _rows


def percentile95(values):
    """Empirical nearest-rank p95, including small-sample limitations."""
    return sorted(values)[math.ceil(0.95 * len(values)) - 1]


def identity(rows):
    return [[id(span) for span in row] for row in rows]


def counted(function, spans):
    counts = {"row_inspections": 0, "y_distance_checks": 0, "finite_checks": 0,
              "type_checks": 0, "getattr_checks": 0}

    class CountRows(ast.NodeTransformer):
        def visit_Compare(self, node):
            self.generic_visit(node)
            if isinstance(node.left, ast.Attribute) and node.left.attr == "page_index":
                return ast.copy_location(ast.BoolOp(ast.And(), [
                    ast.Call(ast.Name("_row_probe", ast.Load()), [], []), node]), node)
            return node

    def probe():
        counts["row_inspections"] += 1
        return True

    def counted_abs(value):
        counts["y_distance_checks"] += 1
        return builtins.abs(value)

    def counted_finite(value):
        counts["finite_checks"] += 1
        return math.isfinite(value)

    def counted_type(value):
        counts["type_checks"] += 1
        return builtins.type(value)

    def counted_getattr(value, name, default):
        counts["getattr_checks"] += 1
        return builtins.getattr(value, name, default)

    tree = CountRows().visit(ast.parse(textwrap.dedent(inspect.getsource(function))))
    ast.fix_missing_locations(tree)
    namespace = dict(function.__globals__, _row_probe=probe, abs=counted_abs,
                     isfinite=counted_finite, type=counted_type, getattr=counted_getattr)
    exec(compile(tree, "<counted-rows>", "exec"), namespace)
    result = namespace[function.__name__](spans)
    assert identity(result) == identity(function(spans)), "instrumentation changed rows"
    return counts


def paired_samples(functions, spans, repetitions, memory=False):
    samples = {name: [] for name in functions}
    for repetition in range(repetitions):
        order = list(functions)
        if repetition % 2:
            order.reverse()
        for name in order:
            gc.collect()
            function = functions[name]
            if memory:
                tracemalloc.start()
                result = function(spans)
                _, peak = tracemalloc.get_traced_memory()
                tracemalloc.stop()
                samples[name].append(peak)
            else:
                start = time.perf_counter_ns()
                result = function(spans)
                elapsed = time.perf_counter_ns() - start
                samples[name].append(elapsed / 1_000_000)
            del result
    return samples


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--time-repeats", type=int, default=21)
    parser.add_argument("--memory-repeats", type=int, default=5)
    parser.add_argument("--layouts", nargs="+", default=[
        "sparse", "dense", "boundaries", "overlap", "pages", "shuffled", "ties", "nonfinite"])
    parser.add_argument("--sizes", nargs="+", type=int, default=[128, 256, 512, 1024, 2048, 4096, 8192])
    args = parser.parse_args()
    if args.time_repeats < 1 or args.memory_repeats < 1 or any(size < 1 for size in args.sizes):
        parser.error("repetitions and sizes must be positive")
    functions = {"baseline": _baseline_rows, "candidate": _rows}
    report = {
        "baseline_commit": "3dd272aaeffc5feb42ab63ce8507357f3baae965",
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version, "executable": sys.executable,
        "platform": platform.platform(), "machine": platform.machine(), "processor": platform.processor(),
        "packages": {name: importlib.metadata.version(name) for name in
                     ("pypdf", "pypdfium2", "reportlab", "Pillow", "opencv-python-headless", "numpy")},
        "source_sha256": {name: hashlib.sha256(inspect.getsource(function).encode()).hexdigest()
                          for name, function in functions.items()},
        "method": {
            "time_repeats": args.time_repeats, "memory_repeats": args.memory_repeats,
            "warmups_per_function_per_case": 2, "alternate_execution_order": True,
            "gc": "enabled; collect before each call outside measurement",
            "time": "perf_counter_ns; complete _rows including both sorts; input construction excluded",
            "memory": "tracemalloc peak bytes; input/imports excluded; Python allocations, not RSS/native",
            "p95": "nearest-rank empirical p95; 21 time samples and 5 memory samples are not a tail guarantee",
            "counts": "separate AST copy counts each page predicate, abs, isfinite, type and getattr call; never timed",
            "scope": "synthetic _rows only; no PDF parsing, OCR, I/O, API or end-to-end speed claim",
        },
        "results": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for size in args.sizes:
        for layout in args.layouts:
            spans = row_fixture(layout, size)
            baseline = _baseline_rows(spans)
            assert identity(baseline) == identity(_rows(spans)), (layout, size)
            row_count = len(baseline)
            del baseline
            for function in functions.values():
                for _ in range(2):
                    function(spans)
            print(f"measuring {layout} n={size}", flush=True)
            timings = paired_samples(functions, spans, args.time_repeats)
            print(f"memory {layout} n={size}", flush=True)
            memory = paired_samples(functions, spans, args.memory_repeats, memory=True)
            print(f"counts {layout} n={size}", flush=True)
            operations = {name: counted(function, spans) for name, function in functions.items()}
            if layout in ("sparse", "pages", "shuffled"):
                assert operations["baseline"]["row_inspections"] == size * (size - 1) // 2
                assert operations["candidate"]["row_inspections"] == size - 1
            record = {"layout": layout, "n": size, "rows": row_count,
                      "input_sha256": hashlib.sha256(repr(spans).encode()).hexdigest(),
                      "time_ms": {}, "peak_bytes": {}, "counts": operations}
            for name in functions:
                record["time_ms"][name] = {"median": statistics.median(timings[name]),
                                          "p95": percentile95(timings[name]), "samples": timings[name]}
                record["peak_bytes"][name] = {"median": statistics.median(memory[name]),
                                             "p95": percentile95(memory[name]), "samples": memory[name]}
            record["median_speedup"] = record["time_ms"]["baseline"]["median"] / record["time_ms"]["candidate"]["median"]
            report["results"].append(record)
            args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(f"{layout} n={size}: median speedup={record['median_speedup']:.3f}, "
                  f"inspections={operations['baseline']['row_inspections']} -> "
                  f"{operations['candidate']['row_inspections']}", flush=True)
    report["completed_utc"] = datetime.now(timezone.utc).isoformat()
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
