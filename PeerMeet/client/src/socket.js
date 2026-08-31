/**
 * socket.js
 *
 * Singleton Socket.io client instance.
 *
 * Socket.io is used EXCLUSIVELY for WebRTC signaling:
 *   - Forwarding SDP offers/answers between peers
 *   - Forwarding ICE candidates between peers
 *   - Room management events (create, join, leave)
 *
 * NO audio or video data passes through this socket.
 */

import { io } from 'socket.io-client';
import { debugLog } from './utils/debugLog.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5001';

// Create a single shared socket instance for the app lifetime
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  debugLog('[Socket] Connected to signaling server:', socket.id);
});

socket.on('disconnect', (reason) => {
  debugLog('[Socket] Disconnected from signaling server:', reason);
});

socket.on('connect_error', (error) => {
  console.error('[Socket] Connection error:', error.message);
});

export default socket;
