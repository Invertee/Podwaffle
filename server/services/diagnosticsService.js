'use strict';

const { randomUUID } = require('crypto');
const MAX_EVENTS = 250;

class DiagnosticsService {
  constructor() {
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.clients = new Map();
  }

  record(type, data = {}) {
    const event = {
      at: new Date().toISOString(),
      type: String(type || 'event'),
      ...data,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const details = Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' ');
    console.log(`[session] ${event.type}${details ? ` ${details}` : ''}`);
    return event;
  }

  connect(clientId, data = {}) {
    const id = String(clientId || `socket-${randomUUID()}`);
    this.clients.set(id, {
      clientId: id,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      transport: 'websocket',
      ...data,
    });
    return id;
  }

  identify(socketId, data = {}) {
    const existing = this.clients.get(socketId) || { clientId: socketId };
    this.clients.set(socketId, { ...existing, ...data, lastSeenAt: new Date().toISOString() });
  }

  touch(socketId) {
    const existing = this.clients.get(socketId);
    if (existing) existing.lastSeenAt = new Date().toISOString();
  }

  disconnect(socketId, data = {}) {
    const existing = this.clients.get(socketId);
    if (existing) this.record('client-disconnected', { ...existing, ...data });
    this.clients.delete(socketId);
  }

  snapshot(extra = {}) {
    return {
      startedAt: this.startedAt,
      clients: [...this.clients.values()],
      events: this.events.slice(-100).reverse(),
      ...extra,
    };
  }
}

module.exports = new DiagnosticsService();
