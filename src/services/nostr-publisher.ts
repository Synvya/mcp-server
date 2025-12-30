/**
 * Nostr Publisher Service
 * Handles publishing Nostr events to multiple relays concurrently
 */

import type { Event } from 'nostr-tools';

/**
 * Result of publishing to a single relay
 */
export interface RelayPublishResult {
  relay: string;
  success: boolean;
  error?: string;
}

/**
 * Result of publishing to multiple relays
 */
export interface PublishResult {
  totalRelays: number;
  successCount: number;
  failureCount: number;
  results: RelayPublishResult[];
}

/**
 * Options for the Nostr publisher
 */
export interface NostrPublisherOptions {
  /** Relay URLs to publish to */
  relays: string[];
  
  /** Timeout for each relay connection (milliseconds) */
  timeoutMs?: number;
}

/**
 * NostrPublisher class for publishing events to multiple relays
 */
export class NostrPublisher {
  private relays: string[];
  private timeoutMs: number;

  constructor(options: NostrPublisherOptions) {
    this.relays = options.relays;
    this.timeoutMs = options.timeoutMs || 5000; // Default 5 second timeout
  }

  /**
   * Publish an event to all configured relays concurrently
   * 
   * @param event - The Nostr event to publish
   * @returns Promise with publish results for each relay
   */
  async publish(event: Event): Promise<PublishResult> {
    console.log(`Publishing event ${event.id?.substring(0, 8)}... to ${this.relays.length} relays`);

    // Publish to all relays concurrently
    const publishPromises = this.relays.map(relay => 
      this.publishToRelay(relay, event)
    );

    const results = await Promise.all(publishPromises);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`Published to ${successCount}/${this.relays.length} relays successfully`);
    
    if (failureCount > 0) {
      console.warn(`Failed to publish to ${failureCount} relays`);
      results.filter(r => !r.success).forEach(r => {
        console.warn(`  - ${r.relay}: ${r.error}`);
      });
    }

    return {
      totalRelays: this.relays.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Publish an event to a single relay using WebSocket
   * 
   * @param relayUrl - The relay WebSocket URL
   * @param event - The Nostr event to publish
   * @returns Promise with publish result
   */
  private async publishToRelay(
    relayUrl: string,
    event: Event
  ): Promise<RelayPublishResult> {
    return new Promise((resolve) => {
      let ws: WebSocket | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (ws) {
          try {
            ws.close();
          } catch (e) {
            // Ignore close errors
          }
          ws = null;
        }
      };

      const resolveOnce = (result: RelayPublishResult) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      // Set timeout
      timeoutId = setTimeout(() => {
        resolveOnce({
          relay: relayUrl,
          success: false,
          error: `Timeout after ${this.timeoutMs}ms`,
        });
      }, this.timeoutMs);

      try {
        // Create WebSocket connection
        ws = new WebSocket(relayUrl);

        ws.onopen = () => {
          if (!ws) return;
          
          // Send EVENT message: ["EVENT", <event>]
          const message = JSON.stringify(['EVENT', event]);
          ws.send(message);
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data.toString());
            
            // Handle OK response: ["OK", <event_id>, <true|false>, <message>]
            if (Array.isArray(data) && data[0] === 'OK') {
              const [, eventId, accepted, message] = data;
              
              if (accepted) {
                resolveOnce({
                  relay: relayUrl,
                  success: true,
                });
              } else {
                resolveOnce({
                  relay: relayUrl,
                  success: false,
                  error: message || 'Relay rejected event',
                });
              }
            }
            // Handle NOTICE message: ["NOTICE", <message>]
            else if (Array.isArray(data) && data[0] === 'NOTICE') {
              // Don't resolve on NOTICE, just log it
              console.log(`Notice from ${relayUrl}: ${data[1]}`);
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        ws.onerror = (error) => {
          resolveOnce({
            relay: relayUrl,
            success: false,
            error: `WebSocket error: ${error.message || 'Unknown error'}`,
          });
        };

        ws.onclose = () => {
          // If we haven't resolved yet, consider it a failure
          resolveOnce({
            relay: relayUrl,
            success: false,
            error: 'Connection closed before receiving OK response',
          });
        };
      } catch (error) {
        resolveOnce({
          relay: relayUrl,
          success: false,
          error: `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    });
  }

  /**
   * Get the list of configured relays
   */
  getRelays(): string[] {
    return [...this.relays];
  }

  /**
   * Update the list of relays
   */
  setRelays(relays: string[]): void {
    this.relays = relays;
  }
}

