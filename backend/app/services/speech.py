import os
import logging
from typing import Dict, Any, List
from app.config import settings

logger = logging.getLogger(__name__)

# Global model instance for lazy loading
_whisper_model = None

def get_whisper_model():
    """
    Lazy loader for OpenAI Whisper model.
    Loads the model into memory only when the first audio file is uploaded,
    preventing slow startup times or unnecessary RAM consumption.
    """
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper
            logger.info(f"Loading Whisper model '{settings.WHISPER_MODEL}' on device '{settings.WHISPER_DEVICE}'...")
            _whisper_model = whisper.load_model(settings.WHISPER_MODEL, device=settings.WHISPER_DEVICE)
            logger.info("Whisper model loaded successfully.")
        except ImportError:
            logger.error("The 'openai-whisper' package is not installed. Run 'pip install openai-whisper torch'.")
            raise RuntimeError("Whisper is not installed. Please install 'openai-whisper'.")
        except Exception as e:
            logger.error(f"Error initializing Whisper model: {e}")
            raise
    return _whisper_model

def format_timestamp(seconds: float) -> str:
    """Formats float seconds into MM:SS format for forensic audio logs."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"

def transcribe_audio(audio_file_path: str) -> Dict[str, Any]:
    """
    Transcribes cybercrime audio recordings (scam calls, WhatsApp voice notes, extortion calls).
    
    Returns:
    {
        "text": Complete transcript with forensic timestamp markers,
        "raw_text": Unmarked plain text,
        "language": Detected spoken language (e.g., 'en', 'hi'),
        "segments": List of timestamped dialogue segments,
        "status": "success" | "error"
    }
    """
    if not os.path.exists(audio_file_path):
        return {
            "text": "",
            "raw_text": "",
            "language": "unknown",
            "segments": [],
            "status": "error",
            "error": "File not found on disk"
        }

    try:
        model = get_whisper_model()
        
        # Transcribe with fp16=False for standard CPU execution compatibility
        is_cpu = settings.WHISPER_DEVICE.lower() == "cpu"
        result = model.transcribe(
            audio_file_path,
            fp16=not is_cpu,
            verbose=False
        )

        detected_language = result.get("language", "unknown")
        raw_text = result.get("text", "").strip()

        # Build formatted timestamped transcript
        formatted_lines: List[str] = []
        structured_segments: List[Dict[str, Any]] = []

        for seg in result.get("segments", []):
            start_str = format_timestamp(seg.get("start", 0.0))
            end_str = format_timestamp(seg.get("end", 0.0))
            seg_text = seg.get("text", "").strip()

            if seg_text:
                formatted_lines.append(f"[{start_str} - {end_str}] {seg_text}")
                structured_segments.append({
                    "start": seg.get("start"),
                    "end": seg.get("end"),
                    "start_formatted": start_str,
                    "end_formatted": end_str,
                    "text": seg_text
                })

        full_timestamped_transcript = "\n".join(formatted_lines) if formatted_lines else raw_text

        return {
            "text": full_timestamped_transcript,
            "raw_text": raw_text,
            "language": detected_language,
            "segments": structured_segments,
            "status": "success"
        }

    except RuntimeError as re:
        logger.warning(f"Whisper speech-to-text not available: {re}")
        return {
            "text": "[Audio transcription unavailable: openai-whisper / ffmpeg not installed]",
            "raw_text": "",
            "language": "unknown",
            "segments": [],
            "status": "unavailable",
            "error": str(re)
        }
    except Exception as e:
        logger.error(f"Whisper transcription failed for {audio_file_path}: {e}")
        return {
            "text": f"[Audio transcription error: {str(e)}]",
            "raw_text": "",
            "language": "unknown",
            "segments": [],
            "status": "error",
            "error": str(e)
        }
