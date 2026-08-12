#!/usr/bin/env python3
"""JSON bridge between the Next.js API and lerobot-doctor.

The bridge prefers an explicitly configured or adjacent source checkout during
development and falls back to an installed package in production. It never
mutates the dataset; only lerobot-doctor's diagnostic loader/check runner is
imported.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
from pathlib import Path


def _source_dir(candidate: Path) -> Path | None:
    """Accept either a lerobot-doctor repo root or its src directory."""
    candidate = candidate.expanduser().resolve()
    if (candidate / "lerobot_doctor" / "__init__.py").is_file():
        return candidate
    nested = candidate / "src"
    if (nested / "lerobot_doctor" / "__init__.py").is_file():
        return nested
    return None


def _configure_doctor_source() -> str:
    explicit = os.environ.get("LEROBOT_DOCTOR_SRC", "").strip()
    if explicit:
        source = _source_dir(Path(explicit))
        if source is None:
            raise RuntimeError(
                "LEROBOT_DOCTOR_SRC does not contain lerobot_doctor/__init__.py: "
                f"{explicit}"
            )
        sys.path.insert(0, str(source))
        return "LEROBOT_DOCTOR_SRC"

    viewer_root = Path(__file__).resolve().parents[1]
    sibling = _source_dir(viewer_root.parent / "lerobot-doctor")
    if sibling is not None:
        sys.path.insert(0, str(sibling))
        return "adjacent checkout"

    return "installed package"


def _error_payload(error: Exception) -> dict:
    missing = error.name if isinstance(error, ModuleNotFoundError) else None
    if missing:
        message = f"Python dependency '{missing}' is not installed."
        error_type = "dependency"
    else:
        message = str(error) or error.__class__.__name__
        error_type = "diagnostic"
    return {
        "ok": False,
        "error": message,
        "error_type": error_type,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", help="Absolute local dataset directory")
    parser.add_argument("--max-episodes", type=int, default=None)
    parser.add_argument("--checks", default="")
    args = parser.parse_args()

    if args.max_episodes is not None and args.max_episodes < 1:
        print(json.dumps({"ok": False, "error": "max episodes must be positive"}))
        return 2

    started = time.perf_counter()
    try:
        doctor_source = _configure_doctor_source()
        from lerobot_doctor.dataset_loader import load_dataset
        from lerobot_doctor.report import report_to_json
        from lerobot_doctor.runner import run_checks

        checks = [item for item in args.checks.split(",") if item] or None

        # Third-party diagnostics should not be able to corrupt the one-line
        # protocol if a dependency happens to print progress to stdout.
        with contextlib.redirect_stdout(sys.stderr):
            dataset = load_dataset(args.dataset, max_episodes=args.max_episodes)
            diagnostic = run_checks(dataset, checks=checks, verbose=False)
            report = json.loads(report_to_json(diagnostic))

        payload = {
            "ok": True,
            "report": report,
            "execution": {
                "duration_ms": round((time.perf_counter() - started) * 1000),
                "requested_max_episodes": args.max_episodes,
                "loaded_episode_count": len(dataset.episodes_data),
                "loaded_episode_indices": [
                    episode.episode_index for episode in dataset.episodes_data
                ],
                "doctor_source": doctor_source,
            },
        }
        print(json.dumps(payload, separators=(",", ":")))
        return 0
    except Exception as error:  # noqa: BLE001 - boundary must stay JSON-safe
        print(json.dumps(_error_payload(error), separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
