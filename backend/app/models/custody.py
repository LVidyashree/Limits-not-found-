import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class ChainOfCustodyLog(Base):
    __tablename__ = "chain_of_custody_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String(36), ForeignKey("cases.id", ondelete="CASCADE"), nullable=True, index=True)
    evidence_id = Column(String(36), ForeignKey("evidence.id", ondelete="CASCADE"), nullable=True, index=True)
    
    action_type = Column(String(50), nullable=False) # UPLOAD, HASH_VERIFIED, OCR_EXTRACTED, ENTITY_EXTRACTED, VERIFIED_BY_VICTIM, REVIEWED_BY_OFFICER, DOSSIER_EXPORTED
    actor = Column(String(100), default="System")
    description = Column(Text, nullable=False)
    details_json = Column(Text, nullable=True)
    sha256_recorded = Column(String(64), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    # Relationships
    case = relationship("Case", back_populates="custody_logs")
    evidence = relationship("Evidence", back_populates="custody_logs")
