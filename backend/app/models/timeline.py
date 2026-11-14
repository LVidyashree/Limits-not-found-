import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String(36), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    evidence_id = Column(String(36), ForeignKey("evidence.id", ondelete="SET NULL"), nullable=True)
    finding_id = Column(String(36), nullable=True)
    
    event_date = Column(String(50), nullable=False) # YYYY-MM-DD
    event_time = Column(String(50), nullable=True) # HH:MM:SS
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source = Column(String(30), default="extracted") # extracted, manual
    is_verified = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    case = relationship("Case", back_populates="timeline_events")
    evidence = relationship("Evidence", back_populates="timeline_events")
