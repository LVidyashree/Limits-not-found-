import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Finding(Base):
    __tablename__ = "findings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String(36), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    evidence_id = Column(String(36), ForeignKey("evidence.id", ondelete="CASCADE"), nullable=False, index=True)
    
    finding_type = Column(String(50), nullable=False) # phone, email, url, financial, account, keyword, crypto, date, other
    finding_value = Column(String(255), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    context_snippet = Column(Text, nullable=True)
    confidence = Column(Float, default=0.90)
    verification_status = Column(String(30), default="needs_verification") # needs_verification, verified, rejected
    verified_at = Column(DateTime, nullable=True)
    user_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    case = relationship("Case", back_populates="findings")
    evidence = relationship("Evidence", back_populates="findings")
