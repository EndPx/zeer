"""Public chain-data benchmark helpers; no Zeer engine implementation."""

__all__ = [
    "BenchmarkError", "DeadlineExceeded", "JsonRpcAdapter", "canonical_sha256",
    "freeze_manifest", "normalize_record", "render_markdown", "run_benchmark",
    "validate_manifest", "verify_records", "write_report",
]


def __getattr__(name):
    # Keep `python -m benchmarks.runner.harness` free of double-import warnings.
    if name in __all__:
        from . import harness
        return getattr(harness, name)
    raise AttributeError(name)
