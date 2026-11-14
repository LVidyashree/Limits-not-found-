import hashlib
import os
import shutil
import uuid
from pathlib import Path
from typing import Tuple, Dict, Any
from fastapi import UploadFile
from PIL import Image

from app.config import settings

def get_file_category(mime_type: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if mime_type.startswith("image/") or ext in [".png", ".jpg", ".jpeg", ".webp", ".bmp"]:
        return "image"
    if mime_type == "application/pdf" or ext == ".pdf":
        return "pdf"
    if mime_type.startswith("audio/") or ext in [".mp3", ".wav", ".m4a", ".aac", ".ogg"]:
        return "audio"
    if mime_type.startswith("video/") or ext in [".mp4", ".mov", ".mkv", ".webm"]:
        return "video"
    if mime_type.startswith("text/") or ext in [".txt", ".log", ".csv", ".json"]:
        return "text"
    if ext in [".doc", ".docx", ".xls", ".xlsx"]:
        return "document"
    return "other"

async def save_upload_and_hash(case_id: str, upload_file: UploadFile) -> Tuple[str, str, int, str, str, Dict[str, Any]]:
    """
    Saves an uploaded file to the secure vault directory while calculating its SHA-256 hash
    in a memory-efficient streaming manner.
    Returns: (stored_filename, file_path, file_size, sha256_hash, file_category, metadata)
    """
    case_folder = settings.UPLOAD_DIR / case_id
    os.makedirs(case_folder, exist_ok=True)
    
    original_name = upload_file.filename or "unknown_evidence"
    ext = os.path.splitext(original_name)[1]
    unique_name = f"{uuid.uuid4().hex[:12]}_{original_name.replace(' ', '_')}"
    target_path = case_folder / unique_name
    
    sha256 = hashlib.sha256()
    total_size = 0
    
    with open(target_path, "wb") as buffer:
        while True:
            chunk = await upload_file.read(64 * 1024) # 64KB chunks
            if not chunk:
                break
            buffer.write(chunk)
            sha256.update(chunk)
            total_size += len(chunk)
            
    hash_digest = sha256.hexdigest()
    mime = upload_file.content_type or "application/octet-stream"
    category = get_file_category(mime, original_name)
    
    # Extract metadata if image
    metadata: Dict[str, Any] = {
        "original_filename": original_name,
        "content_type": mime,
        "size_bytes": total_size
    }
    
    if category == "image":
        try:
            with Image.open(target_path) as img:
                metadata["width"] = img.width
                metadata["height"] = img.height
                metadata["format"] = img.format
        except Exception:
            pass

    return unique_name, str(target_path), total_size, hash_digest, category, metadata

def verify_file_hash(file_path: str, expected_hash: str) -> bool:
    """Verifies that an on-disk file has not been altered since initial ingestion."""
    if not os.path.exists(file_path):
        return False
    
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(64 * 1024):
            sha256.update(chunk)
            
    return sha256.hexdigest().lower() == expected_hash.lower()
