import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String(36), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_path = Column(Text, nullable=False)
    file_size = Column(Integer, default=0)
    file_type = Column(String(50), default="other") # image, pdf, document, audio, video, text, other
    mime_type = Column(String(100), default="application/octet-stream")
    sha256_hash = Column(String(64), nullable=False, index=True)
    processing_status = Column(String(30), default="pending") # pending, processing, completed, error
    extracted_text = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True) # EXIF, dimensions, audio duration, etc.
    is_verified = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    case = relationship("Case", back_populates="evidence_items")
    findings = relationship("Finding", back_populates="evidence", cascade="all, delete-orphan")
    timeline_events = relationship("TimelineEvent", back_populates="evidence")
    custody_logs = relationship("ChainOfCustodyLog", back_populates="evidence")
