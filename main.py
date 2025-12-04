"""
FastAPI WebSocket Chat Server with Security Features
Production-ready implementation with topic-based rooms and message expiration
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
import json
import asyncio
import time
from typing import Dict, Any
import uvicorn
import os

from helpers import (
    RoomManager, 
    MessageHandler, 
    get_logger, 
    log_security_event,
    log_connection_event,
    log_message_event,
    log_demo_event,
    log_websocket_event,
    log_system_event,
    log_performance_event,
    MAX_CONNECTIONS_PER_TOPIC,
    MAX_TOPICS_TOTAL
)

# Global instances
room_manager = RoomManager()
message_handler = MessageHandler()
logger = get_logger()

# Setup templates
templates = Jinja2Templates(directory="templates")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan management"""
    # Startup
    logger.info("WebSocket Chat Server starting up...")
    
    # Start background tasks
    cleanup_task = asyncio.create_task(background_cleanup())
    
    yield
    
    # Shutdown
    cleanup_task.cancel()
    logger.info("WebSocket Chat Server shutting down...")

# Create FastAPI app
app = FastAPI(
    title="Secure WebSocket Chat Server",
    description="Real-time chat with topic-based rooms and security features",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware with security settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

async def background_cleanup():
    """Background task for cleanup operations"""
    while True:
        try:
            # Clean up inactive connections every 5 minutes
            await room_manager.cleanup_inactive_connections(timeout_seconds=300)
            
            # Clean up expired messages every minute
            await message_handler.cleanup_expired_messages()
            
            # Sleep for 60 seconds
            await asyncio.sleep(60)
            
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Background cleanup error: {e}")

@app.get("/")
async def root():
    """Serve the main chat interface"""
    try:
        with open("templates/chat-new.html", "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Chat interface not found</h1>", status_code=404)

@app.get("/old")
async def old_chat():
    """Serve the legacy chat interface"""
    try:
        with open("templates/index.html", "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Legacy chat interface not found</h1>", status_code=404)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Get stats to verify systems are working
        connection_stats = await room_manager.get_connection_stats()
        message_stats = await message_handler.get_message_stats()
        
        return {
            "status": "healthy",
            "timestamp": asyncio.get_event_loop().time(),
            "connections": connection_stats,
            "messages": message_stats
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Service unavailable")

@app.get("/stats")
async def get_stats():
    """Get server statistics"""
    try:
        connection_stats = await room_manager.get_connection_stats()
        message_stats = await message_handler.get_message_stats()
        
        return {
            "server": "Secure WebSocket Chat Server",
            "timestamp": asyncio.get_event_loop().time(),
            "connections": connection_stats,
            "messages": message_stats
        }
    except Exception as e:
        logger.error(f"Stats endpoint failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to get stats")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint with security features and verbose logging"""
    connection_id = f"ws_{id(websocket)}"
    start_time = time.time()
    
    await websocket.accept()
    log_websocket_event("connection_accepted", connection_id, f"client_ip={websocket.client.host if websocket.client else 'unknown'}")
    
    # Get client IP for security logging
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"WebSocket connection attempt from {client_ip}")
    log_system_event("websocket_connection", f"New connection from {client_ip}")
    
    try:
        # Phase 1: Handshake - Get username and topic
        log_websocket_event("handshake_start", connection_id, "Waiting for join message")
        handshake_data = await websocket.receive_text()
        log_websocket_event("handshake_received", connection_id, f"Data length: {len(handshake_data)}")
        
        try:
            payload = json.loads(handshake_data)
            log_websocket_event("handshake_parsed", connection_id, f"Message type: {payload.get('type')}")
        except json.JSONDecodeError as e:
            log_websocket_event("handshake_error", connection_id, f"JSON decode error: {str(e)}")
            await message_handler.send_error_message(
                "Invalid JSON format", 
                websocket
            )
            await websocket.close(code=1003, reason="Invalid JSON")
            return
        
        # Validate handshake payload
        if payload.get("type") != "join":
            await message_handler.send_error_message(
                "First message must be join request",
                websocket
            )
            await websocket.close(code=1002, reason="Protocol error")
            return
        
        username = payload.get("username", "")
        topic = payload.get("topic", "")
        
        # Add client to room
        success, final_username, error_msg = await room_manager.add_client(
            username, topic, websocket, client_ip
        )
        
        if not success:
            await message_handler.send_error_message(error_msg, websocket)
            await websocket.close(code=1008, reason="Join failed")
            return
        
        # Send join confirmation
        await message_handler.send_join_confirmation(final_username, topic, websocket)
        
        # Phase 2: Message Loop
        while True:
            try:
                # Receive message
                message_data = await websocket.receive_text()
                
                try:
                    payload = json.loads(message_data)
                except json.JSONDecodeError:
                    await message_handler.send_error_message(
                        "Invalid JSON format",
                        websocket
                    )
                    continue
                
                message_type = payload.get("type")
                
                if message_type == "message":
                    log_message_event("processing", final_username, topic, "start", f"Message length: {len(payload.get('message', ''))}")
                    
                    # Get client connection by username and topic
                    client_connection = await room_manager.get_client_connection(final_username, topic)
                    
                    if not client_connection:
                        log_message_event("error", final_username, topic, "client_not_found", "Client connection not found in room manager")
                        logger.error(f"Client connection not found for {final_username}")
                        break
                    
                    log_message_event("client_found", final_username, topic, "success", "Client connection retrieved")
                    
                    # Get all clients in topic for broadcasting
                    clients = await room_manager.get_clients_in_topic(topic)
                    log_message_event("broadcast_start", final_username, topic, "start", f"Broadcasting to {len(clients)} clients")
                    
                    # Handle message
                    success, error_msg, chat_message = await message_handler.handle_client_message(
                        payload, client_connection
                    )
                    
                    if success and chat_message:
                        log_message_event("handled", final_username, topic, "success", f"Message ID: {chat_message.message_id[:8]}...")
                        
                        # Update client stats
                        await room_manager.update_client_stats(final_username, topic)
                        
                        # Broadcast to other clients
                        recipients = await message_handler.broadcast_message(
                            chat_message, clients, websocket
                        )
                        
                        log_message_event("broadcast_complete", final_username, topic, "success", f"Delivered to {recipients} recipients")
                        
                        # Send ACK to sender
                        await message_handler.send_ack_message(
                            chat_message.message_id, recipients, websocket
                        )
                        
                        log_message_event("ack_sent", final_username, topic, "success", f"ACK sent for message {chat_message.message_id[:8]}...")
                        
                    elif error_msg:
                        log_message_event("error", final_username, topic, "processing_failed", f"Error: {error_msg}")
                        await message_handler.send_error_message(error_msg, websocket)
                
                elif message_type == "demo_log":
                    # Handle demo logging events
                    log_demo_event(payload.get("event_type", "unknown"), 
                                 payload.get("details", ""), 
                                 payload.get("room_id", ""))
                
                elif message_type == "heartbeat":
                    # Handle heartbeat messages
                    log_websocket_event("heartbeat_received", connection_id, f"from {final_username}")
                    # Echo heartbeat back to client
                    await websocket.send_text(json.dumps({
                        "type": "heartbeat",
                        "timestamp": time.time(),
                        "status": "received"
                    }))
                
                elif message_type == "join":
                    # Handle re-join attempts (user trying to join again)
                    log_message_event("rejoin_attempt", final_username, topic, "info", "User attempting to re-join")
                    # Send current room status
                    clients = await room_manager.get_clients_in_topic(topic)
                    await message_handler.send_join_confirmation(final_username, topic, websocket)
                
                elif message_type == "leave":
                    # Handle leave messages
                    log_message_event("leave", final_username, topic, "info", "User leaving room")
                    await room_manager.remove_client(final_username, topic)
                    await websocket.send_text(json.dumps({
                        "type": "left",
                        "username": final_username,
                        "topic": topic,
                        "timestamp": time.time()
                    }))
                
                elif message_type == "list":
                    # Send list of active topics
                    topics_info = await room_manager.get_all_topics_info()
                    await message_handler.send_list_response(topics_info, websocket)
                
                else:
                    await message_handler.send_error_message(
                        f"Unknown message type: {message_type}",
                        websocket
                    )
                
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for {final_username} in {topic}")
                break
            except Exception as e:
                logger.error(f"Message loop error for {final_username}: {e}")
                log_security_event("message_loop_error", {
                    "username": final_username,
                    "topic": topic,
                    "error": str(e)
                })
                # Continue processing other messages
                continue
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected during handshake for {client_ip}")
    
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        log_security_event("websocket_error", {
            "client_ip": client_ip,
            "error": str(e)
        })
    
    finally:
        # Phase 3: Cleanup - Remove client from room
        if 'final_username' in locals() and 'topic' in locals():
            await room_manager.remove_client(final_username, topic)
            logger.info(f"Cleanup completed for {final_username} in {topic}")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler for security"""
    logger.error(f"Unhandled exception: {exc}")
    log_security_event("unhandled_exception", {
        "path": str(request.url),
        "error": str(exc)
    })
    raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    logger.info("Starting Secure WebSocket Chat Server...")
    
    # Run server with security settings
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Set to False in production
        log_level="info",
        access_log=True,
        # Security settings
        ssl_keyfile=None,  # Add SSL certificates for production
        ssl_certfile=None,
        # Performance settings
        ws_ping_interval=20,
        ws_ping_timeout=10,
    )
