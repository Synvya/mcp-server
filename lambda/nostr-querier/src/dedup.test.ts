/**
 * Tests for kind 0 (profile) replaceable deduplication per NIP-01.
 */
import { describe, it, expect } from 'vitest';
import { buildEventMap } from './dedup.js';
import type { Event as NostrEvent } from 'nostr-tools';

function mkEvent(overrides: Partial<NostrEvent> & { id: string; pubkey: string; kind: number; created_at: number }): NostrEvent {
  const { id, pubkey, kind, created_at } = overrides;
  return {
    id,
    pubkey,
    kind,
    created_at,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
    sig: overrides.sig ?? 'a'.repeat(128),
  };
}

describe('buildEventMap', () => {
  it('keeps only the latest kind 0 event per pubkey', () => {
    const pubkey = 'pubkey123';
    const events: NostrEvent[] = [
      mkEvent({ id: 'id1', pubkey, kind: 0, created_at: 100 }),
      mkEvent({ id: 'id2', pubkey, kind: 0, created_at: 200 }),
      mkEvent({ id: 'id3', pubkey, kind: 0, created_at: 150 }),
    ];
    const map = buildEventMap(events);
    expect(map.size).toBe(1);
    const entry = map.get(`0:${pubkey}`);
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('id2');
    expect(entry!.created_at).toBe(200);
  });

  it('keeps one kind 0 per different pubkey', () => {
    const events: NostrEvent[] = [
      mkEvent({ id: 'a1', pubkey: 'pub1', kind: 0, created_at: 100 }),
      mkEvent({ id: 'b1', pubkey: 'pub2', kind: 0, created_at: 100 }),
    ];
    const map = buildEventMap(events);
    expect(map.size).toBe(2);
    expect(map.get('0:pub1')!.id).toBe('a1');
    expect(map.get('0:pub2')!.id).toBe('b1');
  });

  it('deduplicates non-kind0 by event id', () => {
    const events: NostrEvent[] = [
      mkEvent({ id: 'e1', pubkey: 'p', kind: 1, created_at: 100 }),
      mkEvent({ id: 'e1', pubkey: 'p', kind: 1, created_at: 200 }),
    ];
    const map = buildEventMap(events);
    expect(map.size).toBe(1);
    expect(map.get('e1')!.created_at).toBe(200);
  });

  it('uses replaceable key 0:pubkey for kind 0 (NIP-01 replaceable)', () => {
    const pubkey = 'abc123';
    const events: NostrEvent[] = [
      mkEvent({ id: 'ev1', pubkey, kind: 0, created_at: 100 }),
    ];
    const map = buildEventMap(events);
    const key = `0:${pubkey}`;
    expect(map.has(key)).toBe(true);
    expect(map.get(key)!.id).toBe('ev1');
  });
});
