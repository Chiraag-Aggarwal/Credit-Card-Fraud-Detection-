import json
from pathlib import Path
from typing import Any
import warnings

import joblib
import numpy as np
import pandas as pd
from pydantic import ValidationError
from sklearn.exceptions import InconsistentVersionWarning

from app.schemas import ModelInfoResponse


ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "model.joblib"
THRESHOLD_PATH = ARTIFACTS_DIR / "threshold.json"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"
FEATURE_COLUMNS = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]


def predict_probabilities(model: Any, rows: pd.DataFrame) -> np.ndarray:
    """Reject broken or incompatible model outputs before they reach API clients."""
    if not np.array_equal(getattr(model, "classes_", None), [0, 1]):
        raise RuntimeError("Model classes must be ordered as genuine (0), fraud (1).")
    probabilities = np.asarray(model.predict_proba(rows), dtype=float)
    if (
        probabilities.shape != (len(rows), 2)
        or not np.isfinite(probabilities).all()
        or (probabilities < 0).any()
        or (probabilities > 1).any()
        or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-6)
    ):
        raise RuntimeError("Model returned invalid class probabilities.")
    return probabilities[:, 1]


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Required model artifact is missing: {path}")
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read model artifact {path}: {error}") from error
    if not isinstance(content, dict):
        raise RuntimeError(f"Model artifact must contain a JSON object: {path}")
    return content


def load_model_artifacts() -> tuple[Any, float, dict[str, Any], str, dict[str, Any]]:
    """Load the model and its metadata once as the API starts."""
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Required model artifact is missing: {MODEL_PATH}")
    try:
        # Serialized estimators are not portable across arbitrary sklearn releases.
        # Fail at startup instead of silently serving predictions after a mismatch.
        with warnings.catch_warnings():
            warnings.simplefilter("error", InconsistentVersionWarning)
            model = joblib.load(MODEL_PATH)
    except Exception as error:
        raise RuntimeError(f"Could not load model artifact {MODEL_PATH}: {error}") from error

    threshold_data = _read_json(THRESHOLD_PATH)
    metrics = _read_json(METRICS_PATH)
    threshold = threshold_data.get("threshold")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        raise RuntimeError(f"Artifact {THRESHOLD_PATH} must contain a numeric threshold.")
    if not 0 <= threshold <= 1:
        raise RuntimeError(f"Artifact threshold must be between 0 and 1: {THRESHOLD_PATH}")
    min_precision = threshold_data.get("min_precision")
    if (
        isinstance(min_precision, bool)
        or not isinstance(min_precision, (int, float))
        or not 0 <= min_precision <= 1
    ):
        raise RuntimeError(
            f"Artifact {THRESHOLD_PATH} must contain a numeric min_precision "
            "between 0 and 1."
        )

    model_version = metrics.get("model_version")
    if not isinstance(model_version, str) or not model_version.strip():
        raise RuntimeError(
            f"Artifact {METRICS_PATH} must contain a non-empty model_version."
        )
    required_metrics = (
        "trained_at",
        "precision",
        "recall",
        "f1",
        "roc_auc",
        "pr_auc",
        "confusion_matrix",
    )
    missing_metrics = [name for name in required_metrics if name not in metrics]
    if missing_metrics:
        raise RuntimeError(
            f"Artifact {METRICS_PATH} is missing required fields: "
            f"{', '.join(missing_metrics)}"
        )
    try:
        ModelInfoResponse(
            model_version=model_version,
            threshold=threshold,
            min_precision=min_precision,
            trained_at=metrics["trained_at"],
            metrics={name: metrics[name] for name in required_metrics if name != "trained_at"},
        )
    except ValidationError as error:
        raise RuntimeError("Model metadata contains invalid metric values.") from error
    try:
        # One prediction also detects estimator/runtime incompatibilities that do not
        # emit a pickle-version warning. It is a readiness check, not an evaluation.
        predict_probabilities(model, pd.DataFrame([[0.0] * 30], columns=FEATURE_COLUMNS))
    except Exception as error:
        raise RuntimeError("Loaded model failed its prediction readiness check.") from error
    return model, float(threshold), metrics, model_version, threshold_data
