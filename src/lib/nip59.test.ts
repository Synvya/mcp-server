/**
 * Tests for NIP-59 Gift Wrap Protocol
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  createRumor,
  sealRumor,
  wrapSeal,
  unwrapGift,
  unsealRumor,
  createAndWrapRumor,
  unwrapAndUnseal,
  type Rumor,
} from './nip59.js';

describe('NIP-59 Gift Wrap Protocol', () => {
  // Generate test keys
  const senderPrivateKey = generateSecretKey();
  const senderPublicKey = getPublicKey(senderPrivateKey);
  const recipientPrivateKey = generateSecretKey();
  const recipientPublicKey = getPublicKey(recipientPrivateKey);

  describe('createRumor', () => {
    it('should create an unsigned event with id', () => {
      const rumor = createRumor(
        {
          kind: 1,
          content: 'Hello, World!',
          tags: [['t', 'test']],
        },
        senderPrivateKey
      );

      expect(rumor.kind).toBe(1);
      expect(rumor.content).toBe('Hello, World!');
      expect(rumor.tags).toEqual([['t', 'test']]);
      expect(rumor.pubkey).toBe(senderPublicKey);
      expect(rumor.id).toBeDefined();
      expect(rumor.id).toMatch(/^[0-9a-f]{64}$/); // Valid hex ID
      expect((rumor as any).sig).toBeUndefined(); // No signature
    });

    it('should use current timestamp if not provided', () => {
      const now = Math.round(Date.now() / 1000);
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);

      expect(rumor.created_at).toBeGreaterThanOrEqual(now - 1);
      expect(rumor.created_at).toBeLessThanOrEqual(now + 1);
    });

    it('should accept custom timestamp', () => {
      const customTimestamp = 1234567890;
      const rumor = createRumor(
        { kind: 1, content: 'Test', created_at: customTimestamp },
        senderPrivateKey
      );

      expect(rumor.created_at).toBe(customTimestamp);
    });

    it('should default to empty content and tags', () => {
      const rumor = createRumor({ kind: 1 }, senderPrivateKey);

      expect(rumor.content).toBe('');
      expect(rumor.tags).toEqual([]);
    });
  });

  describe('sealRumor', () => {
    it('should create a kind:13 seal with encrypted content', () => {
      const rumor = createRumor({ kind: 1, content: 'Secret message' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);

      expect(seal.kind).toBe(13);
      expect(seal.pubkey).toBe(senderPublicKey);
      expect(seal.content).toBeDefined();
      expect(seal.content).not.toContain('Secret message'); // Encrypted
      expect(seal.tags).toEqual([]); // Must be empty per NIP-59
      expect(seal.sig).toBeDefined();
      expect(seal.id).toBeDefined();
    });

    it('should use randomized timestamp within past 2 days', () => {
      const now = Math.round(Date.now() / 1000);
      const twoDaysAgo = now - (2 * 24 * 60 * 60);
      
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);

      expect(seal.created_at).toBeGreaterThanOrEqual(twoDaysAgo);
      expect(seal.created_at).toBeLessThanOrEqual(now);
    });

    it('should produce different seals for same rumor (randomized timestamp)', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal1 = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const seal2 = sealRumor(rumor, senderPrivateKey, recipientPublicKey);

      // Different timestamps and IDs due to randomization
      expect(seal1.created_at).not.toBe(seal2.created_at);
      expect(seal1.id).not.toBe(seal2.id);
    });
  });

  describe('wrapSeal', () => {
    it('should create a kind:1059 gift wrap with ephemeral key', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const giftWrap = wrapSeal(seal, recipientPublicKey);

      expect(giftWrap.kind).toBe(1059);
      expect(giftWrap.pubkey).not.toBe(senderPublicKey); // Ephemeral key
      expect(giftWrap.content).toBeDefined();
      expect(giftWrap.tags).toEqual([['p', recipientPublicKey]]);
      expect(giftWrap.sig).toBeDefined();
      expect(giftWrap.id).toBeDefined();
    });

    it('should use different ephemeral keys each time', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const wrap1 = wrapSeal(seal, recipientPublicKey);
      const wrap2 = wrapSeal(seal, recipientPublicKey);

      expect(wrap1.pubkey).not.toBe(wrap2.pubkey); // Different ephemeral keys
    });

    it('should use randomized timestamp', () => {
      const now = Math.round(Date.now() / 1000);
      const twoDaysAgo = now - (2 * 24 * 60 * 60);
      
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const giftWrap = wrapSeal(seal, recipientPublicKey);

      expect(giftWrap.created_at).toBeGreaterThanOrEqual(twoDaysAgo);
      expect(giftWrap.created_at).toBeLessThanOrEqual(now);
    });
  });

  describe('unwrapGift', () => {
    it('should decrypt gift wrap to extract seal', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const giftWrap = wrapSeal(seal, recipientPublicKey);

      const unwrappedSeal = unwrapGift(giftWrap, recipientPrivateKey);

      expect(unwrappedSeal.kind).toBe(13);
      expect(unwrappedSeal.pubkey).toBe(senderPublicKey);
      expect(unwrappedSeal.id).toBe(seal.id);
    });

    it('should throw error for non-1059 events', () => {
      const fakeEvent: any = {
        kind: 1,
        content: 'Not a gift wrap',
        pubkey: senderPublicKey,
      };

      expect(() => unwrapGift(fakeEvent, recipientPrivateKey)).toThrow(
        'Expected kind 1059, got 1'
      );
    });

    it('should throw error with wrong private key', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const giftWrap = wrapSeal(seal, recipientPublicKey);

      const wrongKey = generateSecretKey();

      expect(() => unwrapGift(giftWrap, wrongKey)).toThrow();
    });
  });

  describe('unsealRumor', () => {
    it('should decrypt seal to extract rumor', () => {
      const originalContent = 'Secret message!';
      const rumor = createRumor({ kind: 1, content: originalContent }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);

      const unsealedRumor = unsealRumor(seal, recipientPrivateKey);

      expect(unsealedRumor.kind).toBe(1);
      expect(unsealedRumor.content).toBe(originalContent);
      expect(unsealedRumor.pubkey).toBe(senderPublicKey);
      expect(unsealedRumor.id).toBe(rumor.id);
    });

    it('should throw error for non-13 events', () => {
      const fakeEvent: any = {
        kind: 1,
        content: 'Not a seal',
        pubkey: senderPublicKey,
      };

      expect(() => unsealRumor(fakeEvent, recipientPrivateKey)).toThrow(
        'Expected kind 13, got 1'
      );
    });

    it('should throw error with wrong private key', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);

      const wrongKey = generateSecretKey();

      expect(() => unsealRumor(seal, wrongKey)).toThrow();
    });
  });

  describe('Full roundtrip: createAndWrapRumor + unwrapAndUnseal', () => {
    it('should successfully wrap and unwrap a message', () => {
      const originalEvent = {
        kind: 1,
        content: 'Are you going to the party tonight?',
        tags: [['t', 'party']],
      };

      // Sender creates and wraps
      const giftWrap = createAndWrapRumor(
        originalEvent,
        senderPrivateKey,
        recipientPublicKey
      );

      // Verify gift wrap structure
      expect(giftWrap.kind).toBe(1059);
      expect(giftWrap.tags).toEqual([['p', recipientPublicKey]]);
      expect(giftWrap.pubkey).not.toBe(senderPublicKey); // Ephemeral key

      // Recipient unwraps and unseals
      const recoveredRumor = unwrapAndUnseal(giftWrap, recipientPrivateKey);

      // Verify recovered content
      expect(recoveredRumor.kind).toBe(originalEvent.kind);
      expect(recoveredRumor.content).toBe(originalEvent.content);
      expect(recoveredRumor.tags).toEqual(originalEvent.tags);
      expect(recoveredRumor.pubkey).toBe(senderPublicKey);
    });

    it('should handle complex events with multiple tags', () => {
      const complexEvent = {
        kind: 9901, // Reservation request
        content: JSON.stringify({
          partySize: 4,
          time: '2025-01-05T19:00:00Z',
        }),
        tags: [
          ['p', recipientPublicKey],
          ['time', '2025-01-05T19:00:00Z'],
          ['party_size', '4'],
          ['name', 'John Doe'],
          ['email', 'john@example.com'],
        ],
      };

      const giftWrap = createAndWrapRumor(
        complexEvent,
        senderPrivateKey,
        recipientPublicKey
      );
      const recovered = unwrapAndUnseal(giftWrap, recipientPrivateKey);

      expect(recovered).toMatchObject({
        kind: complexEvent.kind,
        content: complexEvent.content,
        tags: complexEvent.tags,
        pubkey: senderPublicKey,
      });
    });

    it('should fail with wrong recipient key', () => {
      const giftWrap = createAndWrapRumor(
        { kind: 1, content: 'Secret' },
        senderPrivateKey,
        recipientPublicKey
      );

      const wrongKey = generateSecretKey();

      expect(() => unwrapAndUnseal(giftWrap, wrongKey)).toThrow();
    });
  });

  describe('Test vector from NIP-59 spec', () => {
    it('should match the example from NIP-59', () => {
      // Keys from NIP-59 example
      const senderNsec = 'nsec1p0ht6p3wepe47sjrgesyn4m50m6avk2waqudu9rl324cg2c4ufesyp6rdg';
      const recipientNsec = 'nsec1uyyrnx7cgfp40fcskcr2urqnzekc20fj0er6de0q8qvhx34ahazsvs9p36';

      const senderKey = nip19.decode(senderNsec).data as Uint8Array;
      const recipientKey = nip19.decode(recipientNsec).data as Uint8Array;
      const recipientPub = getPublicKey(recipientKey);

      const originalEvent = {
        kind: 1,
        content: 'Are you going to the party tonight?',
      };

      // Create and wrap
      const giftWrap = createAndWrapRumor(originalEvent, senderKey, recipientPub);

      // Verify structure matches spec
      expect(giftWrap.kind).toBe(1059);
      expect(giftWrap.tags).toEqual([['p', recipientPub]]);

      // Recipient should be able to unwrap
      const recovered = unwrapAndUnseal(giftWrap, recipientKey);

      expect(recovered.kind).toBe(1);
      expect(recovered.content).toBe('Are you going to the party tonight?');
      expect(recovered.pubkey).toBe(getPublicKey(senderKey));
    });
  });

  describe('Privacy and metadata obscurity', () => {
    it('should not leak sender identity in gift wrap', () => {
      const giftWrap = createAndWrapRumor(
        { kind: 1, content: 'Private message' },
        senderPrivateKey,
        recipientPublicKey
      );

      // Gift wrap should NOT contain sender's pubkey
      expect(giftWrap.pubkey).not.toBe(senderPublicKey);
      // Content should be encrypted
      expect(giftWrap.content).not.toContain('Private message');
      expect(giftWrap.content).not.toContain(senderPublicKey);
    });

    it('should use different timestamps for privacy', () => {
      const rumor = createRumor({ kind: 1, content: 'Test' }, senderPrivateKey);
      const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
      const giftWrap = wrapSeal(seal, recipientPublicKey);

      // All three should have different timestamps
      expect(rumor.created_at).not.toBe(seal.created_at);
      expect(seal.created_at).not.toBe(giftWrap.created_at);
      expect(rumor.created_at).not.toBe(giftWrap.created_at);
    });
  });
});

