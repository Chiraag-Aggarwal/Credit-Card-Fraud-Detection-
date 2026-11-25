from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TransactionFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Time: float = Field(allow_inf_nan=False)
    V1: float = Field(allow_inf_nan=False)
    V2: float = Field(allow_inf_nan=False)
    V3: float = Field(allow_inf_nan=False)
    V4: float = Field(allow_inf_nan=False)
    V5: float = Field(allow_inf_nan=False)
    V6: float = Field(allow_inf_nan=False)
    V7: float = Field(allow_inf_nan=False)
    V8: float = Field(allow_inf_nan=False)
    V9: float = Field(allow_inf_nan=False)
    V10: float = Field(allow_inf_nan=False)
    V11: float = Field(allow_inf_nan=False)
    V12: float = Field(allow_inf_nan=False)
    V13: float = Field(allow_inf_nan=False)
    V14: float = Field(allow_inf_nan=False)
    V15: float = Field(allow_inf_nan=False)
    V16: float = Field(allow_inf_nan=False)
    V17: float = Field(allow_inf_nan=False)
    V18: float = Field(allow_inf_nan=False)
    V19: float = Field(allow_inf_nan=False)
    V20: float = Field(allow_inf_nan=False)
    V21: float = Field(allow_inf_nan=False)
    V22: float = Field(allow_inf_nan=False)
    V23: float = Field(allow_inf_nan=False)
    V24: float = Field(allow_inf_nan=False)
    V25: float = Field(allow_inf_nan=False)
    V26: float = Field(allow_inf_nan=False)
    V27: float = Field(allow_inf_nan=False)
    V28: float = Field(allow_inf_nan=False)
    Amount: float = Field(ge=0, allow_inf_nan=False)


class PredictionResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    fraud_probability: float = Field(ge=0, le=1)
    risk_label: Literal["LOW", "MEDIUM", "HIGH"]
    is_fraud: bool
    threshold: float = Field(ge=0, le=1)
    model_version: str


class ModelMetrics(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    precision: float = Field(ge=0, le=1)
    recall: float = Field(ge=0, le=1)
    f1: float = Field(ge=0, le=1)
    roc_auc: float = Field(ge=0, le=1)
    pr_auc: float = Field(ge=0, le=1)
    confusion_matrix: list[list[int]]

    @field_validator("confusion_matrix", mode="before")
    @classmethod
    def validate_confusion_matrix(cls, value):
        if (
            not isinstance(value, list)
            or len(value) != 2
            or any(not isinstance(row, list) or len(row) != 2 for row in value)
            or any(type(count) is not int or count < 0 for row in value for count in row)
        ):
            raise ValueError("Confusion matrix must contain two rows of two non-negative integers.")
        return value


class ModelInfoResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    model_version: str
    threshold: float = Field(ge=0, le=1)
    min_precision: float = Field(ge=0, le=1)
    trained_at: str
    metrics: ModelMetrics


class FeatureImpact(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    feature: str
    value: float
    impact: float
    direction: Literal["increases_risk", "decreases_risk"]


class ExplanationResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    fraud_probability: float = Field(ge=0, le=1)
    threshold: float = Field(ge=0, le=1)
    model_version: str
    method: Literal["tree_shap", "linear_coefficients"]
    baseline_log_odds: float
    top_factors: list[FeatureImpact]
