from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.routers import (
    cases_router,
    evidence_router,
    analysis_router,
    timeline_router,
    custody_router,
    dossier_router,
    qwen_router,
)

# Auto-create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    ## Digital Evidence Intelligent Interface API
    
    A specialized forensic evidence vault and correlation engine designed for cybercrime victims and investigators.
    
    ### Core Capabilities:
    * **Multi-Modal Evidence Vault**: Secure ingestion of screenshots, bank statements, chat exports, audio recordings, and transaction slips.
    * **Cryptographic Tamper-Evidence**: Automatic streaming SHA-256 computation and bit-stream verification.
    * **Forensic Entity Extraction**: Identification of UPI IDs, UTR transaction numbers, phone numbers, crypto wallets, phishing URLs, and threat patterns.
    * **Intelligent Evidence Synthesis**: Automated correlation of suspect infrastructure across multiple disparate evidence pieces and chronological timeline reconstruction.
    * **Legal Admissibility & Section 65B Certificate**: Immutable audit trail generation and automated electronic evidence certification compliant with statutory standards.
    """,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS setup for mobile and web frontends
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to specific mobile schemes and dashboard domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(cases_router, prefix=settings.API_V1_STR)
app.include_router(evidence_router, prefix=settings.API_V1_STR)
app.include_router(analysis_router, prefix=settings.API_V1_STR)
app.include_router(timeline_router, prefix=settings.API_V1_STR)
app.include_router(custody_router, prefix=settings.API_V1_STR)
app.include_router(dossier_router, prefix=settings.API_V1_STR)
app.include_router(qwen_router, prefix=settings.API_V1_STR)

@app.get("/", tags=["Health & Status"])
def root_status():
    return {
        "status": "online",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs_url": "/docs",
        "api_v1_base": settings.API_V1_STR
    }

@app.get("/health", tags=["Health & Status"])
def healthcheck():
    return {"status": "healthy", "vault_storage": str(settings.UPLOAD_DIR)}
