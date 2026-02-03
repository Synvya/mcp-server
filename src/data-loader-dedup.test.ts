/**
 * Tests for kind 0 profile deduplication by pubkey (replaceable per NIP-01).
 */
import { describe, it, expect } from 'vitest';
import { deduplicateKind0ByPubkey, type NostrEvent } from './data-loader.js';

function mkProfile(pubkey: string, created_at: number, id?: string): NostrEvent {
  return {
    kind: 0,
    pubkey,
    created_at,
    id: id ?? `id-${pubkey}-${created_at}`,
    content: '{}',
    tags: [['t', 'foodEstablishment:Restaurant']],
  };
}

describe('deduplicateKind0ByPubkey', () => {
  it('keeps only the latest event per pubkey', () => {
    const events: NostrEvent[] = [
      mkProfile('pub1', 100),
      mkProfile('pub1', 200),
      mkProfile('pub1', 150),
    ];
    const result = deduplicateKind0ByPubkey(events);
    expect(result).toHaveLength(1);
    expect(result[0].created_at).toBe(200);
    expect(result[0].pubkey).toBe('pub1');
  });

  it('returns one event per distinct pubkey', () => {
    const events: NostrEvent[] = [
      mkProfile('pub1', 100),
      mkProfile('pub2', 100),
      mkProfile('pub3', 100),
    ];
    const result = deduplicateKind0ByPubkey(events);
    expect(result).toHaveLength(3);
    const pubkeys = result.map(e => e.pubkey).sort();
    expect(pubkeys).toEqual(['pub1', 'pub2', 'pub3']);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateKind0ByPubkey([])).toEqual([]);
  });
});
