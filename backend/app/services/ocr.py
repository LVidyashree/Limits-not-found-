import os
import shutil
import logging
from PIL import Image, ImageEnhance, ImageFilter
from pypdf import PdfReader
from app.config import settings

logger = logging.getLogger(__name__)

# Auto-detect Tesseract binary on Windows / Linux if not explicitly provided
def _find_tesseract_binary() -> str | None:
    if settings.TESSERACT_CMD and os.path.exists(settings.TESSERACT_CMD):
        return settings.TESSERACT_CMD

    # Check if 'tesseract' is in system PATH
    which_path = shutil.which("tesseract")
    if which_path:
        return which_path

    # Common Windows installation directories
    windows_candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in windows_candidates:
        if os.path.exists(candidate):
            return candidate

    return None

tesseract_path = _find_tesseract_binary()
if tesseract_path:
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = tesseract_path
        logger.info(f"Configured Tesseract OCR at: {tesseract_path}")
    except Exception as e:
        logger.warning(f"Failed to initialize pytesseract: {e}")
else:
    logger.info("Tesseract binary not found in standard paths. Install Tesseract to enable image OCR.")

def _preprocess_screenshot(image: Image.Image) -> Image.Image:
    """
    Applies image preprocessing tailored for chat screenshots (WhatsApp, Telegram, etc.)
    and transaction receipts to maximize OCR recognition accuracy.
    """
    # 1. Convert to RGB if palette or alpha
    if image.mode != "RGB":
        image = image.convert("RGB")

    # 2. Convert to Grayscale
    gray = image.convert("L")

    # 3. Enhance Contrast (improves text readability against chat bubble backgrounds)
    enhancer = ImageEnhance.Contrast(gray)
    contrasted = enhancer.enhance(1.8)

    # 4. Sharpen
    sharpened = contrasted.filter(ImageFilter.SHARPEN)

    return sharpened

def run_image_ocr(image_path: str) -> str:
    """
    Runs Tesseract OCR on an image file with multi-pass preprocessing.
    """
    try:
        import pytesseract
    except ImportError:
        logger.warning("pytesseract is not installed. Run 'pip install pytesseract'")
        return ""

    if not os.path.exists(image_path):
        return ""

    try:
        with Image.open(image_path) as img:
            # First pass: Original image with default layout analysis
            custom_config = r'--oem 3 --psm 3'
            text = pytesseract.image_to_string(img, config=custom_config).strip()

            # Second pass: If original yield is low or empty, run preprocessed pass
            if len(text) < 15:
                preprocessed = _preprocess_screenshot(img)
                # PSM 6 assumes a single uniform block of text (common in chat captures)
                fallback_text = pytesseract.image_to_string(preprocessed, config=r'--oem 3 --psm 6').strip()
                if len(fallback_text) > len(text):
                    text = fallback_text

            return text
    except Exception as e:
        logger.warning(f"Tesseract OCR processing failed for {image_path}: {e}")
        return ""

def extract_text_from_file(file_path: str, category: str) -> str:
    """
    Unified text extraction router for text files, PDF documents, and image screenshots.
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
                    extracted_pages.append(f"--- Page {i + 1} ---\n{text.strip()}")
            return "\n\n".join(extracted_pages)
        except Exception as e:
            logger.error(f"Error extracting PDF text from {file_path}: {e}")
            return ""

    elif category == "image":
        return run_image_ocr(file_path)

    return ""
