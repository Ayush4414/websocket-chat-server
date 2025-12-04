"""
Security-focused input validation for WebSocket Chat Server
"""

import re
from typing import Tuple, Dict, Any
from .constants import (
    USERNAME_PATTERN, 
    TOPIC_PATTERN, 
    MAX_MESSAGE_LENGTH,
    MAX_USERNAME_LENGTH,
    MAX_TOPIC_LENGTH,
    MIN_USERNAME_LENGTH,
    MIN_TOPIC_LENGTH,
    ERROR_MESSAGES
)
from .logger import get_logger, log_security_event

logger = get_logger()

def validate_connection(username: str, topic: str) -> Tuple[bool, str]:
    """
    Validate connection parameters with security checks
    
    Args:
        username: User identifier
        topic: Chat topic name
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    # Username validation
    if not isinstance(username, str):
        log_security_event("invalid_username_type", {"username": str(username)})
        return False, ERROR_MESSAGES["invalid_username"]
    
    if len(username) < MIN_USERNAME_LENGTH or len(username) > MAX_USERNAME_LENGTH:
        log_security_event("invalid_username_length", {"username": username, "length": len(username)})
        return False, ERROR_MESSAGES["invalid_username"]
    
    if not re.match(USERNAME_PATTERN, username):
        log_security_event("invalid_username_format", {"username": username})
        return False, ERROR_MESSAGES["invalid_username"]
    
    # Topic validation
    if not isinstance(topic, str):
        log_security_event("invalid_topic_type", {"topic": str(topic)})
        return False, ERROR_MESSAGES["invalid_topic"]
    
    if len(topic) < MIN_TOPIC_LENGTH or len(topic) > MAX_TOPIC_LENGTH:
        log_security_event("invalid_topic_length", {"topic": topic, "length": len(topic)})
        return False, ERROR_MESSAGES["invalid_topic"]
    
    if not re.match(TOPIC_PATTERN, topic):
        log_security_event("invalid_topic_format", {"topic": topic})
        return False, ERROR_MESSAGES["invalid_topic"]
    
    # Additional security checks
    if username.lower() in ['admin', 'root', 'system', 'null', 'undefined']:
        log_security_event("reserved_username", {"username": username})
        return False, ERROR_MESSAGES["invalid_username"]
    
    if topic.lower() in ['admin', 'system', 'root', 'null', 'undefined']:
        log_security_event("reserved_topic", {"topic": topic})
        return False, ERROR_MESSAGES["invalid_topic"]
    
    logger.info(f"Connection validated: username={username}, topic={topic}")
    return True, ""

def validate_message(message: str, username: str = "", topic: str = "") -> Tuple[bool, str]:
    """
    Validate message content with security checks
    
    Args:
        message: Message content
        username: Sender username (for logging)
        topic: Topic name (for logging)
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    # Message type validation
    if not isinstance(message, str):
        log_security_event("invalid_message_type", {"username": username, "topic": topic})
        return False, ERROR_MESSAGES["invalid_message"]
    
    # Message length validation
    if len(message) == 0 or len(message) > MAX_MESSAGE_LENGTH:
        log_security_event("invalid_message_length", {
            "username": username, 
            "topic": topic, 
            "length": len(message)
        })
        return False, ERROR_MESSAGES["invalid_message"]
    
    # Check for potential injection attacks
    dangerous_patterns = [
        r'<script[^>]*>.*?</script>',  # Script tags
        r'javascript:',               # JavaScript protocol
        r'on\w+\s*=',                # Event handlers
        r'expression\s*\(',          # CSS expressions
        r'@import',                  # CSS imports
    ]
    
    for pattern in dangerous_patterns:
        if re.search(pattern, message, re.IGNORECASE):
            log_security_event("potential_injection", {
                "username": username,
                "topic": topic,
                "pattern": pattern
            })
            return False, ERROR_MESSAGES["invalid_message"]
    
    logger.info(f"Message validated: username={username}, topic={topic}, length={len(message)}")
    return True, ""

def sanitize_username(username: str) -> str:
    """
    Sanitize username for safe usage
    
    Args:
        username: Raw username input
        
    Returns:
        Sanitized username
    """
    if not isinstance(username, str):
        return ""
    
    # Remove whitespace and convert to lowercase
    sanitized = username.strip().lower()
    
    # Remove any characters not matching the pattern
    sanitized = re.sub(r'[^a-z0-9_]', '', sanitized)
    
    # Ensure it meets length requirements
    if len(sanitized) > MAX_USERNAME_LENGTH:
        sanitized = sanitized[:MAX_USERNAME_LENGTH]
    
    return sanitized

def sanitize_topic(topic: str) -> str:
    """
    Sanitize topic name for safe usage
    
    Args:
        topic: Raw topic input
        
    Returns:
        Sanitized topic name
    """
    if not isinstance(topic, str):
        return ""
    
    # Remove whitespace and convert to lowercase
    sanitized = topic.strip().lower()
    
    # Remove any characters not matching the pattern
    sanitized = re.sub(r'[^a-z0-9_]', '', sanitized)
    
    # Ensure it meets length requirements
    if len(sanitized) > MAX_TOPIC_LENGTH:
        sanitized = sanitized[:MAX_TOPIC_LENGTH]
    
    return sanitized

def validate_json_payload(payload: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Validate JSON payload structure
    
    Args:
        payload: Dictionary payload from WebSocket
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not isinstance(payload, dict):
        log_security_event("invalid_payload_type", {"payload_type": type(payload)})
        return False, ERROR_MESSAGES["invalid_json"]
    
    # Check for required fields based on message type
    if 'type' not in payload:
        log_security_event("missing_message_type", {"payload": payload})
        return False, ERROR_MESSAGES["invalid_json"]
    
    message_type = payload.get('type')
    
    if message_type == 'join':
        required_fields = ['username', 'topic']
    elif message_type == 'message':
        required_fields = ['message']
    elif message_type == 'list':
        required_fields = []
    else:
        log_security_event("unknown_message_type", {"message_type": message_type})
        return False, ERROR_MESSAGES["invalid_json"]
    
    for field in required_fields:
        if field not in payload:
            log_security_event("missing_required_field", {
                "message_type": message_type,
                "missing_field": field
            })
            return False, ERROR_MESSAGES["invalid_json"]
    
    return True, ""

def check_rate_limit(client_data: Dict[str, Any], max_per_minute: int = 60) -> Tuple[bool, str]:
    """
    Check if client exceeds rate limit
    
    Args:
        client_data: Client connection data
        max_per_minute: Maximum messages per minute
        
    Returns:
        Tuple of (is_allowed, error_message)
    """
    message_count = client_data.get('message_count', 0)
    last_message_time = client_data.get('last_message_time')
    
    if last_message_time is None:
        return True, ""
    
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    
    # Reset counter if more than a minute has passed
    if (now - last_message_time).total_seconds() >= 60:
        return True, ""
    
    if message_count >= max_per_minute:
        log_security_event("rate_limit_exceeded", {
            "message_count": message_count,
            "max_per_minute": max_per_minute
        })
        return False, ERROR_MESSAGES["rate_limit"]
    
    return True, ""
