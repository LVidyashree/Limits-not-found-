# Digital Evidence Intelligent Interface - FastAPI Backend

A specialized forensic digital evidence vault and correlation engine designed for cybercrime victims, advocates, and law enforcement agencies.

The platform takes fragmented multi-modal evidence (screenshots, bank statements, chat exports, audio voice notes, and payment slips) uploaded by victims, cryptographically secures them under an unbroken chain of custody, extracts forensic entities (UPI IDs, UTR transaction numbers, phone numbers, crypto wallets, phishing URLs, and coercive threat terms), and **puts it all together** into:
1. An interconnected **Entity Correlation Graph** linking suspects across files.
2. An automated **Chronological Milestone Timeline**.
3. An executive **Incident Modus Operandi & Synthesis Narrative**.
4. A court-ready **Case Dossier & Statutory Electronic Evidence Certificate** (compliant with Section 65B of the Indian Evidence Act / Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 / Federal Rules of Evidence Rule 902).

---

## 🏗️ Architecture & Directory Structure

```
backend/
├── app/
│   ├── main.py                  # FastAPI application setup, CORS, router mounts
│   ├── config.py                # Environment and storage configuration
│   ├── database.py              # SQLAlchemy engine & session dependency
│   ├── models/                  # Database models (SQLite / PostgreSQL)
│   │   ├── case.py              # Incidents & case dossiers
│   │   ├── evidence.py          # Evidence records & SHA-256 hashes
│   │   ├── finding.py           # Extracted identifiers (UPI, phone, crypto, UTR)
│   │   ├── timeline.py          # Chronological timeline milestones
│   │   └── custody.py           # Immutable chain-of-custody audit logs
│   ├── schemas/                 # Pydantic validation schemas
│   │   ├── case.py              # Case create, response & statistics schemas
│   │   ├── evidence.py          # Evidence upload and verification schemas
│   │   ├── finding.py           # Finding verification schemas
│   │   ├── timeline.py          # Timeline schemas
│   │   ├── analysis.py          # Entity graph & incident synthesis schemas
│   │   └── dossier.py           # Case dossier & Section 65B certificate schemas
│   ├── services/                # Core forensic intelligence engine
│   │   ├── storage.py           # Streaming SHA-256 computation & file vault
│   │   ├── ocr.py               # Image OCR & PDF text extraction
│   │   ├── extractor.py         # Regular expression & NLP entity extractor
│   │   ├── correlation.py       # Cross-evidence linkage & graph builder
│   │   ├── timeline_service.py  # Automated chronological timeline generator
│   │   ├── synthesis_service.py # Modus operandi & legal section analyzer
│   │   ├── custody.py           # Immutable custody trail logger
│   │   └── certificate.py       # Statutory Certificate & printable HTML dossier
│   └── routers/                 # REST API endpoints
│       ├── cases.py             # Incident registration and triage
│       ├── evidence.py          # Evidence upload, download, and hash verify
│       ├── analysis.py          # Synthesis, correlation, and entity graph
│       ├── timeline.py          # Timeline retrieval and manual entry
│       ├── custody.py           # Chain-of-custody and batch integrity audit
│       └── dossier.py           # Dossier and 65B certificate generation
├── seed_demo_case.py            # Pre-loaded realistic cybercrime incident
├── run.py                       # Server runner
├── requirements.txt             # Python dependencies
└── .env.example                 # Example environment variables
```

---

## ⚡ Quickstart & Setup

### 1. Requirements
- Python 3.10+
- (Optional) `tesseract-ocr` for image screenshot OCR

### 2. Create Virtual Environment & Install Dependencies
```bash
cd backend
python -m venv venv

# On Windows:
venv\Scripts\activate

# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Seed Demo Cybercrime Case (Optional)
To immediately populate a realistic **CBI Digital Arrest & Coerced Wire Transfer** case with multi-modal evidence, UPI handles, UTR numbers, and timeline:
```bash
python seed_demo_case.py
```

### 4. Start the FastAPI Server
```bash
python run.py
```
Or directly with Uvicorn:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

* API Base: `http://127.0.0.1:8000/api/v1`
* Interactive Swagger Docs: `http://127.0.0.1:8000/docs`
* ReDoc Documentation: `http://127.0.0.1:8000/redoc`

---

## 📡 REST API Reference

### 1. Cases / Incidents (`/api/v1/cases`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/cases` | Register a new incident / evidence case |
| `GET` | `/api/v1/cases` | List all cases with filters (`category`, `severity`, `status`, `search`) |
| `GET` | `/api/v1/cases/statistics` | Dashboard statistics (total loss, cases, evidence count) |
| `GET` | `/api/v1/cases/{case_id}` | Full case details with evidence inventory and findings |
| `PATCH`| `/api/v1/cases/{case_id}` | Update status (`submitted`, `under_review`, `closed`) or loss amount |
| `DELETE`| `/api/v1/cases/{case_id}`| Delete case and associated evidence |

### 2. Evidence Management (`/api/v1/cases/{case_id}/evidence`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/cases/{case_id}/evidence` | Upload evidence file (multipart), computes SHA-256 hash, runs OCR & entity extraction |
| `GET` | `/api/v1/cases/{case_id}/evidence` | List all uploaded evidence for the case |
| `GET` | `/api/v1/cases/{case_id}/evidence/{evidence_id}` | Inspect single evidence item with extracted text & findings |
| `GET` | `/api/v1/cases/{case_id}/evidence/{evidence_id}/download` | Download raw evidence file securely |
| `POST` | `/api/v1/cases/{case_id}/evidence/{evidence_id}/verify-hash` | Verify on-disk file against initial SHA-256 hash (tamper check) |
| `POST` | `/api/v1/cases/{case_id}/evidence/{evidence_id}/ocr` | Trigger or re-run Tesseract OCR on image evidence |
| `POST` | `/api/v1/cases/{case_id}/evidence/{evidence_id}/transcribe` | Trigger or re-run Whisper Speech-to-Text on audio evidence |

### 3. "Putting It All Together" - Intelligence & Synthesis (`/api/v1/cases/{case_id}/analysis`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/cases/{case_id}/analysis/run` | Execute end-to-end AI synthesis: auto-timeline, narrative & loss calculation |
| `GET` | `/api/v1/cases/{case_id}/analysis/correlation` | Get correlated entities appearing across multiple files (cross-file linkage) |
| `GET` | `/api/v1/cases/{case_id}/analysis/graph` | Interactive Entity Graph (Nodes & Edges for visual network diagrams) |
| `GET` | `/api/v1/cases/{case_id}/analysis/synthesis` | Executive incident modus operandi, financial flow & recommended police sections |
| `POST` | `/api/v1/cases/{case_id}/analysis/findings/{finding_id}/verify` | Verify or reject an extracted finding (human-in-the-loop) |

### 4. Chronological Timeline (`/api/v1/cases/{case_id}/timeline`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/cases/{case_id}/timeline` | Retrieve chronological timeline milestones |
| `POST` | `/api/v1/cases/{case_id}/timeline` | Manually record an event milestone |
| `POST` | `/api/v1/cases/{case_id}/timeline/auto-generate` | Reconstruct timeline from evidence metadata & OCR timestamps |

### 5. Chain of Custody & Auditing (`/api/v1/cases/{case_id}/custody`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/cases/{case_id}/custody` | Get immutable chronological custody log |
| `POST` | `/api/v1/cases/{case_id}/custody/verify-all` | Run batch cryptographic audit on EVERY file in the case |

### 6. Dossier & Section 65B Legal Certificate (`/api/v1/cases/{case_id}/dossier`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/cases/{case_id}/dossier` | Complete case dossier in structured JSON format |
| `GET` | `/api/v1/cases/{case_id}/dossier/html` | Printable, court-ready HTML dossier with Section 65B Certificate |
| `GET` | `/api/v1/cases/{case_id}/dossier/certificate-65b` | Statutory electronic evidence certificate data |

---

## 🔗 Connecting to the React Native Mobile App

The existing mobile client in `src/` can point to this backend:

```typescript
// In your mobile API client:
const API_BASE_URL = 'http://<YOUR_LOCAL_IP>:8000/api/v1';

// Example: Uploading evidence from mobile picker
export const uploadEvidenceToBackend = async (caseId: string, fileUri: string, fileName: string, mimeType: string) => {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as any);

  const res = await fetch(`${API_BASE_URL}/cases/${caseId}/evidence`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return await res.json();
};
```
