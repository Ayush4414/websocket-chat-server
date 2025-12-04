"""
WebSocket Chat Client Example for Testing
Security-focused test client with comprehensive scenario coverage
"""

import asyncio
import json
import websockets
import time
from typing import Optional, Dict, Any
import argparse
import sys

class ChatClient:
    """Secure WebSocket chat client for testing"""
    
    def __init__(self, username: str, topic: str, server_url: str = "ws://localhost:8000/ws"):
        self.username = username
        self.topic = topic
        self.server_url = server_url
        self.websocket: Optional[websockets.WebSocketServerProtocol] = None
        self.assigned_username: Optional[str] = None
        self.running = False
        
    async def connect(self) -> bool:
        """Connect to WebSocket server"""
        try:
            self.websocket = await websockets.connect(self.server_url)
            print(f"✅ Connected to {self.server_url}")
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False
    
    async def join_room(self) -> bool:
        """Join a chat room"""
        if not self.websocket:
            return False
        
        try:
            join_message = {
                "type": "join",
                "username": self.username,
                "topic": self.topic
            }
            
            await self.websocket.send(json.dumps(join_message))
            print(f"📤 Sent join request: {self.username} -> {self.topic}")
            
            # Wait for response
            response = await self.websocket.recv()
            data = json.loads(response)
            
            if data.get("type") == "joined":
                self.assigned_username = data.get("username")
                print(f"✅ Joined room as: {self.assigned_username}")
                return True
            elif data.get("type") == "error":
                print(f"❌ Join failed: {data.get('message')}")
                return False
            else:
                print(f"❌ Unexpected response: {data}")
                return False
                
        except Exception as e:
            print(f"❌ Join failed: {e}")
            return False
    
    async def send_message(self, message: str) -> bool:
        """Send a message to the room"""
        if not self.websocket:
            return False
        
        try:
            message_data = {
                "type": "message",
                "message": message
            }
            
            await self.websocket.send(json.dumps(message_data))
            print(f"📤 Message sent: {message}")
            return True
            
        except Exception as e:
            print(f"❌ Send failed: {e}")
            return False
    
    async def request_list(self) -> bool:
        """Request list of active topics"""
        if not self.websocket:
            return False
        
        try:
            list_request = {"type": "list"}
            await self.websocket.send(json.dumps(list_request))
            print("📤 Requested topic list")
            return True
            
        except Exception as e:
            print(f"❌ List request failed: {e}")
            return False
    
    async def listen_for_messages(self):
        """Listen for incoming messages"""
        if not self.websocket:
            return
        
        try:
            while self.running:
                try:
                    message = await asyncio.wait_for(self.websocket.recv(), timeout=1.0)
                    data = json.loads(message)
                    
                    msg_type = data.get("type")
                    
                    if msg_type == "message":
                        sender = data.get("username", "unknown")
                        content = data.get("message", "")
                        timestamp = data.get("timestamp", 0)
                        print(f"📨 [{time.strftime('%H:%M:%S', time.localtime(timestamp))}] {sender}: {content}")
                    
                    elif msg_type == "ack":
                        msg_id = data.get("message_id", "unknown")
                        recipients = data.get("recipients", 0)
                        print(f"✅ Message delivered to {recipients} recipients (ID: {msg_id[:8]}...)")
                    
                    elif msg_type == "list":
                        topics = data.get("topics", [])
                        print(f"📋 Active topics ({len(topics)}):")
                        for topic in topics:
                            name = topic.get("topic", "unknown")
                            users = topic.get("user_count", 0)
                            print(f"   • {name} ({users} users)")
                    
                    elif msg_type == "error":
                        error_msg = data.get("message", "Unknown error")
                        print(f"❌ Server error: {error_msg}")
                    
                    else:
                        print(f"❓ Unknown message type: {msg_type}")
                        
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print("🔌 Connection closed by server")
                    break
                except Exception as e:
                    print(f"❌ Message receive error: {e}")
                    break
                    
        except Exception as e:
            print(f"❌ Listen error: {e}")
    
    async def disconnect(self):
        """Disconnect from server"""
        self.running = False
        if self.websocket:
            try:
                await self.websocket.close()
                print("🔌 Disconnected from server")
            except:
                pass
    
    async def run_interactive(self):
        """Run interactive chat session"""
        if not await self.connect():
            return
        
        if not await self.join_room():
            await self.disconnect()
            return
        
        self.running = True
        
        # Start listening task
        listen_task = asyncio.create_task(self.listen_for_messages())
        
        try:
            print("\n🎮 Interactive mode started!")
            print("Commands: /list, /quit, or just type your message")
            print("-" * 50)
            
            while self.running:
                try:
                    user_input = input(f"{self.assigned_username}> ").strip()
                    
                    if not user_input:
                        continue
                    
                    if user_input == "/quit":
                        break
                    elif user_input == "/list":
                        await self.request_list()
                    else:
                        await self.send_message(user_input)
                        
                except KeyboardInterrupt:
                    break
                except EOFError:
                    break
                    
        finally:
            self.running = False
            listen_task.cancel()
            await self.disconnect()

async def test_scenario_1():
    """Test Scenario 1: Multi-user same-topic messaging"""
    print("\n🧪 Test Scenario 1: Multi-user Same-Topic Messaging")
    print("=" * 60)
    
    async def alice_client():
        client = ChatClient("alice", "sports")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(1)
            await client.send_message("Hello everyone!")
            await asyncio.sleep(2)
            await client.send_message("How about that game last night?")
            
            await asyncio.sleep(5)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    async def bob_client():
        await asyncio.sleep(0.5)
        client = ChatClient("bob", "sports")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(2)
            await client.send_message("Hey Alice!")
            await asyncio.sleep(1)
            await client.send_message("It was amazing! Best game ever!")
            
            await asyncio.sleep(4)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    await asyncio.gather(alice_client(), bob_client())
    print("✅ Scenario 1 completed")

async def test_scenario_2():
    """Test Scenario 2: Topic isolation"""
    print("\n🧪 Test Scenario 2: Topic Isolation")
    print("=" * 60)
    
    async def alice_sports():
        client = ChatClient("alice", "sports")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(1)
            await client.send_message("Sports fans, where are you?")
            await asyncio.sleep(3)
            await client.request_list()
            
            await asyncio.sleep(3)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    async def charlie_movies():
        await asyncio.sleep(0.5)
        client = ChatClient("charlie", "movies")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(2)
            await client.send_message("Anyone seen the new blockbuster?")
            await asyncio.sleep(2)
            await client.request_list()
            
            await asyncio.sleep(3)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    await asyncio.gather(alice_sports(), charlie_movies())
    print("✅ Scenario 2 completed")

async def test_scenario_6():
    """Test Scenario 6: Username uniqueness"""
    print("\n🧪 Test Scenario 6: Username Uniqueness")
    print("=" * 60)
    
    async def alice1():
        client = ChatClient("alice", "test")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(1)
            await client.send_message("I'm the first Alice!")
            
            await asyncio.sleep(4)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    async def alice2():
        await asyncio.sleep(0.5)
        client = ChatClient("alice", "test")
        if await client.connect() and await client.join_room():
            client.running = True
            listen_task = asyncio.create_task(client.listen_for_messages())
            
            await asyncio.sleep(2)
            await client.send_message("I'm the second Alice!")
            
            await asyncio.sleep(3)
            client.running = False
            listen_task.cancel()
            await client.disconnect()
    
    await asyncio.gather(alice1(), alice2())
    print("✅ Scenario 6 completed")

async def main():
    """Main function with command line interface"""
    parser = argparse.ArgumentParser(description="WebSocket Chat Client")
    parser.add_argument("--username", default="testuser", help="Username")
    parser.add_argument("--topic", default="general", help="Chat topic")
    parser.add_argument("--server", default="ws://localhost:8000/ws", help="Server URL")
    parser.add_argument("--test", choices=["1", "2", "6"], help="Run test scenario")
    
    args = parser.parse_args()
    
    if args.test:
        if args.test == "1":
            await test_scenario_1()
        elif args.test == "2":
            await test_scenario_2()
        elif args.test == "6":
            await test_scenario_6()
    else:
        # Interactive mode
        client = ChatClient(args.username, args.topic, args.server)
        await client.run_interactive()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
    except Exception as e:
        print(f"❌ Client error: {e}")
        sys.exit(1)
