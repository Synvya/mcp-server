/**
 * Tests for NIP-RP Event Builders
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { createRumor } from './nip59.js';
import {
  buildReservationRequest,
  buildReservationResponse,
  validateReservationRequestRumor,
  validateReservationResponseRumor,
  type ReservationRequestParams,
  type ReservationResponseParams,
} from './nip-rp.js';

describe('NIP-RP Event Builders', () => {
  // Generate test keys
  const customerPrivateKey = generateSecretKey();
  const customerPublicKey = getPublicKey(customerPrivateKey);
  const restaurantPrivateKey = generateSecretKey();
  const restaurantPublicKey = getPublicKey(restaurantPrivateKey);

  describe('buildReservationRequest', () => {
    const baseParams: ReservationRequestParams = {
      restaurantPubkey: restaurantPublicKey,
      partySize: 4,
      time: 1736112000, // 2025-01-05 19:00:00 UTC
      tzid: 'America/Costa_Rica',
      name: 'John Doe',
      email: 'mailto:john@example.com',
      content: 'Table for 4, please!',
    };

    it('should build a valid kind:9901 event with required fields', () => {
      const event = buildReservationRequest(baseParams);

      expect(event.kind).toBe(9901);
      expect(event.content).toBe('Table for 4, please!');
      expect(event.created_at).toBeDefined();
      expect(event.tags).toBeDefined();
    });

    it('should include all required tags', () => {
      const event = buildReservationRequest(baseParams);
      const tagNames = event.tags!.map(t => t[0]);

      expect(tagNames).toContain('p');
      expect(tagNames).toContain('party_size');
      expect(tagNames).toContain('time');
      expect(tagNames).toContain('tzid');
      expect(tagNames).toContain('name');
      expect(tagNames).toContain('email');
    });

    it('should format p tag correctly with restaurant pubkey', () => {
      const event = buildReservationRequest(baseParams);
      const pTag = event.tags!.find(t => t[0] === 'p');

      expect(pTag).toEqual(['p', restaurantPublicKey]);
    });

    it('should format p tag with relay URL if provided', () => {
      const paramsWithRelay = {
        ...baseParams,
        relayUrl: 'wss://relay.damus.io',
      };
      const event = buildReservationRequest(paramsWithRelay);
      const pTag = event.tags!.find(t => t[0] === 'p');

      expect(pTag).toEqual(['p', restaurantPublicKey, 'wss://relay.damus.io']);
    });

    it('should format party_size tag as string', () => {
      const event = buildReservationRequest(baseParams);
      const partySizeTag = event.tags!.find(t => t[0] === 'party_size');

      expect(partySizeTag).toEqual(['party_size', '4']);
    });

    it('should format time tag as string', () => {
      const event = buildReservationRequest(baseParams);
      const timeTag = event.tags!.find(t => t[0] === 'time');

      expect(timeTag).toEqual(['time', '1736112000']);
    });

    it('should include tzid tag', () => {
      const event = buildReservationRequest(baseParams);
      const tzidTag = event.tags!.find(t => t[0] === 'tzid');

      expect(tzidTag).toEqual(['tzid', 'America/Costa_Rica']);
    });

    it('should include name tag', () => {
      const event = buildReservationRequest(baseParams);
      const nameTag = event.tags!.find(t => t[0] === 'name');

      expect(nameTag).toEqual(['name', 'John Doe']);
    });

    it('should accept email as contact method', () => {
      const event = buildReservationRequest(baseParams);
      const emailTag = event.tags!.find(t => t[0] === 'email');

      expect(emailTag).toEqual(['email', 'mailto:john@example.com']);
    });

    it('should accept telephone as contact method', () => {
      const paramsWithPhone: ReservationRequestParams = {
        ...baseParams,
        email: undefined,
        telephone: 'tel:+1-555-123-4567',
      };
      const event = buildReservationRequest(paramsWithPhone);
      const telephoneTag = event.tags!.find(t => t[0] === 'telephone');

      expect(telephoneTag).toEqual(['telephone', 'tel:+1-555-123-4567']);
    });

    it('should accept both email and telephone', () => {
      const paramsWithBoth: ReservationRequestParams = {
        ...baseParams,
        telephone: 'tel:+1-555-123-4567',
      };
      const event = buildReservationRequest(paramsWithBoth);
      
      const emailTag = event.tags!.find(t => t[0] === 'email');
      const telephoneTag = event.tags!.find(t => t[0] === 'telephone');

      expect(emailTag).toEqual(['email', 'mailto:john@example.com']);
      expect(telephoneTag).toEqual(['telephone', 'tel:+1-555-123-4567']);
    });

    it('should include optional duration tag', () => {
      const paramsWithDuration = {
        ...baseParams,
        duration: 7200, // 2 hours
      };
      const event = buildReservationRequest(paramsWithDuration);
      const durationTag = event.tags!.find(t => t[0] === 'duration');

      expect(durationTag).toEqual(['duration', '7200']);
    });

    it('should include optional earliest_time tag', () => {
      const paramsWithEarliest = {
        ...baseParams,
        earliestTime: 1736109600,
      };
      const event = buildReservationRequest(paramsWithEarliest);
      const earliestTag = event.tags!.find(t => t[0] === 'earliest_time');

      expect(earliestTag).toEqual(['earliest_time', '1736109600']);
    });

    it('should include optional latest_time tag', () => {
      const paramsWithLatest = {
        ...baseParams,
        latestTime: 1736118000,
      };
      const event = buildReservationRequest(paramsWithLatest);
      const latestTag = event.tags!.find(t => t[0] === 'latest_time');

      expect(latestTag).toEqual(['latest_time', '1736118000']);
    });

    it('should include optional broker tag', () => {
      const paramsWithBroker = {
        ...baseParams,
        broker: 'True' as const,
      };
      const event = buildReservationRequest(paramsWithBroker);
      const brokerTag = event.tags!.find(t => t[0] === 'broker');

      expect(brokerTag).toEqual(['broker', 'True']);
    });

    it('should throw error for party_size < 1', () => {
      const invalidParams = { ...baseParams, partySize: 0 };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'party_size must be between 1 and 20'
      );
    });

    it('should throw error for party_size > 20', () => {
      const invalidParams = { ...baseParams, partySize: 21 };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'party_size must be between 1 and 20'
      );
    });

    it('should throw error if neither email nor telephone provided', () => {
      const invalidParams = {
        ...baseParams,
        email: undefined,
        telephone: undefined,
      };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'Either email or telephone must be provided'
      );
    });

    it('should throw error for invalid email format (missing mailto:)', () => {
      const invalidParams = {
        ...baseParams,
        email: 'john@example.com',
      };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'email must be a mailto: URI per RFC 6068'
      );
    });

    it('should throw error for invalid telephone format (missing tel:)', () => {
      const invalidParams = {
        ...baseParams,
        email: undefined,
        telephone: '+1-555-123-4567',
      };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'telephone must be a tel: URI per RFC 3966'
      );
    });

    it('should throw error for name > 200 characters', () => {
      const invalidParams = {
        ...baseParams,
        name: 'a'.repeat(201),
      };
      expect(() => buildReservationRequest(invalidParams)).toThrow(
        'name must be 200 characters or less'
      );
    });

    it('should work with createRumor to produce valid rumor', () => {
      const event = buildReservationRequest(baseParams);
      const rumor = createRumor(event, customerPrivateKey);

      expect(rumor.kind).toBe(9901);
      expect(rumor.id).toMatch(/^[a-f0-9]{64}$/);
      expect(rumor.pubkey).toBe(customerPublicKey);
      expect((rumor as any).sig).toBeUndefined();
    });
  });

  describe('buildReservationResponse', () => {
    const originalRequestId = 'a'.repeat(64); // Mock request ID
    
    const baseParams: ReservationResponseParams = {
      recipientPubkey: customerPublicKey,
      originalRequestId,
      status: 'confirmed',
      time: 1736112000,
      tzid: 'America/Costa_Rica',
      duration: 7200,
      content: 'Reservation confirmed for 4 people at 7:00 PM',
    };

    it('should build a valid kind:9902 event with required fields', () => {
      const event = buildReservationResponse(baseParams);

      expect(event.kind).toBe(9902);
      expect(event.content).toBe('Reservation confirmed for 4 people at 7:00 PM');
      expect(event.created_at).toBeDefined();
      expect(event.tags).toBeDefined();
    });

    it('should include all required tags', () => {
      const event = buildReservationResponse(baseParams);
      const tagNames = event.tags!.map(t => t[0]);

      expect(tagNames).toContain('p');
      expect(tagNames).toContain('e');
      expect(tagNames).toContain('status');
      expect(tagNames).toContain('time');
      expect(tagNames).toContain('tzid');
      expect(tagNames).toContain('duration');
    });

    it('should format p tag correctly', () => {
      const event = buildReservationResponse(baseParams);
      const pTag = event.tags!.find(t => t[0] === 'p');

      expect(pTag).toEqual(['p', customerPublicKey]);
    });

    it('should format p tag with relay URL if provided', () => {
      const paramsWithRelay = {
        ...baseParams,
        relayUrl: 'wss://relay.damus.io',
      };
      const event = buildReservationResponse(paramsWithRelay);
      const pTag = event.tags!.find(t => t[0] === 'p');

      expect(pTag).toEqual(['p', customerPublicKey, 'wss://relay.damus.io']);
    });

    it('should format e tag with root marker', () => {
      const event = buildReservationResponse(baseParams);
      const eTag = event.tags!.find(t => t[0] === 'e');

      expect(eTag).toEqual(['e', originalRequestId, '', 'root']);
    });

    it('should accept status: confirmed', () => {
      const event = buildReservationResponse({ ...baseParams, status: 'confirmed' });
      const statusTag = event.tags!.find(t => t[0] === 'status');

      expect(statusTag).toEqual(['status', 'confirmed']);
    });

    it('should accept status: declined', () => {
      const event = buildReservationResponse({ ...baseParams, status: 'declined' });
      const statusTag = event.tags!.find(t => t[0] === 'status');

      expect(statusTag).toEqual(['status', 'declined']);
    });

    it('should accept status: cancelled', () => {
      const event = buildReservationResponse({ ...baseParams, status: 'cancelled' });
      const statusTag = event.tags!.find(t => t[0] === 'status');

      expect(statusTag).toEqual(['status', 'cancelled']);
    });

    it('should format time tag as string', () => {
      const event = buildReservationResponse(baseParams);
      const timeTag = event.tags!.find(t => t[0] === 'time');

      expect(timeTag).toEqual(['time', '1736112000']);
    });

    it('should include tzid tag', () => {
      const event = buildReservationResponse(baseParams);
      const tzidTag = event.tags!.find(t => t[0] === 'tzid');

      expect(tzidTag).toEqual(['tzid', 'America/Costa_Rica']);
    });

    it('should format duration tag as string', () => {
      const event = buildReservationResponse(baseParams);
      const durationTag = event.tags!.find(t => t[0] === 'duration');

      expect(durationTag).toEqual(['duration', '7200']);
    });

    it('should throw error for invalid status', () => {
      const invalidParams = {
        ...baseParams,
        status: 'pending' as any,
      };
      expect(() => buildReservationResponse(invalidParams)).toThrow(
        'status must be one of: confirmed, declined, cancelled'
      );
    });

    it('should throw error for invalid originalRequestId format', () => {
      const invalidParams = {
        ...baseParams,
        originalRequestId: 'not-a-valid-id',
      };
      expect(() => buildReservationResponse(invalidParams)).toThrow(
        'originalRequestId must be a 64-character lowercase hex string'
      );
    });

    it('should work with createRumor to produce valid rumor', () => {
      const event = buildReservationResponse(baseParams);
      const rumor = createRumor(event, restaurantPrivateKey);

      expect(rumor.kind).toBe(9902);
      expect(rumor.id).toMatch(/^[a-f0-9]{64}$/);
      expect(rumor.pubkey).toBe(restaurantPublicKey);
      expect((rumor as any).sig).toBeUndefined();
    });
  });

  describe('validateReservationRequestRumor', () => {
    it('should validate a correct request rumor', () => {
      const event = buildReservationRequest({
        restaurantPubkey: restaurantPublicKey,
        partySize: 4,
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        name: 'John Doe',
        email: 'mailto:john@example.com',
        content: 'Table for 4',
      });
      const rumor = createRumor(event, customerPrivateKey);

      expect(() => validateReservationRequestRumor(rumor)).not.toThrow();
    });

    it('should throw error for wrong kind', () => {
      const event = buildReservationRequest({
        restaurantPubkey: restaurantPublicKey,
        partySize: 4,
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        name: 'John Doe',
        email: 'mailto:john@example.com',
        content: 'Test',
      });
      const rumor = createRumor({ ...event, kind: 1 }, customerPrivateKey);

      expect(() => validateReservationRequestRumor(rumor)).toThrow(
        'Expected kind 9901, got 1'
      );
    });

    it('should throw error for missing required tags', () => {
      const event = buildReservationRequest({
        restaurantPubkey: restaurantPublicKey,
        partySize: 4,
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        name: 'John Doe',
        email: 'mailto:john@example.com',
        content: 'Test',
      });
      // Remove name tag
      event.tags = event.tags!.filter(t => t[0] !== 'name');
      const rumor = createRumor(event, customerPrivateKey);

      expect(() => validateReservationRequestRumor(rumor)).toThrow(
        'Missing required tag: name'
      );
    });

    it('should throw error if no contact method provided', () => {
      const event = buildReservationRequest({
        restaurantPubkey: restaurantPublicKey,
        partySize: 4,
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        name: 'John Doe',
        email: 'mailto:john@example.com',
        content: 'Test',
      });
      // Remove email tag
      event.tags = event.tags!.filter(t => t[0] !== 'email' && t[0] !== 'telephone');
      const rumor = createRumor(event, customerPrivateKey);

      expect(() => validateReservationRequestRumor(rumor)).toThrow(
        'Rumor must include either email or telephone tag'
      );
    });
  });

  describe('validateReservationResponseRumor', () => {
    const originalRequestId = 'a'.repeat(64);

    it('should validate a correct response rumor', () => {
      const event = buildReservationResponse({
        recipientPubkey: customerPublicKey,
        originalRequestId,
        status: 'confirmed',
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        duration: 7200,
        content: 'Confirmed',
      });
      const rumor = createRumor(event, restaurantPrivateKey);

      expect(() => validateReservationResponseRumor(rumor)).not.toThrow();
    });

    it('should throw error for wrong kind', () => {
      const event = buildReservationResponse({
        recipientPubkey: customerPublicKey,
        originalRequestId,
        status: 'confirmed',
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        duration: 7200,
        content: 'Test',
      });
      const rumor = createRumor({ ...event, kind: 1 }, restaurantPrivateKey);

      expect(() => validateReservationResponseRumor(rumor)).toThrow(
        'Expected kind 9902, got 1'
      );
    });

    it('should throw error for missing required tags', () => {
      const event = buildReservationResponse({
        recipientPubkey: customerPublicKey,
        originalRequestId,
        status: 'confirmed',
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        duration: 7200,
        content: 'Test',
      });
      // Remove duration tag
      event.tags = event.tags!.filter(t => t[0] !== 'duration');
      const rumor = createRumor(event, restaurantPrivateKey);

      expect(() => validateReservationResponseRumor(rumor)).toThrow(
        'Missing required tag: duration'
      );
    });

    it('should throw error for invalid e tag format', () => {
      const event = buildReservationResponse({
        recipientPubkey: customerPublicKey,
        originalRequestId,
        status: 'confirmed',
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        duration: 7200,
        content: 'Test',
      });
      // Replace e tag with incorrect format
      event.tags = event.tags!.filter(t => t[0] !== 'e');
      event.tags!.push(['e', originalRequestId]); // Missing empty string and 'root'
      const rumor = createRumor(event, restaurantPrivateKey);

      expect(() => validateReservationResponseRumor(rumor)).toThrow(
        'e tag must have format: ["e", "<rumor-id>", "", "root"]'
      );
    });
  });

  describe('Integration: Full reservation flow', () => {
    it('should create request and response that link together', () => {
      // Customer creates request
      const requestEvent = buildReservationRequest({
        restaurantPubkey: restaurantPublicKey,
        partySize: 4,
        time: 1736112000,
        tzid: 'America/Costa_Rica',
        name: 'John Doe',
        email: 'mailto:john@example.com',
        content: 'Table for 4, please!',
      });
      const requestRumor = createRumor(requestEvent, customerPrivateKey);

      // Restaurant creates response referencing request
      const responseEvent = buildReservationResponse({
        recipientPubkey: customerPublicKey,
        originalRequestId: requestRumor.id,
        status: 'confirmed',
        time: parseInt(requestRumor.tags.find(t => t[0] === 'time')![1], 10),
        tzid: requestRumor.tags.find(t => t[0] === 'tzid')![1],
        duration: 7200,
        content: 'Reservation confirmed!',
      });
      const responseRumor = createRumor(responseEvent, restaurantPrivateKey);

      // Verify linkage
      const responseETag = responseRumor.tags.find(t => t[0] === 'e');
      expect(responseETag![1]).toBe(requestRumor.id);
      expect(responseETag![3]).toBe('root');

      // Validate both
      expect(() => validateReservationRequestRumor(requestRumor)).not.toThrow();
      expect(() => validateReservationResponseRumor(responseRumor)).not.toThrow();
    });
  });
});

