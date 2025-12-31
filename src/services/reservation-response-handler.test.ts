/**
 * Tests for Reservation Response Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { ReservationResponseHandler } from './reservation-response-handler';
import type { Rumor } from '../lib/nip59';

// Store original handler
let originalUnhandledRejection: any;

describe('ReservationResponseHandler', () => {
  let handler: ReservationResponseHandler;

  beforeAll(() => {
    // Suppress unhandled rejection warnings for timeout tests
    originalUnhandledRejection = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
  });

  afterAll(() => {
    // Restore original handlers
    if (originalUnhandledRejection) {
      originalUnhandledRejection.forEach((listener: any) => {
        process.on('unhandledRejection', listener);
      });
    }
  });

  beforeEach(() => {
    vi.useFakeTimers();
    handler = new ReservationResponseHandler();
  });

  afterEach(async () => {
    // Cancel all pending requests to prevent unhandled rejections
    handler?.cancelAll();
    // Run all pending timers to finish any async operations
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.clearAllMocks();
    
    // Give a moment for any remaining async cleanup
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  describe('constructor', () => {
    it('should create handler with default timeout', () => {
      expect(handler.getDefaultTimeout()).toBe(30000); // 30 seconds
    });

    it('should accept custom default timeout', () => {
      const customHandler = new ReservationResponseHandler({ defaultTimeoutMs: 60000 });
      expect(customHandler.getDefaultTimeout()).toBe(60000);
    });
  });

  describe('waitForResponse', () => {
    it('should return a promise', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      expect(promise).toBeInstanceOf(Promise);
      
      // Cleanup
      handler.cancel(requestId);
      await expect(promise).rejects.toThrow();
    });

    it('should track pending request', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      expect(handler.isPending(requestId)).toBe(true);
      expect(handler.getPendingCount()).toBe(1);
      expect(handler.getPendingRequestIds()).toContain(requestId);
      
      handler.cancel(requestId);
      await expect(promise).rejects.toThrow();
    });

    it('should reject if already waiting for same request', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      await expect(() => handler.waitForResponse(requestId)).rejects.toThrow(
        `Already waiting for response to request ${requestId}`
      );
      
      handler.cancel(requestId);
      await expect(promise).rejects.toThrow();
    });

    it('should use default timeout if not specified', async () => {
      const handler = new ReservationResponseHandler({ defaultTimeoutMs: 1000 });
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(1001);
      
      await expect(promise).rejects.toThrow(/Timeout waiting for response/);
    });

    it('should use custom timeout if specified', async () => {
      const handler = new ReservationResponseHandler({ defaultTimeoutMs: 1000 });
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 500);
      
      // Fast-forward to custom timeout
      await vi.advanceTimersByTimeAsync(501);
      
      await expect(promise).rejects.toThrow(/Timeout waiting for response/);
    });

    it('should timeout after specified duration', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 1000);
      
      // Not timed out yet
      await vi.advanceTimersByTimeAsync(999);
      expect(handler.isPending(requestId)).toBe(true);
      
      // Now timeout
      await vi.advanceTimersByTimeAsync(2);
      
      await expect(promise).rejects.toThrow(
        `Timeout waiting for response to request ${requestId} after 1000ms`
      );
      
      // Should no longer be pending
      expect(handler.isPending(requestId)).toBe(false);
    });

    it('should clean up on timeout', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 100);
      
      expect(handler.getPendingCount()).toBe(1);
      
      await vi.advanceTimersByTimeAsync(101);
      
      await expect(promise).rejects.toThrow();
      
      // Should be cleaned up
      expect(handler.getPendingCount()).toBe(0);
      expect(handler.isPending(requestId)).toBe(false);
    });
  });

  describe('handleRumor', () => {
    it('should return false for rumor without e tag', () => {
      const handler = new ReservationResponseHandler();
      
      const rumor: Rumor = {
        kind: 9902,
        content: 'Response',
        tags: [['p', 'pubkey']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      const matched = handler.handleRumor(rumor);
      
      expect(matched).toBe(false);
    });

    it('should return false for rumor with no matching request', () => {
      const handler = new ReservationResponseHandler();
      
      const rumor: Rumor = {
        kind: 9902,
        content: 'Response',
        tags: [
          ['p', 'pubkey'],
          ['e', 'nonexistent-request-id', '', 'root'],
        ],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      const matched = handler.handleRumor(rumor);
      
      expect(matched).toBe(false);
    });

    it('should resolve promise when matching response arrives', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 5000);
      
      // Create matching response
      const responseRumor: Rumor = {
        kind: 9902,
        content: 'Confirmed',
        tags: [
          ['p', 'customer-pubkey'],
          ['e', requestId, '', 'root'],
          ['status', 'confirmed'],
        ],
        pubkey: 'restaurant-pubkey',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      const matched = handler.handleRumor(responseRumor);
      
      expect(matched).toBe(true);
      
      const result = await promise;
      expect(result).toBe(responseRumor);
    });

    it('should clean up after matching response', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 5000);
      
      expect(handler.getPendingCount()).toBe(1);
      
      const responseRumor: Rumor = {
        kind: 9902,
        content: 'Confirmed',
        tags: [['e', requestId, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      handler.handleRumor(responseRumor);
      
      // Should be cleaned up
      expect(handler.getPendingCount()).toBe(0);
      expect(handler.isPending(requestId)).toBe(false);
      
      // Make sure promise resolves
      await promise;
    });

    it('should clear timeout when matching response arrives', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 5000);
      
      const responseRumor: Rumor = {
        kind: 9902,
        content: 'Confirmed',
        tags: [['e', requestId, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      handler.handleRumor(responseRumor);
      
      // Should resolve immediately, not timeout
      const result = await promise;
      expect(result).toBe(responseRumor);
      
      // Advance time - should not timeout now
      await vi.advanceTimersByTimeAsync(6000);
      
      // Promise already resolved, shouldn't throw
    });

    it('should handle multiple pending requests', async () => {
      const handler = new ReservationResponseHandler();
      const requestId1 = 'a'.repeat(64);
      const requestId2 = 'b'.repeat(64);
      const requestId3 = 'c'.repeat(64);
      
      const promise1 = handler.waitForResponse(requestId1, 5000);
      const promise2 = handler.waitForResponse(requestId2, 5000);
      const promise3 = handler.waitForResponse(requestId3, 5000);
      
      expect(handler.getPendingCount()).toBe(3);
      
      // Respond to second request
      const response2: Rumor = {
        kind: 9902,
        content: 'Response 2',
        tags: [['e', requestId2, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'd'.repeat(64),
      };
      
      handler.handleRumor(response2);
      
      expect(handler.getPendingCount()).toBe(2);
      expect(handler.isPending(requestId1)).toBe(true);
      expect(handler.isPending(requestId2)).toBe(false);
      expect(handler.isPending(requestId3)).toBe(true);
      
      const result2 = await promise2;
      expect(result2.content).toBe('Response 2');
      
      // Cleanup
      handler.cancel(requestId1);
      handler.cancel(requestId3);
      await expect(promise1).rejects.toThrow();
      await expect(promise3).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    it('should cancel a pending request', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 5000);
      
      expect(handler.isPending(requestId)).toBe(true);
      
      const cancelled = handler.cancel(requestId);
      
      expect(cancelled).toBe(true);
      expect(handler.isPending(requestId)).toBe(false);
      
      await expect(promise).rejects.toThrow(`Request ${requestId} was cancelled`);
    });

    it('should return false for non-existent request', () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const cancelled = handler.cancel(requestId);
      
      expect(cancelled).toBe(false);
    });

    it('should clear timeout when cancelled', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 1000);
      handler.cancel(requestId);
      
      // Advance past timeout - shouldn't trigger anything
      await vi.advanceTimersByTimeAsync(2000);
      
      expect(handler.isPending(requestId)).toBe(false);
      await expect(promise).rejects.toThrow('was cancelled');
    });
  });

  describe('cancelAll', () => {
    it('should cancel all pending requests', async () => {
      const handler = new ReservationResponseHandler();
      const requestId1 = 'a'.repeat(64);
      const requestId2 = 'b'.repeat(64);
      const requestId3 = 'c'.repeat(64);
      
      const promise1 = handler.waitForResponse(requestId1);
      const promise2 = handler.waitForResponse(requestId2);
      const promise3 = handler.waitForResponse(requestId3);
      
      expect(handler.getPendingCount()).toBe(3);
      
      handler.cancelAll();
      
      expect(handler.getPendingCount()).toBe(0);
      
      await expect(promise1).rejects.toThrow('All requests cancelled');
      await expect(promise2).rejects.toThrow('All requests cancelled');
      await expect(promise3).rejects.toThrow('All requests cancelled');
    });

    it('should do nothing if no pending requests', () => {
      const handler = new ReservationResponseHandler();
      
      handler.cancelAll(); // Should not throw
      
      expect(handler.getPendingCount()).toBe(0);
    });
  });

  describe('getPendingCount', () => {
    it('should return 0 initially', () => {
      const handler = new ReservationResponseHandler();
      expect(handler.getPendingCount()).toBe(0);
    });

    it('should return correct count', async () => {
      const handler = new ReservationResponseHandler();
      
      const promise1 = handler.waitForResponse('a'.repeat(64));
      expect(handler.getPendingCount()).toBe(1);
      
      const promise2 = handler.waitForResponse('b'.repeat(64));
      expect(handler.getPendingCount()).toBe(2);
      
      handler.cancel('a'.repeat(64));
      expect(handler.getPendingCount()).toBe(1);
      
      handler.cancelAll();
      expect(handler.getPendingCount()).toBe(0);
      
      await expect(promise1).rejects.toThrow();
      await expect(promise2).rejects.toThrow();
    });
  });

  describe('getPendingRequestIds', () => {
    it('should return empty array initially', () => {
      const handler = new ReservationResponseHandler();
      expect(handler.getPendingRequestIds()).toEqual([]);
    });

    it('should return all pending request IDs', async () => {
      const handler = new ReservationResponseHandler();
      const requestId1 = 'a'.repeat(64);
      const requestId2 = 'b'.repeat(64);
      
      const promise1 = handler.waitForResponse(requestId1);
      const promise2 = handler.waitForResponse(requestId2);
      
      const ids = handler.getPendingRequestIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain(requestId1);
      expect(ids).toContain(requestId2);
      
      handler.cancelAll();
      await expect(promise1).rejects.toThrow();
      await expect(promise2).rejects.toThrow();
    });
  });

  describe('isPending', () => {
    it('should return false for non-pending request', () => {
      const handler = new ReservationResponseHandler();
      expect(handler.isPending('a'.repeat(64))).toBe(false);
    });

    it('should return true for pending request', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      expect(handler.isPending(requestId)).toBe(true);
      
      handler.cancel(requestId);
      await expect(promise).rejects.toThrow();
    });

    it('should return false after timeout', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 100);
      
      expect(handler.isPending(requestId)).toBe(true);
      
      await vi.advanceTimersByTimeAsync(101);
      await expect(promise).rejects.toThrow();
      
      expect(handler.isPending(requestId)).toBe(false);
    });

    it('should return false after response', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId);
      
      expect(handler.isPending(requestId)).toBe(true);
      
      const response: Rumor = {
        kind: 9902,
        content: 'Response',
        tags: [['e', requestId, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      handler.handleRumor(response);
      await promise;
      
      expect(handler.isPending(requestId)).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should handle race between timeout and response', async () => {
      const handler = new ReservationResponseHandler();
      const requestId = 'a'.repeat(64);
      
      const promise = handler.waitForResponse(requestId, 100);
      
      // Advance most of the way to timeout
      await vi.advanceTimersByTimeAsync(99);
      
      // Send response just before timeout
      const response: Rumor = {
        kind: 9902,
        content: 'Just in time',
        tags: [['e', requestId, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'b'.repeat(64),
      };
      
      handler.handleRumor(response);
      
      // Should resolve with response, not timeout
      const result = await promise;
      expect(result.content).toBe('Just in time');
    });

    it('should handle concurrent requests to different restaurants', async () => {
      const handler = new ReservationResponseHandler();
      
      const request1Id = 'a'.repeat(64);
      const request2Id = 'b'.repeat(64);
      const request3Id = 'c'.repeat(64);
      
      const promise1 = handler.waitForResponse(request1Id);
      const promise2 = handler.waitForResponse(request2Id);
      const promise3 = handler.waitForResponse(request3Id);
      
      // Responses arrive in different order
      const response3: Rumor = {
        kind: 9902,
        content: 'Response 3',
        tags: [['e', request3Id, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'd'.repeat(64),
      };
      
      const response1: Rumor = {
        kind: 9902,
        content: 'Response 1',
        tags: [['e', request1Id, '', 'root']],
        pubkey: 'sender',
        created_at: 123456,
        id: 'e'.repeat(64),
      };
      
      handler.handleRumor(response3);
      handler.handleRumor(response1);
      
      const result1 = await promise1;
      const result3 = await promise3;
      
      expect(result1.content).toBe('Response 1');
      expect(result3.content).toBe('Response 3');
      
      // Second request still pending
      expect(handler.isPending(request2Id)).toBe(true);
      
      handler.cancel(request2Id);
      await expect(promise2).rejects.toThrow();
    });
  });
});

