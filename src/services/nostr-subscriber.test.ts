/**
 * Tests for Nostr Subscriber Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NostrSubscriber } from './nostr-subscriber.js';
import { createAndWrapRumor } from '../lib/nip59.js';
import type { Rumor } from '../lib/nip59.js';
import type { Event } from 'nostr-tools';

// Mock WebSocket (reuse from publisher tests)
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
    setTimeout(() => {
      if (this.onclose) {
        this.onclose({});
      }
    }, 10);
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

describe('NostrSubscriber', () => {
  const testRelays = [
    'wss://relay1.example.com',
    'wss://relay2.example.com',
  ];

  let serverPrivateKey: Uint8Array;
  let serverPublicKey: string;
  let customerPrivateKey: Uint8Array;
  let customerPublicKey: string;

  beforeEach(() => {
    MockWebSocket.reset();
    vi.clearAllTimers();
    vi.useFakeTimers();
    
    // Generate test keys
    serverPrivateKey = generateSecretKey();
    serverPublicKey = getPublicKey(serverPrivateKey);
    customerPrivateKey = generateSecretKey();
    customerPublicKey = getPublicKey(customerPrivateKey);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create subscriber with options', () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      expect(subscriber.getRelays()).toEqual(testRelays);
      expect(subscriber.isSubscribing()).toBe(false);
    });

    it('should accept optional error callback', () => {
      const onRumor = vi.fn();
      const onError = vi.fn();
      
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
        onError,
      });

      expect(subscriber).toBeDefined();
    });

    it('should accept custom reconnect delay', () => {
      const onRumor = vi.fn();
      
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
        reconnectDelayMs: 10000,
      });

      expect(subscriber).toBeDefined();
    });
  });

  describe('start', () => {
    it('should connect to all relays', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      expect(subscriber.isSubscribing()).toBe(true);

      // Wait for connections
      await vi.advanceTimersByTimeAsync(20);

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(MockWebSocket.instances[0].url).toBe(testRelays[0]);
      expect(MockWebSocket.instances[1].url).toBe(testRelays[1]);
      
      subscriber.stop();
    });

    it('should send REQ message with correct filter', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1), // Just one relay for simplicity
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      expect(ws.sentMessages.length).toBeGreaterThan(0);
      
      const reqMessage = JSON.parse(ws.sentMessages[0]);
      expect(reqMessage[0]).toBe('REQ');
      expect(reqMessage[1]).toMatch(/^gift-wraps-/); // subscription ID
      expect(reqMessage[2]).toMatchObject({
        kinds: [1059],
        '#p': [serverPublicKey],
      });
      expect(reqMessage[2].since).toBeDefined();
      
      subscriber.stop();
    });

    it('should not start if already active', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);
      
      const initialCount = MockWebSocket.instances.length;
      
      subscriber.start(); // Try to start again
      await vi.advanceTimersByTimeAsync(20);

      // Should not create more connections
      expect(MockWebSocket.instances.length).toBe(initialCount);
      
      subscriber.stop();
    });
  });

  describe('stop', () => {
    it('should close all connections', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws1 = MockWebSocket.instances[0];
      const ws2 = MockWebSocket.instances[1];

      subscriber.stop();
      await vi.advanceTimersByTimeAsync(20);

      expect(subscriber.isSubscribing()).toBe(false);
      expect(ws1.readyState).toBe(3); // CLOSED
      expect(ws2.readyState).toBe(3); // CLOSED
    });

    it('should send CLOSE message before closing', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      const messagesBefore = ws.sentMessages.length;

      subscriber.stop();

      expect(ws.sentMessages.length).toBeGreaterThan(messagesBefore);
      const closeMessage = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(closeMessage[0]).toBe('CLOSE');
    });

    it('should not stop if already stopped', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      subscriber.stop();
      subscriber.stop(); // Try to stop again

      expect(subscriber.isSubscribing()).toBe(false);
    });
  });

  describe('event handling', () => {
    it('should unwrap and call onRumor for valid gift wrap', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      // Create a gift-wrapped rumor
      const testRumor = {
        kind: 9902,
        content: 'Test reservation response',
        tags: [['p', customerPublicKey]],
      };
      
      const giftWrap = createAndWrapRumor(
        testRumor,
        customerPrivateKey,
        serverPublicKey
      );

      // Simulate receiving the gift wrap
      const ws = MockWebSocket.instances[0];
      const subscriptionId = JSON.parse(ws.sentMessages[0])[1];
      ws.simulateMessage(['EVENT', subscriptionId, giftWrap]);

      // Should have called onRumor
      expect(onRumor).toHaveBeenCalledTimes(1);
      const [rumor, receivedGiftWrap] = onRumor.mock.calls[0];
      expect(rumor.kind).toBe(9902);
      expect(rumor.content).toBe('Test reservation response');
      expect(receivedGiftWrap.id).toBe(giftWrap.id);
      
      subscriber.stop();
    });

    it('should handle EOSE message', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      const subscriptionId = JSON.parse(ws.sentMessages[0])[1];
      
      // Should not throw
      ws.simulateMessage(['EOSE', subscriptionId]);
      
      subscriber.stop();
    });

    it('should handle NOTICE message', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      
      // Should not throw
      ws.simulateMessage(['NOTICE', 'Test notice']);
      
      subscriber.stop();
    });

    it('should handle CLOSED message', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      const subscriptionId = JSON.parse(ws.sentMessages[0])[1];
      
      // Should not throw
      ws.simulateMessage(['CLOSED', subscriptionId, 'Subscription closed']);
      
      subscriber.stop();
    });

    it('should ignore non-gift-wrap events', async () => {
      const onRumor = vi.fn();
      const onError = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
        onError,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      const subscriptionId = JSON.parse(ws.sentMessages[0])[1];
      
      // Send a kind:1 event (not a gift wrap)
      ws.simulateMessage(['EVENT', subscriptionId, {
        kind: 1,
        content: 'Regular note',
        tags: [],
        pubkey: customerPublicKey,
        created_at: Math.round(Date.now() / 1000),
        id: 'a'.repeat(64),
        sig: 'b'.repeat(128),
      }]);

      // Should not call onRumor
      expect(onRumor).not.toHaveBeenCalled();
      
      subscriber.stop();
    });

    it('should call onError for failed unwrap', async () => {
      const onRumor = vi.fn();
      const onError = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
        onError,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws = MockWebSocket.instances[0];
      const subscriptionId = JSON.parse(ws.sentMessages[0])[1];
      
      // Create a malformed gift wrap (valid structure but corrupted content)
      const testRumor = {
        kind: 9902,
        content: 'Test',
        tags: [],
      };
      const validGiftWrap = createAndWrapRumor(
        testRumor,
        customerPrivateKey,
        serverPublicKey
      );
      
      // Corrupt the encrypted content to cause decryption failure
      const malformedGiftWrap = {
        ...validGiftWrap,
        content: 'corrupted_encrypted_content_that_will_fail_to_decrypt',
      };

      ws.simulateMessage(['EVENT', subscriptionId, malformedGiftWrap]);

      // Should not call onRumor
      expect(onRumor).not.toHaveBeenCalled();
      // Should call onError
      expect(onError).toHaveBeenCalledTimes(1);
      
      subscriber.stop();
    });
  });

  describe('reconnection', () => {
    it('should reconnect after connection close', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
        reconnectDelayMs: 100,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const ws1 = MockWebSocket.instances[0];
      expect(MockWebSocket.instances).toHaveLength(1);

      // Close the connection
      ws1.close();
      await vi.advanceTimersByTimeAsync(20);

      // Wait for reconnection delay
      await vi.advanceTimersByTimeAsync(100);

      // Should have created a new connection
      expect(MockWebSocket.instances.length).toBeGreaterThan(1);
      
      subscriber.stop();
    });

    it('should not reconnect after intentional stop', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays.slice(0, 1),
        privateKey: serverPrivateKey,
        onRumor,
        reconnectDelayMs: 100,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const initialCount = MockWebSocket.instances.length;

      subscriber.stop();
      await vi.advanceTimersByTimeAsync(200);

      // Should not create new connections
      expect(MockWebSocket.instances.length).toBe(initialCount);
    });
  });

  describe('getConnectionStatus', () => {
    it('should return connection status for all relays', async () => {
      const onRumor = vi.fn();
      const subscriber = new NostrSubscriber({
        relays: testRelays,
        privateKey: serverPrivateKey,
        onRumor,
      });

      subscriber.start();
      await vi.advanceTimersByTimeAsync(20);

      const status = subscriber.getConnectionStatus();
      
      expect(status).toHaveLength(2);
      expect(status[0].relay).toBe(testRelays[0]);
      expect(status[0].connected).toBe(true);
      expect(status[1].relay).toBe(testRelays[1]);
      expect(status[1].connected).toBe(true);
      
      subscriber.stop();
    });
  });
});

