/**
 * Nostr Subscriber Service
 * Handles subscribing to kind:1059 gift wrap events and unwrapping them
 */

import type { Event } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools';
import { unwrapAndUnseal, type Rumor } from '../lib/nip59.js';

/**
 * Callback function type for handling unwrapped rumors
 */
export type RumorCallback = (rumor: Rumor, giftWrap: Event) => void;

/**
 * Options for the Nostr subscriber
 */
export interface NostrSubscriberOptions {
  /** Relay URLs to subscribe to */
  relays: string[];
  
  /** MCP server's private key for unwrapping gift wraps */
  privateKey: Uint8Array;
  
  /** Callback function called when a rumor is successfully unwrapped */
  onRumor: RumorCallback;
  
  /** Optional callback for subscription errors */
  onError?: (error: Error, relay: string) => void;
  
  /** Reconnection delay in milliseconds (default: 5000) */
  reconnectDelayMs?: number;
}

/**
 * Subscription state for a single relay
 */
interface RelaySubscription {
  relay: string;
  ws: WebSocket | null;
  subscriptionId: string;
  reconnectTimeout: NodeJS.Timeout | null;
  isIntentionallyClosed: boolean;
}

/**
 * NostrSubscriber class for subscribing to gift-wrapped events
 */
export class NostrSubscriber {
  private relays: string[];
  private privateKey: Uint8Array;
  private publicKey: string;
  private onRumor: RumorCallback;
  private onError?: (error: Error, relay: string) => void;
  private reconnectDelayMs: number;
  private subscriptions: Map<string, RelaySubscription> = new Map();
  private isActive: boolean = false;

  constructor(options: NostrSubscriberOptions) {
    this.relays = options.relays;
    this.privateKey = options.privateKey;
    this.publicKey = getPublicKey(this.privateKey);
    this.onRumor = options.onRumor;
    this.onError = options.onError;
    this.reconnectDelayMs = options.reconnectDelayMs || 5000;
  }

  /**
   * Start subscribing to gift wraps on all configured relays
   */
  start(): void {
    if (this.isActive) {
      console.log('Subscriber already active');
      return;
    }

    this.isActive = true;
    console.log(`Starting subscriber for ${this.publicKey.substring(0, 8)}... on ${this.relays.length} relays`);

    this.relays.forEach(relay => {
      this.connectToRelay(relay);
    });
  }

  /**
   * Stop subscribing and close all connections
   */
  stop(): void {
    if (!this.isActive) {
      console.log('Subscriber already stopped');
      return;
    }

    this.isActive = false;
    console.log('Stopping subscriber...');

    // Close all connections
    this.subscriptions.forEach(sub => {
      sub.isIntentionallyClosed = true;
      
      if (sub.reconnectTimeout) {
        clearTimeout(sub.reconnectTimeout);
        sub.reconnectTimeout = null;
      }
      
      if (sub.ws) {
        try {
          // Send CLOSE message before closing WebSocket
          sub.ws.send(JSON.stringify(['CLOSE', sub.subscriptionId]));
          sub.ws.close();
        } catch (e) {
          // Ignore close errors
        }
        sub.ws = null;
      }
    });

    this.subscriptions.clear();
    console.log('Subscriber stopped');
  }

  /**
   * Connect to a relay and subscribe to gift wraps
   */
  private connectToRelay(relayUrl: string): void {
    // Generate unique subscription ID
    const subscriptionId = `gift-wraps-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const subscription: RelaySubscription = {
      relay: relayUrl,
      ws: null,
      subscriptionId,
      reconnectTimeout: null,
      isIntentionallyClosed: false,
    };

    this.subscriptions.set(relayUrl, subscription);

    try {
      console.log(`Connecting to ${relayUrl}...`);
      const ws = new WebSocket(relayUrl);
      subscription.ws = ws;

      ws.onopen = () => {
        console.log(`Connected to ${relayUrl}`);
        
        // Subscribe to kind:1059 gift wraps addressed to this server
        // Note: No 'since' filter because NIP-59 randomizes timestamps for privacy
        // Filter: { kinds: [1059], "#p": [serverPubkey] }
        const filter = {
          kinds: [1059],
          '#p': [this.publicKey],
        };

        const reqMessage = JSON.stringify(['REQ', subscriptionId, filter]);
        ws.send(reqMessage);
        console.log(`Subscribed to gift wraps on ${relayUrl}`);
      };

      ws.onmessage = (msg) => {
        this.handleMessage(relayUrl, msg.data.toString());
      };

      ws.onerror = (error: any) => {
        console.error(`WebSocket error on ${relayUrl}:`, error.message || 'Unknown error');
        if (this.onError) {
          this.onError(
            new Error(error.message || 'WebSocket error'),
            relayUrl
          );
        }
      };

      ws.onclose = () => {
        console.log(`Disconnected from ${relayUrl}`);
        subscription.ws = null;

        // Reconnect if not intentionally closed and subscriber is still active
        if (!subscription.isIntentionallyClosed && this.isActive) {
          console.log(`Reconnecting to ${relayUrl} in ${this.reconnectDelayMs}ms...`);
          subscription.reconnectTimeout = setTimeout(() => {
            if (this.isActive) {
              this.connectToRelay(relayUrl);
            }
          }, this.reconnectDelayMs);
        }
      };
    } catch (error) {
      console.error(`Failed to connect to ${relayUrl}:`, error);
      if (this.onError) {
        this.onError(
          error instanceof Error ? error : new Error('Connection failed'),
          relayUrl
        );
      }

      // Retry connection
      if (!subscription.isIntentionallyClosed && this.isActive) {
        subscription.reconnectTimeout = setTimeout(() => {
          if (this.isActive) {
            this.connectToRelay(relayUrl);
          }
        }, this.reconnectDelayMs);
      }
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(relayUrl: string, data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle EVENT message: ["EVENT", <subscription_id>, <event>]
      if (Array.isArray(message) && message[0] === 'EVENT') {
        const [, , event] = message;
        this.handleEvent(event as Event, relayUrl);
      }
      // Handle EOSE (End of Stored Events): ["EOSE", <subscription_id>]
      else if (Array.isArray(message) && message[0] === 'EOSE') {
        console.log(`EOSE received from ${relayUrl}`);
      }
      // Handle NOTICE: ["NOTICE", <message>]
      else if (Array.isArray(message) && message[0] === 'NOTICE') {
        console.log(`Notice from ${relayUrl}: ${message[1]}`);
      }
      // Handle CLOSED: ["CLOSED", <subscription_id>, <message>]
      else if (Array.isArray(message) && message[0] === 'CLOSED') {
        console.warn(`Subscription closed by ${relayUrl}: ${message[2]}`);
      }
    } catch (error) {
      console.error(`Failed to parse message from ${relayUrl}:`, error);
    }
  }

  /**
   * Handle a gift wrap event
   */
  private handleEvent(giftWrap: Event, relayUrl: string): void {
    console.log(`📨 Received event from ${relayUrl}: kind:${giftWrap.kind}, id: ${giftWrap.id.substring(0, 8)}...`);
    
    // Verify it's a kind:1059 gift wrap
    if (giftWrap.kind !== 1059) {
      console.warn(`   ⚠️  Not a gift wrap (kind ${giftWrap.kind})`);
      return;
    }

    // Verify it's addressed to this server
    const pTag = giftWrap.tags.find(t => t[0] === 'p');
    if (!pTag) {
      console.warn(`   ⚠️  Gift wrap has no p-tag`);
      return;
    }
    
    console.log(`   Addressed to: ${pTag[1].substring(0, 8)}...`);
    console.log(`   Server pubkey: ${this.publicKey.substring(0, 8)}...`);
    
    if (pTag[1] !== this.publicKey) {
      console.warn(`   ⚠️  Gift wrap not addressed to this server`);
      return;
    }

    console.log(`   ✅ Gift wrap is for this server, attempting to decrypt...`);

    try {
      // Unwrap and unseal the gift wrap
      const rumor = unwrapAndUnseal(giftWrap, this.privateKey);
      
      console.log(`   ✅ Decrypted successfully: kind:${rumor.kind} rumor from ${rumor.pubkey.substring(0, 8)}...`);
      
      // Call the callback with the unwrapped rumor
      this.onRumor(rumor, giftWrap);
    } catch (error) {
      console.error(`   ❌ Failed to unwrap gift wrap:`, error);
      if (this.onError) {
        this.onError(
          error instanceof Error ? error : new Error('Failed to unwrap'),
          relayUrl
        );
      }
    }
  }

  /**
   * Get the list of configured relays
   */
  getRelays(): string[] {
    return [...this.relays];
  }

  /**
   * Check if subscriber is active
   */
  isSubscribing(): boolean {
    return this.isActive;
  }

  /**
   * Get connection status for all relays
   */
  getConnectionStatus(): { relay: string; connected: boolean }[] {
    return this.relays.map(relay => {
      const sub = this.subscriptions.get(relay);
      return {
        relay,
        connected: sub?.ws?.readyState === 1, // 1 = OPEN
      };
    });
  }
}

