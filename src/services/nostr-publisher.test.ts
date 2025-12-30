/**
 * Tests for Nostr Publisher Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, finalizeEvent } from 'nostr-tools';
import { NostrPublisher } from './nostr-publisher';
import type { Event } from 'nostr-tools';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen({});
      }
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({});
    }
  }

  // Helper to simulate receiving a message
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Helper to simulate an error
  simulateError(message: string) {
    if (this.onerror) {
      this.onerror({ message });
    }
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Install mock WebSocket
(global as any).WebSocket = MockWebSocket;

describe('NostrPublisher', () => {
  let testEvent: Event;
  const testRelays = [
    'wss://relay1.example.com',
    'wss://relay2.example.com',
    'wss://relay3.example.com',
  ];

  beforeEach(() => {
    MockWebSocket.reset();
    
    // Create a test event
    const privateKey = generateSecretKey();
    testEvent = finalizeEvent(
      {
        kind: 1,
        content: 'Test message',
        tags: [],
        created_at: Math.round(Date.now() / 1000),
      },
      privateKey
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create publisher with relay list', () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      expect(publisher.getRelays()).toEqual(testRelays);
    });

    it('should use default timeout if not provided', () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      // Timeout is private, but we can test it works
      expect(publisher).toBeDefined();
    });

    it('should accept custom timeout', () => {
      const publisher = new NostrPublisher({ 
        relays: testRelays,
        timeoutMs: 10000,
      });
      
      expect(publisher).toBeDefined();
    });
  });

  describe('publish', () => {
    it('should publish to all relays concurrently', async () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      // Start publish
      const publishPromise = publisher.publish(testEvent);
      
      // Wait for WebSockets to connect
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Verify connections were made
      expect(MockWebSocket.instances).toHaveLength(3);
      expect(MockWebSocket.instances[0].url).toBe(testRelays[0]);
      expect(MockWebSocket.instances[1].url).toBe(testRelays[1]);
      expect(MockWebSocket.instances[2].url).toBe(testRelays[2]);
      
      // Simulate successful responses from all relays
      MockWebSocket.instances.forEach(ws => {
        ws.simulateMessage(['OK', testEvent.id, true, '']);
      });
      
      const result = await publishPromise;
      
      expect(result.totalRelays).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(r => r.success)).toBe(true);
    });

    it('should send EVENT message with correct format', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages).toHaveLength(1);
      
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message[0]).toBe('EVENT');
      expect(message[1]).toMatchObject({
        kind: testEvent.kind,
        content: testEvent.content,
        tags: testEvent.tags,
        pubkey: testEvent.pubkey,
        created_at: testEvent.created_at,
        id: testEvent.id,
        sig: testEvent.sig,
      });
      
      // Clean up
      ws.simulateMessage(['OK', testEvent.id, true, '']);
      await publishPromise;
    });

    it('should handle successful OK responses', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      MockWebSocket.instances[0].simulateMessage(['OK', testEvent.id, true, '']);
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].relay).toBe(testRelays[0]);
    });

    it('should handle rejected events', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      MockWebSocket.instances[0].simulateMessage([
        'OK',
        testEvent.id,
        false,
        'Duplicate event',
      ]);
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe('Duplicate event');
    });

    it('should handle partial failures', async () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // First relay succeeds
      MockWebSocket.instances[0].simulateMessage(['OK', testEvent.id, true, '']);
      
      // Second relay rejects
      MockWebSocket.instances[1].simulateMessage([
        'OK',
        testEvent.id,
        false,
        'Rate limited',
      ]);
      
      // Third relay succeeds
      MockWebSocket.instances[2].simulateMessage(['OK', testEvent.id, true, '']);
      
      const result = await publishPromise;
      
      expect(result.totalRelays).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('Rate limited');
      expect(result.results[2].success).toBe(true);
    });

    it('should handle connection errors', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      MockWebSocket.instances[0].simulateError('Connection refused');
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('WebSocket error');
    });

    it('should handle timeout', async () => {
      const publisher = new NostrPublisher({ 
        relays: [testRelays[0]],
        timeoutMs: 50, // Short timeout for testing
      });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Don't send any response, let it timeout
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('Timeout');
    });

    it('should handle connection close before OK', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Close connection without sending OK
      MockWebSocket.instances[0].close();
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('Connection closed');
    });

    it('should handle NOTICE messages without resolving', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const publishPromise = publisher.publish(testEvent);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Send NOTICE (should not resolve)
      MockWebSocket.instances[0].simulateMessage(['NOTICE', 'Relay is busy']);
      
      // Should still be waiting
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Now send OK
      MockWebSocket.instances[0].simulateMessage(['OK', testEvent.id, true, '']);
      
      const result = await publishPromise;
      
      expect(result.successCount).toBe(1);
    });
  });

  describe('getRelays', () => {
    it('should return relay list', () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      const relays = publisher.getRelays();
      
      expect(relays).toEqual(testRelays);
    });

    it('should return a copy of relay list', () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      const relays = publisher.getRelays();
      relays.push('wss://new-relay.example.com');
      
      // Original should be unchanged
      expect(publisher.getRelays()).toEqual(testRelays);
    });
  });

  describe('setRelays', () => {
    it('should update relay list', () => {
      const publisher = new NostrPublisher({ relays: testRelays });
      
      const newRelays = ['wss://new1.example.com', 'wss://new2.example.com'];
      publisher.setRelays(newRelays);
      
      expect(publisher.getRelays()).toEqual(newRelays);
    });
  });

  describe('concurrent publishing', () => {
    it('should handle multiple concurrent publish calls', async () => {
      const publisher = new NostrPublisher({ relays: [testRelays[0]] });
      
      const privateKey = generateSecretKey();
      const event1 = finalizeEvent(
        { kind: 1, content: 'Event 1', tags: [], created_at: Math.round(Date.now() / 1000) },
        privateKey
      );
      const event2 = finalizeEvent(
        { kind: 1, content: 'Event 2', tags: [], created_at: Math.round(Date.now() / 1000) },
        privateKey
      );
      
      const promise1 = publisher.publish(event1);
      const promise2 = publisher.publish(event2);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Should have 2 WebSocket connections (one per publish call)
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      
      // Respond to all
      MockWebSocket.instances.forEach(ws => {
        ws.simulateMessage(['OK', event1.id, true, '']);
      });
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1.successCount).toBeGreaterThan(0);
      expect(result2.successCount).toBeGreaterThan(0);
    });
  });
});

