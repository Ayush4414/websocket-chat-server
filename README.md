# Real-Time WebSocket Chat Server with Topic Rooms

A lightweight real-time chat server built with FastAPI WebSockets that supports topic-based chat rooms, automatic message expiration, and in-memory state management.

## Features

- ✅ Topic-based chat rooms
- ✅ Automatic username deduplication (e.g., `alice#2`)
- ✅ Real-time message broadcasting within topics
- ✅ Automatic message expiration after 30 seconds
- ✅ `/list` command to view active topics
- ✅ Delivery acknowledgments for sent messages
- ✅ Automatic cleanup of empty topics
- ✅ Graceful error handling

## Requirements

- Python 3.9 or higher
- FastAPI
- Uvicorn
- websockets

## Installation

1. **Clone the repository**
```bash
git clone https://github.com/Ayush4414/websocket-chat-server.git
cd websocket-chat-server
```

2. **Install dependencies**
```bash
pip install fastapi uvicorn websockets
```

## Running the Application

### Start the Server
```bash
python main.py
```

The server will start on: **http://localhost:8000**

You should see output like:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Start the Client

Open a new terminal and run:
```bash
python client_example.py alice sports
```

Or run interactively:
```bash
python client_example.py
```

## Usage

### Client Commands

- `/list` - Show all active topics and user counts
- `/help` - Show available commands
- `/quit` or `/exit` - Disconnect from chat

### Example: Two Users Chatting

**Terminal 1 - Server:**
```bash
python main.py
```

**Terminal 2 - User Alice:**
```bash
python client_example.py alice sports
```

**Terminal 3 - User Bob:**
```bash
python client_example.py bob sports
```

Now Alice and Bob can chat in real-time in the `sports` topic!

## WebSocket API

### Connection

Connect to: `ws://localhost:8000/ws`

**Initial message:**
```json
{
  "username": "alice",
  "topic": "sports"
}
```

### Send Message
```json
{
  "message": "Hello everyone!"
}
```

### List Topics

Send plain text:
```
/list
```

## 📁 Project Structure
```
TRISHANKU/
├── __pycache__/            # Python cache files
├── helpers/                # Helper modules
│   ├── __init__.py
│   ├── constants.py        # Configuration constants
│   ├── logger.py           # Logging utilities
│   ├── message_handler.py  # Message processing
│   ├── models.py           # Data models
│   ├── room_manager.py     # Room management logic
│   └── validators.py       # Input validation
├── static/                 # Static files for web interface
│   ├── css/
│   │   └── chat.css        # Chat styling
│   └── js/
│       ├── chat-new.js     # New chat interface
│       └── chat.js         # Chat WebSocket client
├── templates/              # HTML templates
│   ├── chat-new.html       # New chat interface
│   └── index.html          # Main chat page
├── client_example.py       # Python CLI WebSocket client
├── main.py                 # FastAPI WebSocket server
├── README.md               # This file
└── requirements.txt        # Python dependencies
```

## Testing

Run multiple clients in different terminals to test:

1. **Real-time messaging** - Send messages between users in the same topic
2. **Topic isolation** - Users in different topics don't see each other's messages
3. **Username deduplication** - Join with duplicate names to see `#2`, `#3` suffixes
4. **Message expiration** - Messages auto-delete after 30 seconds
5. **Topic cleanup** - Topics disappear when all users leave

## roubleshooting

**Port already in use:**
```bash
# Change port in main.py or kill the process
lsof -ti:8000 | xargs kill -9  # Mac/Linux
```

**Module not found:**
```bash
pip install --upgrade fastapi uvicorn websockets
```

## Assignment Details

- **Language:** Python 3.9+
- **Framework:** FastAPI (WebSocket)
- **Storage:** In-memory only (no database)
- **Message Expiration:** 30 seconds using asyncio

##  Author

Ayush Singh