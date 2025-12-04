"""
WebSocket Chat Server Helpers Module
Security-focused implementation with input validation and error handling
"""

from .models import ClientConnection, ChatMessage, TopicInfo
from .validators import validate_connection, validate_message, sanitize_username, sanitize_topic
from .room_manager import RoomManager
from .message_handler import MessageHandler
from .constants import *
from .logger import (
    get_logger, 
    log_security_event,
    log_connection_event,
    log_message_event,
    log_demo_event,
    log_websocket_event,
    log_system_event,
    log_performance_event
)

__all__ = [
    'ClientConnection',
    'ChatMessage', 
    'TopicInfo',
    'validate_connection',
    'validate_message',
    'sanitize_username',
    'sanitize_topic',
    'RoomManager',
    'MessageHandler',
    'get_logger',
    'log_security_event',
    'log_connection_event',
    'log_message_event',
    'log_demo_event',
    'log_websocket_event',
    'log_system_event',
    'log_performance_event'
]
