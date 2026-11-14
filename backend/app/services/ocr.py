import os
import logging
from PIL import Image
from pypdf import PdfReader
from app.config import settings

logger = logging.getLogger(__name__)

if settings.TESSERACT_CMD:
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
    except Exception as e:
        logger.warning(f"Could not configure pytesseract with {settings.TESSERACT_CMD}: {e}")

def extract_text_from_file(file_path: str, category: str) -> str:
    """
    Extracts readable text from images (via OCR), PDFs, or text documents.
    """
    if not os.path.exists(file_path):
        return ""

    if category == "text":
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error reading text file {file_path}: {e}")
            return ""

    elif category == "pdf":
        try:
            reader = PdfReader(file_path)
            extracted_pages = []
            for i, page in enumerate(reader.pages):
                text = page.extract_text()
                if text:
                    extracted_pages.append(f"--- Page {i + 1} ---\n{text}")
            return "\n\n".join(extracted_pages)
        except Exception as e:
            logger.error(f"Error extracting PDF text from {file_path}: {e}")
            return ""

    elif category == "image":
        try:
            import pytesseract
            with Image.open(file_path) as img:
                # Convert to RGB if needed
                if img.mode != "RGB":
                    img = img.convert("RGB")
                text = pytesseract.image_to_string(img)
                return text.strip()
        except Exception as e:
            logger.warning(f"Tesseract OCR not available or failed for image {file_path}: {e}")
            return ""

    return ""
