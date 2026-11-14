"""
Qwen Inference Service — EvidenceVault
=======================================
Loads the GGUF model using llama-cpp-python.

Design principles:
- Singleton: only one model instance is ever loaded.
- Lazy load: model is loaded on first inference call, not at startup.
- Graceful: if the GGUF file is missing, returns MODEL_NOT_FOUND status.
- Never crashes the FastAPI backend.
- CPU-optimised for 8 GB RAM Windows machines.
"""

import os
import json
import logging
import threading
from enum import Enum
from typing import Optional, Dict, Any

from app.config import settings

logger = logging.getLogger(__name__)

# ─── Status Enum ───────────────────────────────────────────────────────────────

class ModelStatus(str, Enum):
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
    MODEL_AVAILABLE = "MODEL_AVAILABLE"
    MODEL_LOADED = "MODEL_LOADED"
    INFERENCE_ERROR = "INFERENCE_ERROR"


# ─── Singleton State ───────────────────────────────────────────────────────────

_llm = None                        # llama_cpp.Llama instance
_load_lock = threading.Lock()      # guard against concurrent loading


def get_model_path() -> str:
    """Return the resolved model path from settings."""
    raw = settings.QWEN_MODEL_PATH
    if not os.path.isabs(raw):
        # Resolve relative to backend/ directory
        base_dir = settings.BASE_DIR
        raw = str(base_dir / raw)
    return os.path.normpath(raw)


def get_model_status() -> Dict[str, Any]:
    """
    Returns a dict describing the current model state.
    Does NOT attempt to load the model.
    """
    global _llm
    path = get_model_path()

    if _llm is not None:
        return {
            "status": ModelStatus.MODEL_LOADED,
            "model_path": path,
            "message": "Qwen2.5-3B-Instruct is loaded and ready for inference.",
        }

    if os.path.isfile(path):
        size_mb = round(os.path.getsize(path) / (1024 * 1024), 1)
        return {
            "status": ModelStatus.MODEL_AVAILABLE,
            "model_path": path,
            "file_size_mb": size_mb,
            "message": (
                f"GGUF file found ({size_mb} MB). "
                "Model will be loaded on first inference request."
            ),
        }

    return {
        "status": ModelStatus.MODEL_NOT_FOUND,
        "model_path": path,
        "message": (
            f"GGUF model file not found at: {path}\n"
            "Place Qwen2.5-3B-Instruct.Q4_K_M.gguf at the configured path, "
            "or set QWEN_MODEL_PATH in backend/.env."
        ),
    }


def load_model() -> bool:
    """
    Loads the Qwen model into memory.
    Returns True on success, False on failure.
    Thread-safe.
    """
    global _llm

    if _llm is not None:
        return True  # Already loaded

    with _load_lock:
        if _llm is not None:
            return True  # Another thread loaded it while we waited

        path = get_model_path()

        if not os.path.isfile(path):
            logger.warning(
                f"[QwenService] GGUF file not found at: {path}. "
                "Inference will be unavailable until the model is placed there."
            )
            return False

        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError:
            logger.error(
                "[QwenService] llama-cpp-python is not installed. "
                "Run: pip install llama-cpp-python"
            )
            return False

        try:
            logger.info(f"[QwenService] Loading Qwen model from {path} ...")
            _llm = Llama(
                model_path=path,
                n_ctx=4096,          # context window
                n_threads=4,         # CPU threads (safe for 8 GB RAM)
                n_gpu_layers=0,      # CPU-only — no GPU required
                n_batch=512,
                verbose=False,
            )
            logger.info("[QwenService] Qwen2.5-3B-Instruct loaded successfully.")
            return True
        except Exception as exc:
            logger.error(f"[QwenService] Failed to load model: {exc}")
            _llm = None
            return False


def get_llm():
    """Return the loaded Llama instance, loading it on first call."""
    global _llm
    if _llm is None:
        load_model()
    return _llm


# ─── Core Inference ────────────────────────────────────────────────────────────

def run_inference(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 1024,
    temperature: float = 0.1,
) -> Dict[str, Any]:
    """
    Sends a prompt to the loaded Qwen model and returns the raw response.

    Returns:
    {
        "success": bool,
        "text": str,          # raw model output
        "status": ModelStatus,
        "error": str | None,
    }
    """
    llm = get_llm()

    if llm is None:
        status = get_model_status()
        return {
            "success": False,
            "text": "",
            "status": status["status"],
            "error": status["message"],
        }

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_prompt},
    ]

    try:
        response = llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["</s>", "<|im_end|>"],
        )
        raw_text = response["choices"][0]["message"]["content"].strip()
        return {
            "success": True,
            "text": raw_text,
            "status": ModelStatus.MODEL_LOADED,
            "error": None,
        }
    except Exception as exc:
        logger.error(f"[QwenService] Inference error: {exc}")
        return {
            "success": False,
            "text": "",
            "status": ModelStatus.INFERENCE_ERROR,
            "error": str(exc),
        }


def run_json_inference(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 1024,
    temperature: float = 0.1,
) -> Dict[str, Any]:
    """
    Runs inference and attempts to parse JSON from the model output.

    Returns:
    {
        "success": bool,
        "data": dict | None,   # parsed JSON
        "raw_text": str,
        "status": ModelStatus,
        "error": str | None,
        "parse_error": str | None,
    }
    """
    result = run_inference(system_prompt, user_prompt, max_tokens, temperature)

    if not result["success"]:
        return {
            "success": False,
            "data": None,
            "raw_text": result["text"],
            "status": result["status"],
            "error": result["error"],
            "parse_error": None,
        }

    raw_text = result["text"]

    # Strip markdown code fences if present
    text_to_parse = raw_text
    if "```json" in text_to_parse:
        text_to_parse = text_to_parse.split("```json", 1)[1]
        text_to_parse = text_to_parse.split("```")[0]
    elif "```" in text_to_parse:
        text_to_parse = text_to_parse.split("```", 1)[1]
        text_to_parse = text_to_parse.split("```")[0]

    # Try to find the first JSON object or array
    text_to_parse = text_to_parse.strip()
    start_obj = text_to_parse.find("{")
    start_arr = text_to_parse.find("[")

    if start_obj == -1 and start_arr == -1:
        return {
            "success": False,
            "data": None,
            "raw_text": raw_text,
            "status": ModelStatus.INFERENCE_ERROR,
            "error": None,
            "parse_error": "No JSON object or array found in model output.",
        }

    if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
        text_to_parse = text_to_parse[start_obj:]
    else:
        text_to_parse = text_to_parse[start_arr:]

    try:
        data = json.loads(text_to_parse)
        return {
            "success": True,
            "data": data,
            "raw_text": raw_text,
            "status": ModelStatus.MODEL_LOADED,
            "error": None,
            "parse_error": None,
        }
    except json.JSONDecodeError as je:
        # Attempt partial JSON recovery: truncate at last complete brace
        logger.warning(f"[QwenService] JSON parse error: {je}. Attempting recovery.")
        try:
            # Try to close truncated JSON
            last_brace = text_to_parse.rfind("}")
            if last_brace > 0:
                data = json.loads(text_to_parse[:last_brace + 1])
                return {
                    "success": True,
                    "data": data,
                    "raw_text": raw_text,
                    "status": ModelStatus.MODEL_LOADED,
                    "error": None,
                    "parse_error": f"Partial JSON recovered. Original error: {je}",
                }
        except Exception:
            pass

        return {
            "success": False,
            "data": None,
            "raw_text": raw_text,
            "status": ModelStatus.INFERENCE_ERROR,
            "error": None,
            "parse_error": f"JSON parse failed: {je}",
        }
