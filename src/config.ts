/**
 * Configuration for Nostr integration
 */

/**
 * MCP server's Nostr private key (nsec format)
 * This key is used to sign events and decrypt incoming gift wraps
 */
export const MCP_SERVER_NSEC = process.env.MCP_SERVER_NSEC;

/**
 * Nostr relays to publish and subscribe to
 * Comma-separated list of WebSocket URLs
 * Default: wss://relay.damus.io,wss://nos.lol
 */
export const NOSTR_RELAYS = (
  process.env.NOSTR_RELAYS || 
  'wss://relay.damus.io,wss://nos.lol'
).split(',').map(relay => relay.trim());

/**
 * Timeout for waiting for reservation responses (milliseconds)
 * Default: 90000 (90 seconds)
 */
export const RESERVATION_TIMEOUT_MS = 
  parseInt(process.env.RESERVATION_TIMEOUT_MS || '90000', 10);

/**
 * Validate that required configuration is present
 * @throws Error if required configuration is missing
 */
export function validateNostrConfig(): void {
  if (!MCP_SERVER_NSEC) {
    throw new Error(
      'MCP_SERVER_NSEC environment variable is required. ' +
      'Generate a Nostr key pair and set the private key (nsec format). ' +
      'You can generate keys at: https://nostrkeygen.com/'
    );
  }

  if (!MCP_SERVER_NSEC.startsWith('nsec1')) {
    throw new Error(
      'MCP_SERVER_NSEC must be in nsec format (starting with "nsec1"). ' +
      'Convert hex keys using nostr-tools or https://nostrkeygen.com/'
    );
  }

  if (NOSTR_RELAYS.length === 0) {
    throw new Error('At least one Nostr relay must be configured in NOSTR_RELAYS');
  }

  if (RESERVATION_TIMEOUT_MS < 1000 || RESERVATION_TIMEOUT_MS > 120000) {
    throw new Error(
      'RESERVATION_TIMEOUT_MS must be between 1000 and 120000 milliseconds'
    );
  }
}

