"""Standalone chats. No candidate or job is required, and old messages stay intact."""
from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, new_id
from .models import TimestampMixin


class Conversation(TimestampMixin, Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("chat"))
    title: Mapped[str] = mapped_column(String(160), default="新对话")
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    active_turn_id: Mapped[str | None] = mapped_column(String(48), nullable=True)


class ConversationMessage(TimestampMixin, Base):
    __tablename__ = "conversation_messages"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("chatmsg"))
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
