// Secure WebSocket Chat Client
class SecureChatClient {
    constructor() {
        this.ws = null;
        this.username = '';
        this.topic = '';
        this.connected = false;
        this.messages = new Map(); // message_id -> message data
        this.timers = new Map();   // message_id -> timer
        // Demo clients for visualization
        this.demoClients = new Map(); // room_id -> DemoClient
        this.demoRunning = false;
        this.demoInterval = null;
        // Asynchronous message queue
        this.messageQueue = [];
        this.processingQueue = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        // Enhanced room management
        this.rooms = new Map(); // room_id -> RoomManager
        this.activeRoom = null;
        this.messageHandlers = new Map(); // message_type -> handler
        this.connectionState = 'disconnected';
        this.heartbeatInterval = null;
        
        this.init();
    }

    init() {
        this.setupMessageHandlers();
        this.setupEventListeners();
        this.loadTheme();
        this.checkServerStatus();
    }

    setupMessageHandlers() {
        // Register message handlers
        this.messageHandlers.set('message', this.handleChatMessage.bind(this));
        this.messageHandlers.set('joined', this.handleJoinedMessage.bind(this));
        this.messageHandlers.set('left', this.handleLeftMessage.bind(this));
        this.messageHandlers.set('ack', this.handleAckMessage.bind(this));
        this.messageHandlers.set('error', this.handleErrorMessage.bind(this));
        this.messageHandlers.set('list', this.handleListMessage.bind(this));
        this.messageHandlers.set('heartbeat', this.handleHeartbeat.bind(this));
    }

    setupEventListeners() {
        // Form submissions
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('messageForm').addEventListener('submit', (e) => this.handleSendMessage(e));

        // Buttons
        document.getElementById('disconnectBtn').addEventListener('click', () => this.disconnect());
        document.getElementById('refreshTopics').addEventListener('click', () => this.refreshTopics());
        document.getElementById('statsBtn').addEventListener('click', () => this.showStats());
        document.getElementById('closeStats').addEventListener('click', () => this.hideStats());

        // Quick topic buttons
        document.querySelectorAll('.topic-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.getElementById('topic').value = e.target.dataset.topic;
            });
        });

        // Demo scenario buttons
        document.querySelectorAll('.demo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.runDemo(e.target.dataset.scenario);
            });
        });

        // Demo control buttons
        document.getElementById('startDemo').addEventListener('click', () => this.startFullDemo());
        document.getElementById('stopDemo').addEventListener('click', () => this.stopFullDemo());
        document.getElementById('resetDemo').addEventListener('click', () => this.resetDemo());

        // Message input
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', (e) => this.updateCharCount(e));
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage(e);
            }
        });

        // Window events
        window.addEventListener('beforeunload', () => this.disconnect());
        window.addEventListener('online', () => this.checkServerStatus());
        window.addEventListener('offline', () => this.updateConnectionStatus(false));
    }

    async checkServerStatus() {
        try {
            const response = await fetch('/health');
            if (response.ok) {
                this.showToast('Server is online', 'success');
            } else {
                this.showToast('Server is experiencing issues', 'warning');
            }
        } catch (error) {
            this.showToast('Cannot connect to server', 'error');
        }
    }

    handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const topic = document.getElementById('topic').value.trim();

        if (!username || !topic) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        this.connect(username, topic);
    }

    connect(username, topic) {
        console.log(`[CLIENT] Starting connection: username=${username}, topic=${topic}`);
        this.logDemoEvent('client_connect_start', `Starting connection for ${username} to ${topic}`);
        
        this.username = username;
        this.topic = topic;
        this.connectionState = 'connecting';

        const wsUrl = `ws://${window.location.host}/ws`;
        console.log(`[CLIENT] Connecting to WebSocket URL: ${wsUrl}`);
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.setupWebSocketHandlers();
            this.createRoom(topic);
        } catch (error) {
            console.error('[CLIENT] Failed to create WebSocket:', error);
            this.logDemoEvent('client_websocket_create_error', `Failed to create WebSocket: ${error.message}`);
            this.handleConnectionError(error);
        }
    }

    createRoom(topicName) {
        console.log(`[ROOM] Creating room: ${topicName}`);
        const roomId = `room_${topicName}_${Date.now()}`;
        
        const room = {
            id: roomId,
            name: topicName,
            users: new Set(),
            messages: [],
            createdAt: Date.now(),
            lastActivity: Date.now()
        };
        
        this.rooms.set(roomId, room);
        this.activeRoom = roomId;
        
        console.log(`[ROOM] Room created: ${roomId}`);
        return roomId;
    }

    setupWebSocketHandlers() {
        this.ws.onopen = () => {
            console.log(`[CLIENT] WebSocket connection opened successfully`);
            this.logDemoEvent('client_connected', 'WebSocket connection established');
            this.connected = true;
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);
            this.sendJoinMessage();
            this.startHeartbeat();
            this.processMessageQueue();
        };

        this.ws.onmessage = async (event) => {
            console.log(`[CLIENT] Message received: ${event.data.substring(0, 100)}...`);
            try {
                const data = JSON.parse(event.data);
                console.log(`[CLIENT] Parsed message type: ${data.type}`);
                await this.handleMessageAsync(data);
            } catch (error) {
                console.error('[CLIENT] Invalid JSON received:', error);
                this.logDemoEvent('client_message_error', `Invalid JSON: ${error.message}`);
            }
        };

        this.ws.onclose = (event) => {
            console.log(`[CLIENT] WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            this.logDemoEvent('client_disconnected', `WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
            this.connected = false;
            this.connectionState = 'disconnected';
            this.updateConnectionStatus(false);
            this.stopHeartbeat();
            this.showToast('Connection closed', 'warning');
            
            // Attempt reconnection if not a normal closure
            if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.attemptReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error('[CLIENT] WebSocket error:', error);
            this.logDemoEvent('client_error', `WebSocket error: ${error}`);
            this.showToast('Connection error', 'error');
            this.updateConnectionStatus(false);
        };
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.connected && this.ws) {
                this.ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
            }
        }, 30000); // Send heartbeat every 30 seconds
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    async handleMessageAsync(data) {
        // Add message to queue for async processing
        this.messageQueue.push(data);
        
        if (!this.processingQueue) {
            this.processingQueue = true;
            await this.processMessageQueue();
        }
    }

    async processMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            
            try {
                // Process message asynchronously with proper handler
                await new Promise(resolve => {
                    setTimeout(() => {
                        this.dispatchMessage(message);
                        resolve();
                    }, 0);
                });
            } catch (error) {
                console.error('[CLIENT] Error processing message:', error);
                this.logDemoEvent('client_message_process_error', `Error processing message: ${error.message}`);
            }
        }
        
        this.processingQueue = false;
    }

    dispatchMessage(data) {
        console.log(`[DISPATCH] Routing message type: ${data.type}`);
        
        const handler = this.messageHandlers.get(data.type);
        if (handler) {
            console.log(`[DISPATCH] Found handler for ${data.type}`);
            handler(data);
        } else {
            console.warn(`[DISPATCH] No handler for message type: ${data.type}`);
            this.logDemoEvent('dispatch_error', `No handler for message type: ${data.type}`);
        }
    }

    // Enhanced message handlers
    handleChatMessage(data) {
        console.log(`[MESSAGE] Chat message received: ${data.username} - ${data.message.substring(0, 30)}...`);
        
        // Update room activity
        if (this.activeRoom) {
            const room = this.rooms.get(this.activeRoom);
            if (room) {
                room.lastActivity = Date.now();
                room.messages.push(data);
                
                // Limit message history
                if (room.messages.length > 100) {
                    room.messages.shift();
                }
            }
        }
        
        this.displayMessage(data);
    }

    handleJoinedMessage(data) {
        console.log(`[JOIN] User joined: ${data.username} in ${data.topic}`);
        this.showToast(`${data.username} joined ${data.topic}`, 'success');
        
        // Update room users
        if (this.activeRoom) {
            const room = this.rooms.get(this.activeRoom);
            if (room && room.name === data.topic) {
                room.users.add(data.username);
            }
        }
    }

    handleLeftMessage(data) {
        console.log(`[LEFT] User left: ${data.username} from ${data.topic}`);
        this.showToast(`${data.username} left ${data.topic}`, 'warning');
        
        // Update room users
        this.rooms.forEach(room => {
            if (room.name === data.topic) {
                room.users.delete(data.username);
            }
        });
    }

    handleAckMessage(data) {
        console.log(`[ACK] Message acknowledged: ${data.message_id}`);
        // Update message status in UI if needed
    }

    handleErrorMessage(data) {
        console.error(`[ERROR] Server error: ${data.message}`);
        this.showToast(`Server error: ${data.message}`, 'error');
    }

    handleListMessage(data) {
        console.log(`[LIST] Topics received: ${data.topics?.length || 0}`);
        this.updateTopicsList(data.topics || []);
    }

    handleHeartbeat(data) {
        console.log(`[HEARTBEAT] Server heartbeat received`);
        // Update connection status indicator
    }

    attemptReconnect() {
        this.reconnectAttempts++;
        console.log(`[CLIENT] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        this.logDemoEvent('client_reconnect_attempt', `Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        
        setTimeout(() => {
            if (!this.connected && this.reconnectAttempts <= this.maxReconnectAttempts) {
                this.connect(this.username, this.topic);
            }
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    handleConnectionError(error) {
        console.error('[CLIENT] Connection error:', error);
        this.showToast('Failed to connect to server', 'error');
        this.updateConnectionStatus(false);
        
        // Show retry option
        setTimeout(() => {
            if (confirm('Connection failed. Would you like to retry?')) {
                this.connect(this.username, this.topic);
            }
        }, 2000);
    }

    sendJoinMessage() {
        const message = {
            type: 'join',
            username: this.username,
            topic: this.topic
        };
        this.ws.send(JSON.stringify(message));
    }

    handleMessage(data) {
        switch (data.type) {
            case 'joined':
                this.handleJoined(data);
                break;
            case 'message':
                this.displayMessage(data);
                break;
            case 'ack':
                this.handleAck(data);
                break;
            case 'list':
                this.displayTopics(data.topics);
                break;
            case 'error':
                this.showToast(data.message, 'error');
                break;
        }
    }

    handleJoined(data) {
        this.username = data.username;
        this.topic = data.topic;
        this.connected = true;

        // Update UI
        document.getElementById('currentUsername').textContent = this.username;
        document.getElementById('currentTopic').textContent = this.topic;
        document.getElementById('loginPanel').classList.add('hidden');
        document.getElementById('chatPanel').classList.remove('hidden');
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendBtn').disabled = false;

        // Clear messages
        document.getElementById('messagesList').innerHTML = '';
        this.messages.clear();
        this.clearTimers();

        this.showToast(`Joined ${this.topic} as ${this.username}`, 'success');
        this.refreshTopics();
    }

    displayMessage(data) {
        console.log(`[CLIENT] Displaying message: ${data.username} - ${data.message.substring(0, 30)}...`);
        
        const messagesList = document.getElementById('messagesList');
        const messageDiv = document.createElement('div');
        
        const isOwn = data.username === this.username;
        const time = new Date(data.timestamp * 1000).toLocaleTimeString();

        messageDiv.className = `message-bubble ${isOwn ? 'own' : 'other'} flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`;
        messageDiv.innerHTML = `
            <div class="max-w-xs lg:max-w-md">
                <div class="glass rounded-2xl px-4 py-2 ${isOwn ? 'bg-blue-600 bg-opacity-30' : 'bg-purple-600 bg-opacity-30'}">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs text-gray-300">${data.username}</span>
                        <span class="text-xs text-gray-400">${time}</span>
                    </div>
                    <p class="text-white text-sm">${this.escapeHtml(data.message)}</p>
                </div>
                <div class="message-timer" data-message-id="${data.message_id}">30s</div>
            </div>
        `;

        messagesList.appendChild(messageDiv);
        
        // Force immediate scroll to bottom
        messagesList.scrollTop = messagesList.scrollHeight;
        
        // Force browser repaint for immediate display
        messageDiv.offsetHeight;

        // Store message and start expiration timer
        this.messages.set(data.message_id, data);
        this.startMessageTimer(data.message_id);
        
        console.log(`[CLIENT] Message displayed successfully for ${data.username}`);
    }

    startMessageTimer(messageId) {
        let seconds = 30;
        const timerElement = document.querySelector(`[data-message-id="${messageId}"]`);
        
        if (!timerElement) return;

        const timer = setInterval(() => {
            seconds--;
            if (timerElement) {
                timerElement.textContent = `${seconds}s`;
                
                if (seconds <= 5) {
                    timerElement.classList.add('text-red-400');
                }
            }

            if (seconds <= 0) {
                clearInterval(timer);
                this.removeMessage(messageId);
                this.timers.delete(messageId);
            }
        }, 1000);

        this.timers.set(messageId, timer);
    }

    removeMessage(messageId) {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            const messageBubble = messageElement.closest('.message-bubble');
            if (messageBubble) {
                messageBubble.classList.add('expiring');
                setTimeout(() => {
                    messageBubble.remove();
                }, 2000);
            }
        }
        this.messages.delete(messageId);
    }

    clearTimers() {
        this.timers.forEach(timer => clearInterval(timer));
        this.timers.clear();
    }

    handleAck(data) {
        // Update message delivery status
        const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageElement) {
            messageElement.innerHTML += ` ✓${data.recipients}`;
        }
    }

    displayTopics(topics) {
        const topicsList = document.getElementById('topicsList');
        
        if (topics.length === 0) {
            topicsList.innerHTML = '<p class="text-gray-400 text-sm">No active topics</p>';
            return;
        }

        topicsList.innerHTML = topics.map(topic => `
            <div class="flex items-center justify-between p-2 bg-white bg-opacity-10 rounded-lg">
                <div class="flex items-center space-x-2">
                    <i class="fas fa-hashtag text-blue-400"></i>
                    <span class="text-white text-sm">${topic.topic}</span>
                </div>
                <span class="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                    ${topic.user_count} users
                </span>
            </div>
        `).join('');
    }

    handleSendMessage(e) {
        e.preventDefault();
        
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();

        if (!message || !this.connected) {
            if (!this.connected) {
                this.showToast('Not connected to server', 'warning');
            }
            return;
        }

        // Queue message for asynchronous sending
        this.queueMessage({
            type: 'message',
            message: message
        });

        messageInput.value = '';
        this.updateCharCount({ target: messageInput });
    }

    queueMessage(messageData) {
        // Add timestamp and queue message
        const queuedMessage = {
            ...messageData,
            timestamp: Date.now(),
            id: this.generateMessageId()
        };

        this.messageQueue.push(queuedMessage);
        
        // Process queue if connected
        if (this.connected) {
            this.processSendQueue();
        }
    }

    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async processSendQueue() {
        while (this.messageQueue.length > 0 && this.connected) {
            const message = this.messageQueue.find(msg => msg.type === 'message' && !msg.sent);
            
            if (message) {
                try {
                    await this.sendMessageAsync(message);
                    message.sent = true;
                } catch (error) {
                    console.error('[CLIENT] Failed to send message:', error);
                    this.logDemoEvent('client_send_error', `Failed to send message: ${error.message}`);
                    break;
                }
            } else {
                break;
            }
        }
    }

    sendMessageAsync(messageData) {
        return new Promise((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    this.ws.send(JSON.stringify(messageData));
                    console.log(`[CLIENT] Message sent: ${messageData.type}`);
                    this.logDemoEvent('client_message_sent', `Message type: ${messageData.type}`);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            } else {
                reject(new Error('WebSocket is not open'));
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.connected = false;
        this.clearTimers();

        // Reset UI
        document.getElementById('loginPanel').classList.remove('hidden');
        document.getElementById('chatPanel').classList.add('hidden');
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendBtn').disabled = true;
        document.getElementById('username').value = '';
        document.getElementById('topic').value = '';

        this.showToast('Disconnected from chat', 'info');
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        const connectBtn = document.getElementById('connectBtn');

        if (connected) {
            statusElement.className = 'px-3 py-1 rounded-full text-sm font-medium bg-green-500 text-white connection-indicator connected';
            statusElement.innerHTML = '<i class="fas fa-circle text-xs mr-2"></i>Connected';
            connectBtn.disabled = true;
        } else {
            statusElement.className = 'px-3 py-1 rounded-full text-sm font-medium bg-red-500 text-white connection-indicator';
            statusElement.innerHTML = '<i class="fas fa-circle text-xs mr-2"></i>Disconnected';
            connectBtn.disabled = false;
        }
    }

    updateCharCount(e) {
        const input = e.target;
        const count = input.value.length;
        const charCount = document.getElementById('charCount');
        
        charCount.textContent = `${count} / 5000 characters`;
        
        if (count > 4500) {
            charCount.classList.add('text-yellow-400');
        } else {
            charCount.classList.remove('text-yellow-400');
        }
    }

    refreshTopics() {
        if (!this.connected) return;

        const message = { type: 'list' };
        this.ws.send(JSON.stringify(message));
    }

    async showStats() {
        try {
            const response = await fetch('/stats');
            const stats = await response.json();
            
            const statsContent = document.getElementById('statsContent');
            statsContent.innerHTML = `
                <div class="flex justify-between items-center p-3 bg-gray-800 rounded-lg">
                    <span class="text-gray-300">Total Clients</span>
                    <span class="text-white font-bold">${stats.connections.total_clients}</span>
                </div>
                <div class="flex justify-between items-center p-3 bg-gray-800 rounded-lg">
                    <span class="text-gray-300">Active Topics</span>
                    <span class="text-white font-bold">${stats.connections.total_topics}</span>
                </div>
                <div class="flex justify-between items-center p-3 bg-gray-800 rounded-lg">
                    <span class="text-gray-300">Active Messages</span>
                    <span class="text-white font-bold">${stats.messages.total_messages}</span>
                </div>
                <div class="flex justify-between items-center p-3 bg-gray-800 rounded-lg">
                    <span class="text-gray-300">Server Uptime</span>
                    <span class="text-white font-bold">${Math.floor(stats.timestamp / 60)}m</span>
                </div>
            `;
            
            document.getElementById('statsModal').classList.remove('hidden');
        } catch (error) {
            this.showToast('Failed to load stats', 'error');
        }
    }

    hideStats() {
        document.getElementById('statsModal').classList.add('hidden');
    }

    async runDemo(scenario) {
        console.log(`[DEMO] Running scenario ${scenario}`);
        this.logDemoEvent('scenario_start', `Starting demo scenario ${scenario}`);
        
        // Use the new demo system instead of old functions
        switch (scenario) {
            case '1':
                this.showToast('Multi-User Demo: Use the "Start Full Demo" button above for better visualization', 'info');
                break;
            case '2':
                this.showToast('Topic Isolation Demo: Use the "Start Full Demo" button to see sports vs movies rooms', 'info');
                break;
            case '6':
                this.showToast('Username Uniqueness Demo: Try connecting with same username in multiple tabs', 'info');
                break;
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-600',
            info: 'bg-blue-600'
        };

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        toast.className = `toast ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-2`;
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    loadTheme() {
        // Add theme switching capability
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            document.body.classList.add('dark-theme');
        }
    }

    // Demo Methods
    createRoomWindow(roomId, username, topic) {
        console.log(`[DEMO] Creating room window: ${roomId} for ${username} in ${topic}`);
        this.logDemoEvent('window_create', `Creating room window for ${username} in ${topic}`, roomId);
        
        const roomWindows = document.getElementById('roomWindows');
        const roomDiv = document.createElement('div');
        roomDiv.id = `room-${roomId}`;
        roomDiv.className = 'bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl border border-white border-opacity-20 animate__animated animate__fadeInUp';
        
        roomDiv.innerHTML = `
            <div class="p-4">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-white font-bold">
                        <i class="fas fa-door-open mr-2 text-yellow-400"></i>${topic}
                    </h4>
                    <span class="px-2 py-1 bg-green-600 text-white text-xs rounded-full">
                        ${username}
                    </span>
                </div>
                <div class="bg-black bg-opacity-30 rounded-lg p-3 h-48 overflow-y-auto mb-3">
                    <div id="messages-${roomId}" class="space-y-2 text-sm">
                        <div class="text-gray-400 text-center">Connecting...</div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <div class="flex-1 px-3 py-2 bg-white bg-opacity-20 rounded-lg">
                        <span class="text-gray-300 text-xs">Demo client - auto messaging</span>
                    </div>
                    <button onclick="window.chatClient.closeRoomWindow('${roomId}')" class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
        
        roomWindows.appendChild(roomDiv);
        this.logDemoEvent('window_created', `Room window created successfully`, roomId);
        return roomDiv;
    }

    closeRoomWindow(roomId) {
        console.log(`[DEMO] Closing room window: ${roomId}`);
        this.logDemoEvent('window_close', `Closing room window`, roomId);
        
        const roomDiv = document.getElementById(`room-${roomId}`);
        if (roomDiv) {
            roomDiv.classList.add('animate__animated', 'animate__fadeOutDown');
            setTimeout(() => {
                roomDiv.remove();
                this.demoClients.delete(roomId);
                this.logDemoEvent('window_closed', `Room window closed and removed`, roomId);
            }, 1000);
        }
    }

    addMessageToRoom(roomId, message, isOwn = false) {
        console.log(`[DEMO] Adding message to room ${roomId}: ${message.substring(0, 30)}... (own: ${isOwn})`);
        this.logDemoEvent('message_add', `Adding message to room: ${message.substring(0, 30)}...`, roomId);
        
        const messagesDiv = document.getElementById(`messages-${roomId}`);
        if (!messagesDiv) {
            this.logDemoEvent('message_error', `Room ${roomId} not found for message`, roomId);
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `animate__animated animate__fadeIn ${isOwn ? 'text-right' : 'text-left'}`;
        
        const time = new Date().toLocaleTimeString();
        messageDiv.innerHTML = `
            <div class="inline-block max-w-xs">
                <div class="glass rounded-lg px-3 py-2 ${isOwn ? 'bg-blue-600 bg-opacity-30' : 'bg-purple-600 bg-opacity-30'}">
                    <div class="text-xs text-gray-300 mb-1">${time}</div>
                    <div class="text-white text-sm">${this.escapeHtml(message)}</div>
                </div>
            </div>
        `;
        
        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        this.logDemoEvent('message_added', `Message successfully added to room`, roomId);
    }

    logDemoEvent(eventType, details, roomId = "") {
        // Send demo events to server for logging
        if (this.connected && this.ws) {
            try {
                const demoLogMessage = {
                    type: "demo_log",
                    event_type: eventType,
                    details: details,
                    room_id: roomId,
                    timestamp: Date.now()
                };
                this.ws.send(JSON.stringify(demoLogMessage));
            } catch (error) {
                console.log(`[DEMO] Failed to log event: ${error}`);
            }
        }
        
        // Also log to console for debugging
        console.log(`[DEMO EVENT] ${eventType}: ${details} ${roomId ? `(room: ${roomId})` : ''}`);
    }

    startFullDemo() {
        console.log('[DEMO] startFullDemo called');
        
        if (this.demoRunning) {
            console.log('[DEMO] Demo already running, ignoring start request');
            this.showToast('Demo is already running!', 'warning');
            return;
        }
        
        console.log('[DEMO] Starting full demo sequence');
        this.logDemoEvent('demo_start', 'Starting full demo sequence');
        
        // Clear any existing demo WITHOUT calling stopFullDemo (which sets demoRunning = false)
        this.clearDemoOnly();
        
        this.demoRunning = true; // Set to true AFTER clearing
        this.showToast('Starting full demo...', 'info');
        
        console.log('[DEMO] Creating room windows for demo');
        this.logDemoEvent('demo_setup', 'Creating demo room windows');
        
        // Check if roomWindows container exists
        const roomWindowsContainer = document.getElementById('roomWindows');
        if (!roomWindowsContainer) {
            console.error('[DEMO] Room windows container not found!');
            this.showToast('Demo container not found!', 'error');
            this.demoRunning = false;
            return;
        }
        
        // Create multiple room windows
        try {
            this.createRoomWindow('room1', 'alice', 'sports');
            this.createRoomWindow('room2', 'bob', 'sports');
            this.createRoomWindow('room3', 'charlie', 'movies');
            console.log('[DEMO] All room windows created successfully');
        } catch (error) {
            console.error('[DEMO] Error creating room windows:', error);
            this.showToast('Error creating demo rooms!', 'error');
            this.demoRunning = false;
            return;
        }
        
        console.log('[DEMO] Room windows created, simulating connections');
        this.logDemoEvent('demo_connections', 'Simulating client connections');
        
        // Simulate connections
        setTimeout(() => {
            console.log('[DEMO] Simulating connection messages');
            this.addMessageToRoom('room1', 'Connected to sports topic!', true);
            this.addMessageToRoom('room2', 'Connected to sports topic!', true);
            this.addMessageToRoom('room3', 'Connected to movies topic!', true);
            this.logDemoEvent('demo_connected', 'All demo clients connected');
        }, 1000);
        
        // Start automated messaging with better control
        let messageCount = 0;
        const sportsMessages = [
            'Anyone watching the game tonight?',
            'It\'s going to be epic!',
            'Who do you think will win?',
            'The halftime show was amazing!',
            'Best game I\'ve seen all season!'
        ];
        const moviesMessages = [
            'Just saw the new superhero movie!',
            'The effects were incredible',
            'Who else is excited for the sequel?',
            'The plot twist was unexpected!',
            'Can\'t wait for the next one!'
        ];
        
        console.log('[DEMO] Starting automated messaging sequence');
        this.logDemoEvent('demo_messaging_start', 'Starting automated messaging');
        
        this.demoInterval = setInterval(() => {
            console.log(`[DEMO] Interval check - running: ${this.demoRunning}, count: ${messageCount}`);
            
            if (!this.demoRunning) {
                console.log('[DEMO] Demo stopped, clearing interval');
                clearInterval(this.demoInterval);
                this.demoInterval = null;
                return;
            }
            
            messageCount++;
            console.log(`[DEMO] Message cycle ${messageCount} starting`);
            this.logDemoEvent('demo_message_cycle', `Starting message cycle ${messageCount}`);
            
            // Sports room conversation (alice sends on odd cycles)
            if (messageCount % 2 === 1) {
                const sportsMsg = sportsMessages[Math.floor((messageCount - 1) / 2) % sportsMessages.length];
                console.log(`[DEMO] Alice sending: ${sportsMsg}`);
                this.addMessageToRoom('room1', sportsMsg, true);
                this.logDemoEvent('demo_message_alice', `Alice: ${sportsMsg}`, 'room1');
                
                // Bob responds after a delay
                setTimeout(() => {
                    if (this.demoRunning) {
                        const responses = [
                            'Totally agree!',
                            'No way!',
                            'That\'s what I was thinking!',
                            'You\'re right about that!',
                            'Same here!'
                        ];
                        const response = responses[Math.floor((messageCount - 1) / 2) % responses.length];
                        console.log(`[DEMO] Bob responding: ${response}`);
                        this.addMessageToRoom('room2', response, false);
                        this.logDemoEvent('demo_message_bob', `Bob: ${response}`, 'room2');
                    }
                }, 1500);
            }
            
            // Movies room messages (charlie sends on every 3rd cycle)
            if (messageCount % 3 === 0) {
                const moviesMsg = moviesMessages[Math.floor(messageCount / 3) % moviesMessages.length];
                console.log(`[DEMO] Charlie sending: ${moviesMsg}`);
                this.addMessageToRoom('room3', moviesMsg, true);
                this.logDemoEvent('demo_message_charlie', `Charlie: ${moviesMsg}`, 'room3');
            }
            
            // Stop after 15 messages
            if (messageCount >= 15) {
                console.log('[DEMO] Demo sequence completed, stopping');
                this.logDemoEvent('demo_complete', 'Demo sequence completed successfully');
                this.demoRunning = false; // Don't call stopFullDemo here, let the interval handle it
                this.showToast('Demo completed! Try connecting with multiple browser tabs for real-time testing.', 'success');
            }
        }, 2000); // Further reduced interval for immediate feedback
    }

    stopFullDemo() {
        console.log('[DEMO] stopFullDemo called, current state:', {
            demoRunning: this.demoRunning,
            hasInterval: !!this.demoInterval,
            intervalId: this.demoInterval
        });
        
        this.logDemoEvent('demo_stop', 'Stopping full demo sequence');
        
        this.demoRunning = false;
        if (this.demoInterval) {
            console.log('[DEMO] Clearing interval');
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        } else {
            console.log('[DEMO] No interval to clear');
        }
        
        this.showToast('Demo stopped', 'warning');
        this.logDemoEvent('demo_stopped', 'Demo sequence stopped successfully');
    }

    clearDemoOnly() {
        // Clear demo elements WITHOUT changing demoRunning state
        console.log('[DEMO] Clearing demo elements only');
        
        // Clear interval if exists
        if (this.demoInterval) {
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        }
        
        // Clear room windows
        const roomWindows = document.getElementById('roomWindows');
        if (roomWindows) {
            roomWindows.innerHTML = '';
        }
        
        // Clear demo clients
        this.demoClients.clear();
        
        console.log('[DEMO] Demo elements cleared');
    }

    resetDemo() {
        console.log('[DEMO] Resetting demo environment');
        this.logDemoEvent('demo_reset_start', 'Starting demo reset');
        
        this.stopFullDemo();
        
        const roomWindows = document.getElementById('roomWindows');
        const roomCount = roomWindows.children.length;
        roomWindows.innerHTML = '';
        this.demoClients.clear();
        
        console.log(`[DEMO] Reset complete - cleared ${roomCount} room windows`);
        this.logDemoEvent('demo_reset_complete', `Demo reset complete - cleared ${roomCount} rooms`);
        this.showToast('Demo reset', 'info');
    }
}

// Initialize the chat client when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatClient = new SecureChatClient();
});

// Export for potential use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecureChatClient;
}
