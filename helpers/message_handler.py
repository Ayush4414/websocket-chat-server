"""
Secure message handling with automatic expiration and rate limiting
"""

import asyncio
import json
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from .models import ChatMessage, ClientConnection
from .validators import validate_message, validate_json_payload, check_rate_limit
from .constants import MESSAGE_EXPIRATION_SECONDS, RATE_LIMIT_MESSAGES_PER_MINUTE
from .logger import get_logger, log_security_event

logger = get_logger()

class MessageHandler:
    """Handles message broadcasting and expiration with security features"""
    
    def __init__(self):
        # message_id -> ChatMessage
        self._messages: Dict[str, ChatMessage] = {}
        # Lock for thread safety
        self._lock = asyncio.Lock()
        
    async def create_message(self, username: str, message: str, topic: str) -> Tuple[bool, str, Optional[ChatMessage]]:
        """
        Create and validate a new message
        
        Args:
            username: Sender username
            message: Message content
            topic: Topic name
            
        Returns:
            Tuple of (success, error_message, message_object)
        """
        # Validate message content
        is_valid, error_msg = validate_message(message, username, topic)
        if not is_valid:
            return False, error_msg, None
        
        # Create message object
        chat_message = ChatMessage(
            username=username,
            message=message,
            topic=topic
        )
        
        # Store message
        async with self._lock:
            self._messages[chat_message.message_id] = chat_message
        
        # Schedule message expiration
        asyncio.create_task(self._expire_message(chat_message.message_id))
        
        logger.info(f"Message created: {chat_message.message_id} by {username} in {topic}")
        return True, "", chat_message
    
    async def broadcast_message(self, message: ChatMessage, clients: List[ClientConnection], sender_websocket: Any) -> int:
        """
        Broadcast message to all clients in topic (including sender for immediate feedback)
        
        Args:
            message: Message to broadcast
            clients: List of clients in the topic
            sender_websocket: Sender's WebSocket (to include for immediate feedback)
            
        Returns:
            Number of successful recipients
        """
        successful_sends = 0
        message_data = message.to_dict()
        
        for client in clients:
            try:
                # Send message to all clients (including sender for immediate feedback)
                await client.websocket.send_text(json.dumps({
                    "type": "message",
                    **message_data
                }))
                successful_sends += 1
                
            except Exception as e:
                # Log send failure but continue with other clients
                logger.error(f"Failed to send message to {client.username}: {e}")
                log_security_event("message_send_failed", {
                    "recipient": client.username,
                    "message_id": message.message_id,
                    "error": str(e)
                })
        
        logger.info(f"Message broadcast: {message.message_id} to {successful_sends} recipients")
        return successful_sends
    
    async def send_list_response(self, topics_info: List[Any], websocket: Any):
        """
        Send list of active topics to client
        
        Args:
            topics_info: List of TopicInfo objects
            websocket: Client WebSocket connection
        """
        try:
            topics_data = [topic.to_dict() for topic in topics_info]
            response = {
                "type": "list",
                "topics": topics_data,
                "timestamp": int(datetime.utcnow().timestamp())
            }
            
            await websocket.send_text(json.dumps(response))
            logger.info(f"List response sent: {len(topics_data)} topics")
            
        except Exception as e:
            logger.error(f"Failed to send list response: {e}")
    
    async def send_error_message(self, error_message: str, websocket: Any):
        """
        Send error message to client
        
        Args:
            error_message: Error description
            websocket: Client WebSocket connection
        """
        try:
            response = {
                "type": "error",
                "message": error_message,
                "timestamp": int(datetime.utcnow().timestamp())
            }
            
            await websocket.send_text(json.dumps(response))
            logger.info(f"Error message sent: {error_message}")
            
        except Exception as e:
            logger.error(f"Failed to send error message: {e}")
    
    async def send_ack_message(self, message_id: str, recipients: int, websocket: Any):
        """
        Send acknowledgment message to sender
        
        Args:
            message_id: Message ID being acknowledged
            recipients: Number of recipients
            websocket: Sender's WebSocket connection
        """
        try:
            response = {
                "type": "ack",
                "message_id": message_id,
                "recipients": recipients,
                "timestamp": int(datetime.utcnow().timestamp())
            }
            
            await websocket.send_text(json.dumps(response))
            logger.info(f"ACK sent: {message_id} to {recipients} recipients")
            
        except Exception as e:
            logger.error(f"Failed to send ACK: {e}")
    
    async def send_join_confirmation(self, username: str, topic: str, websocket: Any):
        """
        Send confirmation that user successfully joined topic
        
        Args:
            username: Assigned username (may have #N suffix)
            topic: Topic name
            websocket: Client WebSocket connection
        """
        try:
            response = {
                "type": "joined",
                "username": username,
                "topic": topic,
                "timestamp": int(datetime.utcnow().timestamp())
            }
            
            await websocket.send_text(json.dumps(response))
            logger.info(f"Join confirmation sent: {username} to {topic}")
            
        except Exception as e:
            logger.error(f"Failed to send join confirmation: {e}")
    
    async def handle_client_message(self, payload: Dict[str, Any], client: ClientConnection) -> Tuple[bool, str, Optional[ChatMessage]]:
        """
        Handle incoming message from client with security validation
        
        Args:
            payload: JSON payload from client
            client: Client connection object
            
        Returns:
            Tuple of (success, error_message, message_object)
        """
        # Validate JSON payload structure
        is_valid, error_msg = validate_json_payload(payload)
        if not is_valid:
            return False, error_msg, None
        
        message_type = payload.get('type')
        
        if message_type == 'message':
            message_content = payload.get('message', '')
            
            # Check rate limiting
            client_data = {
                'message_count': client.message_count,
                'last_message_time': client.last_message_time
            }
            
            can_send, rate_error = check_rate_limit(client_data, RATE_LIMIT_MESSAGES_PER_MINUTE)
            if not can_send:
                return False, rate_error, None
            
            # Create message
            return await self.create_message(client.username, message_content, client.topic)
        
        else:
            return False, f"Unknown message type: {message_type}", None
    
    async def _expire_message(self, message_id: str):
        """
        Background task to expire message after specified time
        
        Args:
            message_id: Message ID to expire
        """
        try:
            # Wait for expiration time
            await asyncio.sleep(MESSAGE_EXPIRATION_SECONDS)
            
            # Remove message
            async with self._lock:
                if message_id in self._messages:
                    message = self._messages[message_id]
                    del self._messages[message_id]
                    logger.info(f"Message expired: {message_id}")
                
        except Exception as e:
            logger.error(f"Error expiring message {message_id}: {e}")
    
    async def cleanup_expired_messages(self):
        """
        Clean up any expired messages (maintenance task)
        """
        async with self._lock:
            expired_messages = []
            
            for message_id, message in self._messages.items():
                if message.is_expired():
                    expired_messages.append(message_id)
            
            for message_id in expired_messages:
                del self._messages[message_id]
            
            if expired_messages:
                logger.info(f"Cleaned up {len(expired_messages)} expired messages")
    
    async def get_message_stats(self) -> Dict[str, int]:
        """
        Get message handling statistics
        
        Returns:
            Dictionary with message stats
        """
        async with self._lock:
            total_messages = len(self._messages)
            
            return {
                "total_messages": total_messages,
                "expiration_seconds": MESSAGE_EXPIRATION_SECONDS,
                "rate_limit_per_minute": RATE_LIMIT_MESSAGES_PER_MINUTE
            }
    
    async def is_message_valid(self, message_id: str) -> bool:
        """
        Check if message exists and is not expired
        
        Args:
            message_id: Message ID to check
            
        Returns:
            True if message is valid
        """
        async with self._lock:
            if message_id not in self._messages:
                return False
            
            return not self._messages[message_id].is_expired()
