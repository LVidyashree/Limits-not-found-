"""
Qwen API Schemas — EvidenceVault
=================================
Pydantic response models for all Qwen AI endpoints.
"""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class ModelStatusResponse(BaseModel):
    status: str             # MODEL_NOT_FOUND | MODEL_AVAILABLE | MODEL_LOADED | INFERENCE_ERROR
    model_path: str
    message: str
    file_size_mb: Optional[float] = None


class QwenCapabilityResponse(BaseModel):
    capability: str
    model_status: str
    error: Optional[str] = None
    result: Optional[Any] = None
    raw_model_output: Optional[str] = None
    human_review_required: bool = True
    timestamp: str


class QwenAnalyzeAllResponse(BaseModel):
    case_id: str
    case_title: str
    analysis_timestamp: str
    model_status: str
    results: Dict[str, Any]
    human_review_required: bool = True


class QwenReportResponse(BaseModel):
    capability: str
    model_status: str
    timestamp: str
    human_review_required: bool = True
    report: Optional[Dict[str, Any]] = None
    errors: Optional[Dict[str, Any]] = None
