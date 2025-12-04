"""
Secure logging configuration for WebSocket Chat Server
"""

import logging
import json
import re
import time
import sys
from datetime import datetime
from typing import Any, Dict, Optional
from logging.handlers import RotatingFileHandler
from .constants import LOG_LEVEL

class SecureFormatter(logging.Formatter):
    """Custom formatter that sanitizes sensitive data"""
    
    def format(self, record):
        # Sanitize potential sensitive data in logs
        message = super().format(record)
        # Remove potential passwords, tokens, etc.
        sanitized = message.replace('password=', 'password=***')
        sanitized = sanitized.replace('token=', 'token=***')
        return sanitized

def get_logger(name: str = "websocket_chat") -> logging.Logger:
    """
    Get a secure logger instance with proper formatting
    
    Args:
        name: Logger name
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    if not logger.handlers:
        # Create console handler
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(logging.INFO)
        
        # Create secure formatter
        formatter = SecureFormatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        
        # Add handler to logger
        logger.addHandler(handler)
        logger.setLevel(LOG_LEVEL)
        
        # Prevent propagation to root logger
        logger.propagate = False
    
    return logger

def log_security_event(event_type: str, details: dict, logger: Optional[logging.Logger] = None):
    """
    Log security-related events with structured data
    
    Args:
        event_type: Type of security event
        details: Event details
        logger: Logger instance (optional)
    """
    if logger is None:
        logger = get_logger()
    
    timestamp = datetime.utcnow().isoformat()
    log_message = f"SECURITY_EVENT: {event_type} | {details}"
    logger.warning(log_message)

def log_connection_event(username: str, topic: str, action: str, ip_address: str = "unknown"):
    """
    Log connection-related events for monitoring
    
    Args:
        username: User identifier
        topic: Chat topic
        action: Action (connect/disconnect/error)
        ip_address: Client IP address
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    log_message = f"CONNECTION_EVENT: {action} | user={username} | topic={topic} | ip={ip_address}"
    logger.info(log_message)

def log_message_event(message_id: str, username: str, topic: str, action: str, details: str = ""):
    """
    Log message-related events for debugging
    
    Args:
        message_id: Unique message identifier
        username: Sender username
        topic: Chat topic
        action: Action (send/broadcast/expire/error)
        details: Additional details
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    log_message = f"MESSAGE_EVENT: {action} | id={message_id[:8]}... | user={username} | topic={topic} | {details}"
    logger.info(log_message)

def log_demo_event(event_type: str, details: str, room_id: str = ""):
    """
    Log demo-related events for debugging
    
    Args:
        event_type: Type of demo event
        details: Event details
        room_id: Room identifier (optional)
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    room_info = f" | room={room_id}" if room_id else ""
    log_message = f"DEMO_EVENT: {event_type} | {details}{room_info}"
    logger.info(log_message)

def log_websocket_event(event_type: str, connection_id: str, details: str = ""):
    """
    Log WebSocket protocol events
    
    Args:
        event_type: Type of WebSocket event
        connection_id: Connection identifier
        details: Additional details
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    log_message = f"WEBSOCKET_EVENT: {event_type} | conn={connection_id} | {details}"
    logger.debug(log_message)

def log_system_event(event_type: str, details: str, level: str = "info"):
    """
    Log system-level events
    
    Args:
        event_type: Type of system event
        details: Event details
        level: Log level (info/warning/error)
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    log_message = f"SYSTEM_EVENT: {event_type} | {details}"
    
    if level == "warning":
        logger.warning(log_message)
    elif level == "error":
        logger.error(log_message)
    else:
        logger.info(log_message)

def log_performance_event(operation: str, duration_ms: float, details: str = ""):
    """
    Log performance-related events
    
    Args:
        operation: Operation being performed
        duration_ms: Duration in milliseconds
        details: Additional details
    """
    logger = get_logger()
    timestamp = datetime.utcnow().isoformat()
    log_message = f"PERFORMANCE_EVENT: {operation} | duration={duration_ms:.2f}ms | {details}"
    logger.info(log_message)
