/**
 * NIP-RP: Reservation Protocol Event Builders
 * https://github.com/Synvya/reservation-protocol
 * 
 * Implements builders for kind:9901 and kind:9902 reservation events
 * as unsigned rumors (per NIP-59).
 */

import type { UnsignedEvent } from 'nostr-tools';
import type { Rumor } from './nip59.js';

/**
 * Status values for reservation responses
 */
export type ReservationStatus = 'confirmed' | 'declined' | 'cancelled';

/**
 * Parameters for building a reservation request (kind:9901)
 */
export interface ReservationRequestParams {
  /** Business public key (recipient) */
  restaurantPubkey: string;
  
  /** Number of people in the reservation (1-20) */
  partySize: number;
  
  /** Reservation start time (Unix timestamp in seconds) */
  time: number;
  
  /** Time zone (IANA Time Zone Database identifier, e.g., "America/Costa_Rica") */
  tzid: string;
  
  /** Reservation holder name (max 200 chars) */
  name: string;
  
  /** Email ('mailto:' URI per RFC 6068) - one of email/telephone required */
  email?: string;
  
  /** Telephone ('tel:' URI per RFC 3966) - one of email/telephone required */
  telephone?: string;
  
  /** Duration of reservation in seconds (optional) */
  duration?: number;
  
  /** Earliest acceptable start time (Unix timestamp in seconds, optional) */
  earliestTime?: number;
  
  /** Latest acceptable start time (Unix timestamp in seconds, optional) */
  latestTime?: number;
  
  /** Set to 'True' if the party initiating is not the reservation holder (optional) */
  broker?: 'True' | 'False';
  
  /** Plain text reservation request message */
  content: string;
  
  /** Recommended relay URL (optional) */
  relayUrl?: string;
}

/**
 * Parameters for building a reservation response (kind:9902)
 */
export interface ReservationResponseParams {
  /** Recipient public key */
  recipientPubkey: string;
  
  /** Original reservation request rumor ID (from kind:9901) */
  originalRequestId: string;
  
  /** Status: confirmed, declined, or cancelled */
  status: ReservationStatus;
  
  /** Reservation start time (Unix timestamp in seconds) */
  time: number;
  
  /** Time zone (IANA Time Zone Database identifier) */
  tzid: string;
  
  /** Duration of reservation in seconds */
  duration: number;
  
  /** Plain text reservation response message */
  content: string;
  
  /** Recommended relay URL (optional) */
  relayUrl?: string;
}

/**
 * Build a reservation request rumor (kind:9901)
 * 
 * This creates an unsigned event (rumor) that should be sealed and gift-wrapped
 * using NIP-59 functions before publishing.
 * 
 * @param params - Reservation request parameters
 * @returns Partial unsigned event (rumor) ready to be wrapped
 * @throws Error if validation fails
 */
export function buildReservationRequest(
  params: ReservationRequestParams
): Partial<UnsignedEvent> {
  // Validate party size
  if (params.partySize < 1 || params.partySize > 20) {
    throw new Error('party_size must be between 1 and 20');
  }
  
  // Validate that at least one contact method is provided
  if (!params.email && !params.telephone) {
    throw new Error('Either email or telephone must be provided');
  }
  
  // Validate email format (must be mailto: URI)
  if (params.email && !params.email.startsWith('mailto:')) {
    throw new Error('email must be a mailto: URI per RFC 6068 (e.g., "mailto:user@example.com")');
  }
  
  // Validate telephone format (must be tel: URI)
  if (params.telephone && !params.telephone.startsWith('tel:')) {
    throw new Error('telephone must be a tel: URI per RFC 3966 (e.g., "tel:+1-555-123-4567")');
  }
  
  // Validate name length
  if (params.name && params.name.length > 200) {
    throw new Error('name must be 200 characters or less');
  }
  
  // Build tags array
  const tags: string[][] = [
    ['p', params.restaurantPubkey, ...(params.relayUrl ? [params.relayUrl] : [])],
    ['party_size', params.partySize.toString()],
    ['time', params.time.toString()],
    ['tzid', params.tzid],
    ['name', params.name],
  ];
  
  // Add optional contact information
  if (params.telephone) {
    tags.push(['telephone', params.telephone]);
  }
  if (params.email) {
    tags.push(['email', params.email]);
  }
  
  // Add optional tags
  if (params.duration !== undefined) {
    tags.push(['duration', params.duration.toString()]);
  }
  if (params.earliestTime !== undefined) {
    tags.push(['earliest_time', params.earliestTime.toString()]);
  }
  if (params.latestTime !== undefined) {
    tags.push(['latest_time', params.latestTime.toString()]);
  }
  if (params.broker !== undefined) {
    tags.push(['broker', params.broker]);
  }
  
  return {
    kind: 9901,
    tags,
    content: params.content,
    created_at: Math.round(Date.now() / 1000),
  };
}

/**
 * Build a reservation response rumor (kind:9902)
 * 
 * This creates an unsigned event (rumor) that should be sealed and gift-wrapped
 * using NIP-59 functions before publishing.
 * 
 * @param params - Reservation response parameters
 * @returns Partial unsigned event (rumor) ready to be wrapped
 * @throws Error if validation fails
 */
export function buildReservationResponse(
  params: ReservationResponseParams
): Partial<UnsignedEvent> {
  // Validate status
  const validStatuses: ReservationStatus[] = ['confirmed', 'declined', 'cancelled'];
  if (!validStatuses.includes(params.status)) {
    throw new Error(`status must be one of: ${validStatuses.join(', ')}`);
  }
  
  // Validate original request ID format
  if (!/^[a-f0-9]{64}$/.test(params.originalRequestId)) {
    throw new Error('originalRequestId must be a 64-character lowercase hex string');
  }
  
  // Build tags array
  const tags: string[][] = [
    ['p', params.recipientPubkey, ...(params.relayUrl ? [params.relayUrl] : [])],
    ['e', params.originalRequestId, '', 'root'], // Connects to reservation thread
    ['status', params.status],
    ['time', params.time.toString()],
    ['tzid', params.tzid],
    ['duration', params.duration.toString()],
  ];
  
  return {
    kind: 9902,
    tags,
    content: params.content,
    created_at: Math.round(Date.now() / 1000),
  };
}

/**
 * Helper to validate a rumor has the expected structure
 * Useful for testing and debugging
 */
export function validateReservationRequestRumor(rumor: Rumor): void {
  if (rumor.kind !== 9901) {
    throw new Error(`Expected kind 9901, got ${rumor.kind}`);
  }
  
  const requiredTags = ['p', 'party_size', 'time', 'tzid', 'name'];
  for (const tagName of requiredTags) {
    const tag = rumor.tags.find(t => t[0] === tagName);
    if (!tag) {
      throw new Error(`Missing required tag: ${tagName}`);
    }
  }
  
  // Validate at least one contact method
  const hasEmail = rumor.tags.some(t => t[0] === 'email');
  const hasTelephone = rumor.tags.some(t => t[0] === 'telephone');
  if (!hasEmail && !hasTelephone) {
    throw new Error('Rumor must include either email or telephone tag');
  }
}

/**
 * Helper to validate a response rumor has the expected structure
 * Useful for testing and debugging
 */
export function validateReservationResponseRumor(rumor: Rumor): void {
  if (rumor.kind !== 9902) {
    throw new Error(`Expected kind 9902, got ${rumor.kind}`);
  }
  
  const requiredTags = ['p', 'e', 'status', 'time', 'tzid', 'duration'];
  for (const tagName of requiredTags) {
    const tag = rumor.tags.find(t => t[0] === tagName);
    if (!tag) {
      throw new Error(`Missing required tag: ${tagName}`);
    }
  }
  
  // Validate e tag format (must have 4 elements with 'root' marker)
  const eTag = rumor.tags.find(t => t[0] === 'e');
  if (!eTag || eTag.length !== 4 || eTag[3] !== 'root') {
    throw new Error('e tag must have format: ["e", "<rumor-id>", "", "root"]');
  }
}

