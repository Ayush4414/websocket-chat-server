"""
Data models for WebSocket Chat Server with security validation
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import uuid
import re
from .constants import MESSAGE_SANITIZATION_PATTERN

@dataclass
class ClientConnection:
    """Secure client connection model"""
    username: str
    topic: str
    connected_at: datetime = field(default_factory=datetime.utcnow)
    websocket: Any = None  # WebSocket connection object
    ip_address: str = "unknown"
    message_count: int = 0
    last_message_time: datetime = field(default_factory=datetime.utcnow)
    
    def __post_init__(self):
        """Validate and sanitize data after initialization"""
        self.username = self._sanitize_string(self.username)
        self.topic = self._sanitize_string(self.topic)
        
    def _sanitize_string(self, input_str: str) -> str:
        """Remove potentially dangerous characters"""
        if not input_str:
            return ""
        # Remove control characters except newlines and tabs
        sanitized = re.sub(MESSAGE_SANITIZATION_PATTERN, '', input_str)
        return sanitized.strip()
    
    def can_send_message(self, rate_limit_per_minute: int = 60) -> bool:
        """Check if user can send message based on rate limiting"""
        now = datetime.utcnow()
        time_diff = now - self.last_message_time
        if time_diff.total_seconds() < 60 and self.message_count >= rate_limit_per_minute:
            return False
        return True
    
    def update_message_stats(self):
        """Update message statistics for rate limiting"""
        now = datetime.utcnow()
        if (now - self.last_message_time).total_seconds() >= 60:
            self.message_count = 1
        else:
            self.message_count += 1
        self.last_message_time = now

@dataclass
class ChatMessage:
    """Secure chat message model with expiration"""
    username: str
    message: str
    timestamp: int = field(default_factory=lambda: int(datetime.utcnow().timestamp()))
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    expires_at: datetime = field(default_factory=lambda: datetime.utcnow() + timedelta(seconds=30))
    topic: str = ""
    
    def __post_init__(self):
        """Validate and sanitize message content"""
        self.username = self._sanitize_string(self.username)
        self.message = self._sanitize_string(self.message)
        self.topic = self._sanitize_string(self.topic)
        
    def _sanitize_string(self, input_str: str) -> str:
        """Remove potentially dangerous characters"""
        if not input_str:
            return ""
        # Remove control characters except newlines and tabs
        sanitized = re.sub(MESSAGE_SANITIZATION_PATTERN, '', input_str)
        return sanitized.strip()
    
    def is_expired(self) -> bool:
        """Check if message has expired"""
        return datetime.utcnow() > self.expires_at
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "username": self.username,
            "message": self.message,
            "timestamp": self.timestamp,
            "message_id": self.message_id,
            "topic": self.topic,
            "expires_at": self.expires_at.isoformat()
        }

@dataclass
class TopicInfo:
    """Topic information model"""
    topic: str
    user_count: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    message_count: int = 0
    last_activity: datetime = field(default_factory=datetime.utcnow)
    
    def __post_init__(self):
        """Validate topic name"""
        self.topic = self._sanitize_string(self.topic)
        
    def _sanitize_string(self, input_str: str) -> str:
        """Remove potentially dangerous characters"""
        if not input_str:
            return ""
        # Remove control characters except newlines and tabs
        sanitized = re.sub(MESSAGE_SANITIZATION_PATTERN, '', input_str)
        return sanitized.strip()
    
    def update_activity(self):
        """Update last activity timestamp"""
        self.last_activity = datetime.utcnow()
    
    def add_message(self):
        """Increment message count and update activity"""
        self.message_count += 1
        self.update_activity()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "topic": self.topic,
            "user_count": self.user_count,
            "created_at": self.created_at.isoformat(),
            "message_count": self.message_count,
            "last_activity": self.last_activity.isoformat()
        }
