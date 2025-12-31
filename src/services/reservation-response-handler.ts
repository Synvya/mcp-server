/**
 * Reservation Response Handler
 * Tracks pending reservation requests and matches incoming responses with timeouts
 */

import type { Rumor } from '../lib/nip59.js';

/**
 * Pending request tracking entry
 */
interface PendingRequest {
  requestId: string;
  resolve: (rumor: Rumor) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  timestamp: number;
}

/**
 * Options for the response handler
 */
export interface ReservationResponseHandlerOptions {
  /** Default timeout in milliseconds (default: 30000) */
  defaultTimeoutMs?: number;
}

/**
 * ReservationResponseHandler class for tracking requests and matching responses
 */
export class ReservationResponseHandler {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private defaultTimeoutMs: number;

  constructor(options: ReservationResponseHandlerOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs || 30000; // 30 seconds default
  }

  /**
   * Wait for a response to a specific request
   * 
   * @param requestId - The ID of the request rumor (from kind:9901)
   * @param timeoutMs - Optional timeout override (uses default if not provided)
   * @returns Promise that resolves with the response rumor or rejects on timeout
   */
  waitForResponse(requestId: string, timeoutMs?: number): Promise<Rumor> {
    // Check if already waiting for this request
    if (this.pendingRequests.has(requestId)) {
      return Promise.reject(new Error(`Already waiting for response to request ${requestId}`));
    }

    const timeout = timeoutMs || this.defaultTimeoutMs;

    return new Promise<Rumor>((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Timeout waiting for response to request ${requestId} after ${timeout}ms`));
      }, timeout);

      // Store pending request
      const pending: PendingRequest = {
        requestId,
        resolve,
        reject,
        timeoutId,
        timestamp: Date.now(),
      };

      this.pendingRequests.set(requestId, pending);
    });
  }

  /**
   * Handle an incoming rumor (potentially a response)
   * This should be called from the NostrSubscriber onRumor callback
   * 
   * @param rumor - The unwrapped rumor event
   * @returns true if the rumor was a response to a pending request, false otherwise
   */
  handleRumor(rumor: Rumor): boolean {
    // Look for 'e' tag that references the original request
    const eTag = rumor.tags.find(t => t[0] === 'e');
    
    if (!eTag || !eTag[1]) {
      // Not a response (no e tag)
      return false;
    }

    const requestId = eTag[1];
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      // No pending request for this response
      return false;
    }

    // Found a match! Clear timeout and resolve
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);
    pending.resolve(rumor);

    console.log(`Matched response for request ${requestId.substring(0, 8)}... (waited ${Date.now() - pending.timestamp}ms)`);

    return true;
  }

  /**
   * Cancel waiting for a specific request
   * 
   * @param requestId - The request ID to cancel
   * @returns true if the request was pending and cancelled, false otherwise
   */
  cancel(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);
    pending.reject(new Error(`Request ${requestId} was cancelled`));

    return true;
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    const count = this.pendingRequests.size;

    this.pendingRequests.forEach(pending => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('All requests cancelled'));
    });

    this.pendingRequests.clear();

    if (count > 0) {
      console.log(`Cancelled ${count} pending request(s)`);
    }
  }

  /**
   * Get the number of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Get list of pending request IDs
   */
  getPendingRequestIds(): string[] {
    return Array.from(this.pendingRequests.keys());
  }

  /**
   * Check if a specific request is pending
   */
  isPending(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  /**
   * Get the default timeout in milliseconds
   */
  getDefaultTimeout(): number {
    return this.defaultTimeoutMs;
  }
}

