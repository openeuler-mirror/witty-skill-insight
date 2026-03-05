import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def read_pdf(file_path: str) -> str:
    errors = []

    try:
        import fitz  # PyMuPDF

        text = []
        with fitz.open(file_path) as doc:
            for page in doc:
                text.append(page.get_text())
    except ImportError:
        errors.append("PyMuPDF (fitz) not installed")
    except Exception as e:
        errors.append(f"PyMuPDF failed: {e}")

    # Try pypdf
    try:
        import pypdf

        reader = pypdf.PdfReader(file_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    except ImportError:
        errors.append("pypdf not installed")
    except Exception as e:
        errors.append(f"pypdf failed: {e}")

    # Try pdfminer
    try:
        from pdfminer.high_level import extract_text

        return extract_text(file_path)
    except ImportError:
        errors.append("pdfminer.six not installed")
    except Exception as e:
        errors.append(f"pdfminer failed: {e}")

    # Try pdftotext
    try:
        import pdftotext

        with open(file_path, "rb") as f:
            pdf = pdftotext.PDF(f)
        return "\n\n".join(pdf)
    except ImportError:
        errors.append("pdftotext not installed")
    except Exception as e:
        errors.append(f"pdftotext failed: {e}")

    raise Exception(f"Failed to read PDF. Errors: {'; '.join(errors)}")


def read_doc(file_path: str) -> str:
    """
    Reads the content of a document file (PDF, Markdown, Text).
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        return read_pdf(file_path)
    elif ext in [".md", ".txt", ".markdown"]:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except UnicodeDecodeError:
            # Try fallback encoding if utf-8 fails
            with open(file_path, "r", encoding="latin-1") as f:
                return f.read()
    else:
        # Try reading as text for unknown extensions
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            raise ValueError(
                f"Unsupported file format or encoding error: {ext}. Error: {e}"
            )
