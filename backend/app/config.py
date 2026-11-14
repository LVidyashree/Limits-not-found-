import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "Digital Evidence Intelligent Interface API"
    APP_VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = True
    
    # Security
    SECRET_KEY: str = "vault-super-secret-key-change-in-production"
    
    # Storage settings
    BASE_DIR: Path = Path(__file__).resolve().parent.parent
    UPLOAD_DIR: Path = BASE_DIR / "storage_vault"
    MAX_UPLOAD_SIZE_BYTES: int = 50 * 1024 * 1024  # 50MB
    
    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'evidence_vault.db'}"
    
    # OCR and AI configuration
    TESSERACT_CMD: str | None = None
    WHISPER_MODEL: str = "base" # "tiny", "base", "small", "medium"
    WHISPER_DEVICE: str = "cpu" # "cpu" or "cuda"
    GEMINI_API_KEY: str | None = None

    # Qwen GGUF model configuration
    # Set QWEN_MODEL_PATH in .env to point to your GGUF file.
    # Relative paths are resolved from backend/ directory.
    QWEN_MODEL_PATH: str = "./models/Qwen2.5-3B-Instruct.Q4_K_M.gguf"
    QWEN_N_CTX: int = 4096         # Context window
    QWEN_N_THREADS: int = 4        # CPU threads (safe for 8 GB RAM)
    QWEN_MAX_TOKENS: int = 1024    # Default max tokens per response
    
    # Legal Certificate defaults
    CERTIFICATE_ISSUER_TITLE: str = "Digital Evidence Handling System / EvidenceVault"
    STATUTORY_SECTION: str = "Section 65B of Indian Evidence Act / Section 63 Bharatiya Sakshya Adhiniyam"
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# Ensure storage directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
