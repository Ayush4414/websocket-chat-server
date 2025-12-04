"""
Security-focused constants for WebSocket Chat Server
"""

# Message and connection limits
MESSAGE_EXPIRATION_SECONDS = 30
MAX_MESSAGE_LENGTH = 5000
MAX_USERNAME_LENGTH = 20
MIN_USERNAME_LENGTH = 1
MAX_TOPIC_LENGTH = 50
MIN_TOPIC_LENGTH = 1

# Security settings
MAX_CONNECTIONS_PER_TOPIC = 100
MAX_TOPICS_TOTAL = 1000
RATE_LIMIT_MESSAGES_PER_MINUTE = 60
CONNECTION_TIMEOUT_SECONDS = 300

# Regex patterns for validation (security-focused)
USERNAME_PATTERN = r'^[a-zA-Z0-9_]{1,20}$'
TOPIC_PATTERN = r'^[a-zA-Z0-9_]{1,50}$'
MESSAGE_SANITIZATION_PATTERN = r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'

# WebSocket settings
HEARTBEAT_INTERVAL = 30
MAX_MESSAGE_SIZE_BYTES = 10240

# Logging levels
LOG_LEVEL = "INFO"

# Security headers
CORS_ORIGINS = ["*"]
CORS_ALLOW_CREDENTIALS = False

# Error messages
ERROR_MESSAGES = {
    "invalid_username": "Username must be 1-20 alphanumeric characters",
    "invalid_topic": "Topic must be 1-50 alphanumeric characters", 
    "invalid_message": "Message must be 1-5000 characters",
    "topic_full": "Topic is full, please try another",
    "rate_limit": "Rate limit exceeded, please slow down",
    "invalid_json": "Invalid JSON format",
    "connection_failed": "Connection failed, please try again"
}
