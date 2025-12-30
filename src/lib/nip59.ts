/**
 * NIP-59: Gift Wrap Protocol
 * https://github.com/nostr-protocol/nips/blob/master/59.md
 * 
 * Implements the three-layer encryption system for Nostr events:
 * 1. Rumor: Unsigned event containing the actual content
 * 2. Seal (kind:13): Encrypted rumor, signed by the real author
 * 3. Gift Wrap (kind:1059): Encrypted seal, signed with ephemeral key
 */

import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey, getEventHash, generateSecretKey, finalizeEvent, nip44 } from 'nostr-tools';
import type { EventTemplate, UnsignedEvent, Event } from 'nostr-tools';

/**
 * A rumor is an unsigned event with an ID (for reference)
 */
export type Rumor = UnsignedEvent & { id: string };

/**
 * Two days in seconds - used for timestamp randomization
 */
const TWO_DAYS = 2 * 24 * 60 * 60;

/**
 * Get current Unix timestamp in seconds
 */
const now = (): number => Math.round(Date.now() / 1000);

/**
 * Get a randomized timestamp within the past 2 days
 * Per NIP-59: timestamps should be tweaked to thwart time-analysis attacks
 */
const randomNow = (): number => Math.round(now() - (Math.random() * TWO_DAYS));

/**
 * Get NIP-44 conversation key for encryption between two parties
 */
const nip44ConversationKey = (privateKey: Uint8Array, publicKey: string): Uint8Array => {
  return nip44.v2.utils.getConversationKey(privateKey, publicKey);
};

/**
 * Encrypt data using NIP-44 v2
 */
const nip44Encrypt = (
  data: EventTemplate | Rumor | Event,
  privateKey: Uint8Array,
  publicKey: string
): string => {
  return nip44.v2.encrypt(JSON.stringify(data), nip44ConversationKey(privateKey, publicKey));
};

/**
 * Decrypt data using NIP-44 v2
 */
const nip44Decrypt = (
  encryptedContent: string,
  privateKey: Uint8Array,
  senderPublicKey: string
): any => {
  const conversationKey = nip44.v2.utils.getConversationKey(privateKey, senderPublicKey);
  return JSON.parse(nip44.v2.decrypt(encryptedContent, conversationKey));
};

/**
 * Create a rumor from an event template
 * A rumor is an unsigned event - it has an ID but no signature
 * 
 * @param event - Partial event (kind, content, tags, etc.)
 * @param privateKey - Author's private key (used to set pubkey)
 * @returns Rumor with id but no signature
 */
export function createRumor(
  event: Partial<UnsignedEvent>,
  privateKey: Uint8Array
): Rumor {
  const rumor: any = {
    created_at: now(),
    content: '',
    tags: [],
    ...event,
    pubkey: getPublicKey(privateKey),
  };

  // Calculate ID for the rumor (but don't sign it)
  rumor.id = getEventHash(rumor);

  return rumor as Rumor;
}

/**
 * Seal a rumor in a kind:13 event
 * The seal is encrypted to the recipient and signed by the author
 * 
 * @param rumor - The unsigned rumor to seal
 * @param senderPrivateKey - Author's private key (for signing)
 * @param recipientPublicKey - Recipient's public key (for encryption)
 * @returns Signed kind:13 seal event with encrypted rumor
 */
export function sealRumor(
  rumor: Rumor,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string
): Event {
  return finalizeEvent(
    {
      kind: 13,
      content: nip44Encrypt(rumor, senderPrivateKey, recipientPublicKey),
      created_at: randomNow(), // Randomized timestamp for privacy
      tags: [], // Tags MUST be empty per NIP-59
    },
    senderPrivateKey
  ) as Event;
}

/**
 * Wrap a seal in a kind:1059 gift wrap event
 * The gift wrap uses an ephemeral key for metadata obscurity
 * 
 * @param seal - The kind:13 seal to wrap
 * @param recipientPublicKey - Recipient's public key
 * @returns Signed kind:1059 gift wrap with ephemeral key
 */
export function wrapSeal(
  seal: Event,
  recipientPublicKey: string
): Event {
  // Generate a random, one-time-use ephemeral key
  const ephemeralKey = generateSecretKey();

  return finalizeEvent(
    {
      kind: 1059,
      content: nip44Encrypt(seal, ephemeralKey, recipientPublicKey),
      created_at: randomNow(), // Randomized timestamp for privacy
      tags: [['p', recipientPublicKey]], // Only the recipient p-tag
    },
    ephemeralKey
  ) as Event;
}

/**
 * Unwrap a gift wrap to extract the sealed event
 * 
 * @param giftWrap - The kind:1059 gift wrap event
 * @param recipientPrivateKey - Recipient's private key for decryption
 * @returns The decrypted kind:13 seal
 */
export function unwrapGift(
  giftWrap: Event,
  recipientPrivateKey: Uint8Array
): Event {
  if (giftWrap.kind !== 1059) {
    throw new Error(`Expected kind 1059, got ${giftWrap.kind}`);
  }

  return nip44Decrypt(giftWrap.content, recipientPrivateKey, giftWrap.pubkey);
}

/**
 * Unseal a seal to extract the rumor
 * 
 * @param seal - The kind:13 seal event
 * @param recipientPrivateKey - Recipient's private key for decryption
 * @returns The decrypted rumor
 */
export function unsealRumor(
  seal: Event,
  recipientPrivateKey: Uint8Array
): Rumor {
  if (seal.kind !== 13) {
    throw new Error(`Expected kind 13, got ${seal.kind}`);
  }

  return nip44Decrypt(seal.content, recipientPrivateKey, seal.pubkey);
}

/**
 * All-in-one helper: Create rumor, seal it, and wrap it
 * This is the most common operation for sending gift-wrapped events
 * 
 * @param event - Partial event to send
 * @param senderPrivateKey - Sender's private key
 * @param recipientPublicKey - Recipient's public key
 * @returns Gift-wrapped event ready to publish
 */
export function createAndWrapRumor(
  event: Partial<UnsignedEvent>,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string
): Event {
  const rumor = createRumor(event, senderPrivateKey);
  const seal = sealRumor(rumor, senderPrivateKey, recipientPublicKey);
  const giftWrap = wrapSeal(seal, recipientPublicKey);
  
  return giftWrap;
}

/**
 * All-in-one helper: Unwrap gift and unseal to get rumor
 * This is the most common operation for receiving gift-wrapped events
 * 
 * @param giftWrap - The kind:1059 gift wrap
 * @param recipientPrivateKey - Recipient's private key
 * @returns The original rumor
 */
export function unwrapAndUnseal(
  giftWrap: Event,
  recipientPrivateKey: Uint8Array
): Rumor {
  const seal = unwrapGift(giftWrap, recipientPrivateKey);
  const rumor = unsealRumor(seal, recipientPrivateKey);
  
  return rumor;
}

