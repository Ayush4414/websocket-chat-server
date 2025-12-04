/**
 * Modern WebSocket Chat Application - Ground Up Rebuild
 * Following 2024 best practices for scalable real-time systems
 */

// Core Architecture Components
class ChatEventBus {
    constructor() {
        this.listeners = new Map();
        this.middleware = [];
    }

    subscribe(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        
        return () => {
            this.listeners.get(event).delete(callback);
        };
    }

    publish(event, data) {
        let processedData = data;
        
        // Apply middleware
        for (const middleware of this.middleware) {
            processedData = middleware(event, processedData);
        }
        
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(processedData);
                } catch (error) {
                    console.error(`Event handler error for ${event}:`, error);
                }
            });
        }
    }

    use(middleware) {
        this.middleware.push(middleware);
    }
}

class ConnectionManager {
    constructor() {
        this.connection = null;
        this.state = 'disconnected';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.heartbeatInterval = null;
        this.messageQueue = [];
        this.eventBus = new ChatEventBus();
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // Connection lifecycle events
        this.eventBus.subscribe('connection:connecting', () => {
            this.state = 'connecting';
            console.log('[CONN] Connecting to server...');
        });

        this.eventBus.subscribe('connection:connected', () => {
            this.state = 'connected';
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.processMessageQueue();
            console.log('[CONN] Connected successfully');
        });

        this.eventBus.subscribe('connection:disconnected', () => {
            this.state = 'disconnected';
            this.stopHeartbeat();
            console.log('[CONN] Disconnected');
        });

        this.eventBus.subscribe('connection:error', (error) => {
            console.error('[CONN] Connection error:', error);
            this.attemptReconnect();
        });
    }

    async connect(url, options = {}) {
        if (this.state === 'connecting' || this.state === 'connected') {
            return;
        }

        this.eventBus.publish('connection:connecting');

        try {
            this.connection = new WebSocket(url);
            this.setupWebSocketHandlers();
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);

                const onConnected = () => {
                    clearTimeout(timeout);
                    resolve();
                };

                const onError = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };

                this.eventBus.subscribe('connection:connected', onConnected);
                this.eventBus.subscribe('connection:error', onError);
            });

        } catch (error) {
            this.eventBus.publish('connection:error', error);
            throw error;
        }
    }

    connectWithAuth(url, username, topic) {
        return new Promise((resolve, reject) => {
            // Create connection with auth in one step
            this.connection = new WebSocket(url);
            this.state = 'connecting';
            
            this.connection.onopen = () => {
                console.log('[CONN] Connected, sending auth...');
                // Send join message immediately after connection
                this.send({
                    type: 'join',
                    username: username,
                    topic: topic
                });
                
                this.state = 'connected';
                this.startHeartbeat();
                this.processMessageQueue();
                this.eventBus.publish('connection:connected');
                resolve();
            };

            this.connection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.eventBus.publish('message:received', data);
                } catch (error) {
                    console.error('[CONN] Invalid message format:', error);
                    this.eventBus.publish('message:error', { error: 'Invalid message format' });
                }
            };

            this.connection.onclose = (event) => {
                this.state = 'disconnected';
                this.stopHeartbeat();
                this.eventBus.publish('connection:disconnected', { 
                    code: event.code, 
                    reason: event.reason 
                });
            };

            this.connection.onerror = (error) => {
                this.eventBus.publish('connection:error', error);
                reject(error);
            };
        });
    }

    setupWebSocketHandlers() {
        this.connection.onopen = () => {
            this.eventBus.publish('connection:connected');
        };

        this.connection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.eventBus.publish('message:received', data);
            } catch (error) {
                console.error('[CONN] Invalid message format:', error);
                this.eventBus.publish('message:error', { error: 'Invalid message format' });
            }
        };

        this.connection.onclose = (event) => {
            this.eventBus.publish('connection:disconnected', { 
                code: event.code, 
                reason: event.reason 
            });
        };

        this.connection.onerror = (error) => {
            this.eventBus.publish('connection:error', error);
        };
    }

    send(message) {
        if (this.state === 'connected' && this.connection.readyState === WebSocket.OPEN) {
            try {
                this.connection.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('[CONN] Send error:', error);
                return false;
            }
        } else {
            // Queue message for when connection is restored
            this.messageQueue.push(message);
            return false;
        }
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0 && this.state === 'connected') {
            const message = this.messageQueue.shift();
            this.send(message);
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: 'heartbeat', timestamp: Date.now() });
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[CONN] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`[CONN] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (this.state === 'disconnected') {
                this.connect(this.connection.url);
            }
        }, delay);
    }

    disconnect() {
        this.stopHeartbeat();
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
        this.state = 'disconnected';
    }
}

class RoomManager {
    constructor(eventBus) {
        this.rooms = new Map();
        this.activeRoom = null;
        this.eventBus = eventBus;
        
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.eventBus.subscribe('room:join', (data) => {
            this.joinRoom(data.roomId, data.username);
        });

        this.eventBus.subscribe('room:leave', (data) => {
            this.leaveRoom(data.roomId, data.username);
        });

        this.eventBus.subscribe('room:message', (data) => {
            this.addMessage(data.roomId, data.message);
        });
    }

    createRoom(name, topic) {
        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const room = {
            id: roomId,
            name,
            topic,
            users: new Set(),
            messages: [],
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageLimit: 100
        };

        this.rooms.set(roomId, room);
        this.eventBus.publish('room:created', { roomId, room });
        
        return roomId;
    }

    joinRoom(roomId, username) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error(`Room ${roomId} not found`);
        }

        room.users.add(username);
        room.lastActivity = Date.now();
        
        this.eventBus.publish('room:user_joined', { roomId, username, userCount: room.users.size });
    }

    leaveRoom(roomId, username) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.users.delete(username);
        room.lastActivity = Date.now();
        
        this.eventBus.publish('room:user_left', { roomId, username, userCount: room.users.size });

        // Clean up empty rooms
        if (room.users.size === 0) {
            this.rooms.delete(roomId);
            this.eventBus.publish('room:deleted', { roomId });
        }
    }

    addMessage(roomId, message) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.messages.push({
            ...message,
            timestamp: Date.now(),
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        });

        // Enforce message limit
        if (room.messages.length > room.messageLimit) {
            room.messages.shift();
        }

        room.lastActivity = Date.now();
        this.eventBus.publish('room:message_added', { roomId, message });
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    getAllRooms() {
        return Array.from(this.rooms.values());
    }

    setActiveRoom(roomId) {
        this.activeRoom = roomId;
        this.eventBus.publish('room:active_changed', { roomId });
    }
}

class MessageHandler {
    constructor(connectionManager, roomManager) {
        this.connection = connectionManager;
        this.rooms = roomManager;
        this.handlers = new Map();
        
        this.registerHandlers();
    }

    registerHandlers() {
        this.handlers.set('message', this.handleChatMessage.bind(this));
        this.handlers.set('joined', this.handleUserJoined.bind(this));
        this.handlers.set('left', this.handleUserLeft.bind(this));
        this.handlers.set('ack', this.handleAck.bind(this));
        this.handlers.set('error', this.handleError.bind(this));
        this.handlers.set('list', this.handleList.bind(this));
        this.handlers.set('heartbeat', this.handleHeartbeat.bind(this));
    }

    handle(data) {
        const handler = this.handlers.get(data.type);
        if (handler) {
            try {
                handler(data);
            } catch (error) {
                console.error(`[MSG] Handler error for ${data.type}:`, error);
            }
        } else {
            console.warn(`[MSG] No handler for message type: ${data.type}`);
        }
    }

    handleChatMessage(data) {
        console.log(`[MSG] Chat message: ${data.username} - ${data.message?.substring(0, 30)}...`);
        this.rooms.eventBus.publish('room:message', {
            roomId: this.rooms.activeRoom,
            message: data
        });
    }

    handleUserJoined(data) {
        console.log(`[MSG] User joined: ${data.username} in ${data.topic}`);
        this.rooms.eventBus.publish('room:join', {
            roomId: this.rooms.activeRoom,
            username: data.username
        });
    }

    handleUserLeft(data) {
        console.log(`[MSG] User left: ${data.username} from ${data.topic}`);
        this.rooms.eventBus.publish('room:leave', {
            roomId: this.rooms.activeRoom,
            username: data.username
        });
    }

    handleAck(data) {
        console.log(`[MSG] Acknowledgment: ${data.message_id}`);
    }

    handleError(data) {
        console.error(`[MSG] Server error: ${data.message}`);
    }

    handleList(data) {
        console.log(`[MSG] Topics list: ${data.topics?.length || 0} items`);
    }

    handleHeartbeat(data) {
        console.log(`[MSG] Heartbeat received`);
    }

    sendMessage(type, payload = {}) {
        const message = {
            type,
            ...payload,
            timestamp: Date.now()
        };

        return this.connection.send(message);
    }
}

class ChatUI {
    constructor(eventBus, roomManager) {
        this.eventBus = eventBus;
        this.rooms = roomManager;
        this.elements = {};
        
        this.initializeElements();
        this.setupEventHandlers();
    }

    initializeElements() {
        this.elements = {
            loginForm: document.getElementById('loginForm'),
            messageForm: document.getElementById('messageForm'),
            messagesList: document.getElementById('messagesList'),
            username: document.getElementById('username'),
            topic: document.getElementById('topic'),
            messageInput: document.getElementById('messageInput'),
            connectionStatus: document.getElementById('connectionStatus'),
            topicsList: document.getElementById('topicsList'),
            toastContainer: document.getElementById('toastContainer')
        };
    }

    setupEventHandlers() {
        // Connection events
        this.eventBus.subscribe('connection:connecting', () => {
            this.updateConnectionStatus('connecting');
        });

        this.eventBus.subscribe('connection:connected', () => {
            this.updateConnectionStatus('connected');
            this.showToast('Connected to chat server', 'success');
        });

        this.eventBus.subscribe('connection:disconnected', () => {
            this.updateConnectionStatus('disconnected');
            this.showToast('Disconnected from server', 'warning');
            this.hideChatInterface();
        });

        // Room events
        this.eventBus.subscribe('room:message_added', (data) => {
            this.displayMessage(data.message);
        });

        this.eventBus.subscribe('room:user_joined', (data) => {
            this.showToast(`${data.username} joined the room`, 'info');
        });

        this.eventBus.subscribe('room:user_left', (data) => {
            this.showToast(`${data.username} left the room`, 'info');
        });

        // Auth success event
        this.eventBus.subscribe('auth:success', (data) => {
            this.showChatInterface();
            this.updateRoomInfo(data.username, data.topic);
        });

        // Form submissions
        if (this.elements.loginForm) {
            this.elements.loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (this.elements.messageForm) {
            this.elements.messageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSendMessage();
            });
        }
    }

    updateConnectionStatus(status) {
        if (!this.elements.connectionStatus) return;

        const statusMap = {
            'disconnected': { text: 'Disconnected', class: 'bg-red-600' },
            'connecting': { text: 'Connecting...', class: 'bg-yellow-600' },
            'connected': { text: 'Connected', class: 'bg-green-600' }
        };

        const statusInfo = statusMap[status] || statusMap['disconnected'];
        this.elements.connectionStatus.textContent = statusInfo.text;
        this.elements.connectionStatus.className = `px-3 py-1 rounded-full text-white text-sm ${statusInfo.class}`;
    }

    showChatInterface() {
        // Enable message input and send button
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = false;
            this.elements.messageInput.focus();
        }
        
        const sendButton = document.getElementById('sendButton');
        if (sendButton) {
            sendButton.disabled = false;
        }

        // Clear previous messages and show welcome
        if (this.elements.messagesList) {
            this.elements.messagesList.innerHTML = `
                <div class="text-center text-gray-400 py-4">
                    <i class="fas fa-comments text-2xl mb-2"></i>
                    <p>Welcome to the chat room!</p>
                    <p class="text-sm">Start typing to send messages</p>
                </div>
            `;
        }
    }

    hideChatInterface() {
        // Disable message input and send button
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = true;
            this.elements.messageInput.value = '';
        }
        
        const sendButton = document.getElementById('sendButton');
        if (sendButton) {
            sendButton.disabled = true;
        }

        // Show disconnected message
        if (this.elements.messagesList) {
            this.elements.messagesList.innerHTML = `
                <div class="text-center text-gray-400 py-8">
                    <i class="fas fa-plug text-4xl mb-4"></i>
                    <p>Connection lost</p>
                    <p class="text-sm">Please reconnect to continue chatting</p>
                </div>
            `;
        }
    }

    updateRoomInfo(username, topic) {
        const roomInfoElement = document.getElementById('roomInfo');
        if (roomInfoElement) {
            roomInfoElement.textContent = `${username} in ${topic}`;
        }
    }

    displayMessage(message) {
        if (!this.elements.messagesList) return;

        const messageDiv = document.createElement('div');
        const isOwn = message.username === window.chatClient?.username;
        const time = new Date(message.timestamp).toLocaleTimeString();

        messageDiv.className = `flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`;
        messageDiv.innerHTML = `
            <div class="max-w-xs lg:max-w-md">
                <div class="glass rounded-2xl px-4 py-2 ${isOwn ? 'bg-blue-600 bg-opacity-30' : 'bg-purple-600 bg-opacity-30'}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs text-gray-300">${message.username}</span>
                        <span class="text-xs text-gray-400">${time}</span>
                    </div>
                    <p class="text-white text-sm">${this.escapeHtml(message.message)}</p>
                </div>
            </div>
        `;

        this.elements.messagesList.appendChild(messageDiv);
        this.elements.messagesList.scrollTop = this.elements.messagesList.scrollHeight;
    }

    handleLogin() {
        const username = this.elements.username?.value.trim();
        const topic = this.elements.topic?.value.trim();

        if (!username || !topic) {
            this.showToast('Please enter username and topic', 'error');
            return;
        }

        this.eventBus.publish('auth:login', { username, topic });
    }

    handleSendMessage() {
        const message = this.elements.messageInput?.value.trim();

        if (!message) return;

        this.eventBus.publish('message:send', { message });
        this.elements.messageInput.value = '';
    }

    showToast(message, type = 'info') {
        if (!this.elements.toastContainer) return;

        const toast = document.createElement('div');
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-600',
            info: 'bg-blue-600'
        };

        toast.className = `toast ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg mb-2`;
        toast.textContent = message;

        this.elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Main Chat Application
class ModernChatApp {
    constructor() {
        this.username = '';
        this.topic = '';
        
        // Initialize core components
        this.connectionManager = new ConnectionManager();
        this.roomManager = new RoomManager(this.connectionManager.eventBus);
        this.messageHandler = new MessageHandler(this.connectionManager, this.roomManager);
        this.ui = new ChatUI(this.connectionManager.eventBus, this.roomManager);
        
        this.setupApplicationHandlers();
    }

    setupApplicationHandlers() {
        // Authentication
        this.connectionManager.eventBus.subscribe('auth:login', async (data) => {
            await this.handleLogin(data);
        });

        // Message sending
        this.connectionManager.eventBus.subscribe('message:send', (data) => {
            this.messageHandler.sendMessage('message', {
                username: this.username,
                topic: this.topic,
                message: data.message
            });
        });

        // Incoming messages
        this.connectionManager.eventBus.subscribe('message:received', (data) => {
            this.messageHandler.handle(data);
        });
    }

    async handleLogin(data) {
        try {
            this.username = data.username;
            this.topic = data.topic;

            // Connect to WebSocket server with auth in one step
            await this.connectionManager.connectWithAuth(
                `ws://${window.location.host}/ws`, 
                this.username, 
                this.topic
            );

            // Create and join room (client-side only)
            const roomId = this.roomManager.createRoom(this.topic, this.topic);
            this.roomManager.setActiveRoom(roomId);
            this.roomManager.joinRoom(roomId, this.username);

            // Publish auth success event to update UI
            this.connectionManager.eventBus.publish('auth:success', {
                username: this.username,
                topic: this.topic
            });

            this.ui.showToast(`Joined ${this.topic} as ${this.username}`, 'success');

        } catch (error) {
            console.error('[APP] Login failed:', error);
            this.ui.showToast('Failed to connect to server', 'error');
        }
    }

    disconnect() {
        this.messageHandler.sendMessage('leave', {
            username: this.username,
            topic: this.topic
        });
        
        this.connectionManager.disconnect();
        this.username = '';
        this.topic = '';
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatClient = new ModernChatApp();
    console.log('[APP] Modern Chat Application initialized');
});
