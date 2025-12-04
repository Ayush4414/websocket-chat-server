"""
Thread-safe room management with security features
"""

import asyncio
from typing import Dict, List, Set, Optional, Tuple
from datetime import datetime
from .models import ClientConnection, TopicInfo
from .validators import validate_connection, sanitize_username, sanitize_topic
from .constants import MAX_CONNECTIONS_PER_TOPIC, MAX_TOPICS_TOTAL
from .logger import get_logger, log_security_event, log_connection_event

logger = get_logger()

class RoomManager:
    """Thread-safe room and connection management"""
    
    def __init__(self):
        # Topic -> {username: ClientConnection}
        self._rooms: Dict[str, Dict[str, ClientConnection]] = {}
        # Topic -> TopicInfo
        self._topic_info: Dict[str, TopicInfo] = {}
        # Lock for thread safety
        self._lock = asyncio.Lock()
        
    async def add_client(self, username: str, topic: str, websocket, ip_address: str = "unknown") -> Tuple[bool, str, str]:
        """
        Add a client to a topic room with security checks
        
        Args:
            username: User identifier
            topic: Chat topic name
            websocket: WebSocket connection object
            ip_address: Client IP address
            
        Returns:
            Tuple of (success, final_username, error_message)
        """
        async with self._lock:
            # Validate inputs
            is_valid, error_msg = validate_connection(username, topic)
            if not is_valid:
                return False, "", error_msg
            
            # Sanitize inputs
            clean_username = sanitize_username(username)
            clean_topic = sanitize_topic(topic)
            
            # Check topic limits
            if len(self._rooms) >= MAX_TOPICS_TOTAL and clean_topic not in self._rooms:
                log_security_event("topic_limit_exceeded", {
                    "current_topics": len(self._rooms),
                    "max_topics": MAX_TOPICS_TOTAL
                })
                return False, "", "Server at maximum topic capacity"
            
            # Check per-topic connection limits
            if clean_topic in self._rooms:
                topic_connections = len(self._rooms[clean_topic])
                if topic_connections >= MAX_CONNECTIONS_PER_TOPIC:
                    log_security_event("topic_full", {
                        "topic": clean_topic,
                        "connections": topic_connections,
                        "max_connections": MAX_CONNECTIONS_PER_TOPIC
                    })
                    return False, "", "Topic is full, please try another"
            
            # Ensure unique username within topic
            final_username = await self._get_unique_username(clean_username, clean_topic)
            
            # Create client connection
            client = ClientConnection(
                username=final_username,
                topic=clean_topic,
                websocket=websocket,
                ip_address=ip_address
            )
            
            # Add to room
            if clean_topic not in self._rooms:
                self._rooms[clean_topic] = {}
                self._topic_info[clean_topic] = TopicInfo(topic=clean_topic)
            
            self._rooms[clean_topic][final_username] = client
            self._topic_info[clean_topic].user_count = len(self._rooms[clean_topic])
            self._topic_info[clean_topic].update_activity()
            
            # Log successful connection
            log_connection_event(final_username, clean_topic, "connect", ip_address)
            logger.info(f"Client added: {final_username} to {clean_topic}")
            
            return True, final_username, ""
    
    async def _get_unique_username(self, username: str, topic: str) -> str:
        """
        Generate unique username within topic by adding #N suffix
        
        Args:
            username: Base username
            topic: Topic name
            
        Returns:
            Unique username
        """
        if topic not in self._rooms:
            return username
        
        existing_usernames = set(self._rooms[topic].keys())
        
        if username not in existing_usernames:
            return username
        
        # Try username#1, username#2, etc.
        counter = 1
        while True:
            candidate = f"{username}#{counter}"
            if candidate not in existing_usernames:
                return candidate
            counter += 1
    
    async def remove_client(self, username: str, topic: str) -> bool:
        """
        Remove a client from a topic room
        
        Args:
            username: User identifier
            topic: Chat topic name
            
        Returns:
            True if client was removed, False if not found
        """
        async with self._lock:
            if topic not in self._rooms:
                return False
            
            if username not in self._rooms[topic]:
                return False
            
            # Get client info for logging
            client = self._rooms[topic][username]
            ip_address = client.ip_address
            
            # Remove client
            del self._rooms[topic][username]
            
            # Update topic info
            if self._rooms[topic]:  # Room still has users
                self._topic_info[topic].user_count = len(self._rooms[topic])
                self._topic_info[topic].update_activity()
            else:  # Room is empty, delete it
                del self._rooms[topic]
                del self._topic_info[topic]
                logger.info(f"Topic deleted: {topic} (empty)")
            
            # Log disconnection
            log_connection_event(username, topic, "disconnect", ip_address)
            logger.info(f"Client removed: {username} from {topic}")
            
            return True
    
    async def get_client_connection(self, username: str, topic: str) -> Optional[ClientConnection]:
        """
        Get specific client connection by username and topic
        
        Args:
            username: User identifier
            topic: Topic name
            
        Returns:
            ClientConnection object or None if not found
        """
        async with self._lock:
            if topic not in self._rooms:
                return None
            
            return self._rooms[topic].get(username)
    
    async def get_clients_in_topic(self, topic: str) -> List[ClientConnection]:
        """
        Get all clients in a specific topic
        
        Args:
            topic: Topic name
            
        Returns:
            List of ClientConnection objects
        """
        async with self._lock:
            if topic not in self._rooms:
                return []
            
            return list(self._rooms[topic].values())
    
    async def get_all_topics_info(self) -> List[TopicInfo]:
        """
        Get information about all active topics
        
        Returns:
            List of TopicInfo objects
        """
        async with self._lock:
            return list(self._topic_info.values())
    
    async def get_client_websocket(self, username: str, topic: str) -> Optional[any]:
        """
        Get WebSocket connection for a specific client
        
        Args:
            username: User identifier
            topic: Topic name
            
        Returns:
            WebSocket object or None if not found
        """
        async with self._lock:
            if topic not in self._rooms:
                return None
            
            if username not in self._rooms[topic]:
                return None
            
            return self._rooms[topic][username].websocket
    
    async def update_client_stats(self, username: str, topic: str):
        """
        Update client message statistics for rate limiting
        
        Args:
            username: User identifier
            topic: Topic name
        """
        async with self._lock:
            if topic in self._rooms and username in self._rooms[topic]:
                self._rooms[topic][username].update_message_stats()
    
    async def get_connection_stats(self) -> Dict[str, int]:
        """
        Get overall connection statistics
        
        Returns:
            Dictionary with connection stats
        """
        async with self._lock:
            total_clients = sum(len(room) for room in self._rooms.values())
            total_topics = len(self._rooms)
            
            return {
                "total_clients": total_clients,
                "total_topics": total_topics,
                "max_topics": MAX_TOPICS_TOTAL,
                "max_connections_per_topic": MAX_CONNECTIONS_PER_TOPIC
            }
    
    async def cleanup_inactive_connections(self, timeout_seconds: int = 300):
        """
        Clean up inactive connections (security feature)
        
        Args:
            timeout_seconds: Connection timeout in seconds
        """
        async with self._lock:
            now = datetime.utcnow()
            inactive_clients = []
            
            for topic, clients in self._rooms.items():
                for username, client in clients.items():
                    # Check if connection is inactive
                    time_diff = (now - client.connected_at).total_seconds()
                    if time_diff > timeout_seconds:
                        inactive_clients.append((username, topic))
            
            # Remove inactive clients
            for username, topic in inactive_clients:
                await self.remove_client(username, topic)
                log_security_event("inactive_connection_removed", {
                    "username": username,
                    "topic": topic,
                    "inactive_seconds": timeout_seconds
                })
            
            if inactive_clients:
                logger.info(f"Cleaned up {len(inactive_clients)} inactive connections")
