import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Float, Integer, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Case(Base):
    __tablename__ = "cases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False) # Financial Fraud, Impersonation, Cyberstalking, etc.
    description = Column(Text, nullable=True)
    incident_date = Column(String(50), nullable=True)
    incident_time = Column(String(50), nullable=True)
    platform = Column(String(100), nullable=True) # WhatsApp, Telegram, NetBanking, etc.
    suspect_info = Column(Text, nullable=True)
    severity = Column(String(20), default="medium") # low, medium, high, critical
    status = Column(String(30), default="active") # active, submitted, under_review, closed
    is_demo = Column(Integer, default=0)
    
    financial_loss_amount = Column(Float, default=0.0)
    synthesized_summary = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    evidence_items = relationship("Evidence", back_populates="case", cascade="all, delete-orphan")
    findings = relationship("Finding", back_populates="case", cascade="all, delete-orphan")
    timeline_events = relationship("TimelineEvent", back_populates="case", cascade="all, delete-orphan")
    custody_logs = relationship("ChainOfCustodyLog", back_populates="case", cascade="all, delete-orphan")
