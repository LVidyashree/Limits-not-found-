from app.routers.cases import router as cases_router
from app.routers.evidence import router as evidence_router
from app.routers.analysis import router as analysis_router
from app.routers.timeline import router as timeline_router
from app.routers.custody import router as custody_router
from app.routers.dossier import router as dossier_router
from app.routers.qwen import router as qwen_router

__all__ = [
    "cases_router",
    "evidence_router",
    "analysis_router",
    "timeline_router",
    "custody_router",
    "dossier_router",
    "qwen_router",
]
