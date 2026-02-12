import { describe, it, expect } from 'vitest';
import { aggregateBotVisits } from './dynamo-writer.js';
import { BotVisit, HandleNpubMap } from './types.js';

const handleNpubMap: HandleNpubMap = {
  'india-belly': 'nostr:npub1aaa',
  'coffee-place': 'nostr:npub1bbb',
};

function mkVisit(overrides: Partial<BotVisit> = {}): BotVisit {
  return {
    handle: 'india-belly',
    bot: 'GPTBot',
    uri: '/restaurant/india-belly/index.html',
    timestamp: '2025-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('aggregateBotVisits', () => {
  it('groups visits by handle and bot', () => {
    const visits = [
      mkVisit(),
      mkVisit(),
      mkVisit({ bot: 'ClaudeBot' }),
    ];

    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    expect(summaries).toHaveLength(2);

    const gptSummary = summaries.find((s) => s.bot === 'GPTBot');
    const claudeSummary = summaries.find((s) => s.bot === 'ClaudeBot');

    expect(gptSummary).toBeDefined();
    expect(gptSummary!.visitCount).toBe(2);

    expect(claudeSummary).toBeDefined();
    expect(claudeSummary!.visitCount).toBe(1);
  });

  it('counts visits correctly', () => {
    const visits = [mkVisit(), mkVisit(), mkVisit()];
    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].visitCount).toBe(3);
  });

  it('collects unique pages per group', () => {
    const visits = [
      mkVisit({ uri: '/restaurant/india-belly/index.html' }),
      mkVisit({ uri: '/restaurant/india-belly/menu.html' }),
      mkVisit({ uri: '/restaurant/india-belly/index.html' }), // duplicate
    ];

    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    expect(summaries[0].pages).toHaveLength(2);
    expect(summaries[0].pages).toContain('/restaurant/india-belly/index.html');
    expect(summaries[0].pages).toContain('/restaurant/india-belly/menu.html');
  });

  it('skips visits with unknown handles', () => {
    const visits = [
      mkVisit({ handle: 'unknown-restaurant' }),
      mkVisit(), // known handle
    ];

    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].handle).toBe('india-belly');
  });

  it('maps handles to npubs correctly', () => {
    const visits = [
      mkVisit({ handle: 'india-belly' }),
      mkVisit({ handle: 'coffee-place', uri: '/cafe/coffee-place/index.html' }),
    ];

    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    const indiaSummary = summaries.find((s) => s.handle === 'india-belly');
    const coffeeSummary = summaries.find((s) => s.handle === 'coffee-place');

    expect(indiaSummary!.npub).toBe('nostr:npub1aaa');
    expect(coffeeSummary!.npub).toBe('nostr:npub1bbb');
  });

  it('sets correct dateBotKey format', () => {
    const visits = [mkVisit()];
    const summaries = aggregateBotVisits(visits, handleNpubMap, '2025-01-15');
    expect(summaries[0].dateBotKey).toBe('2025-01-15#GPTBot');
  });

  it('returns empty array for no visits', () => {
    expect(aggregateBotVisits([], handleNpubMap, '2025-01-15')).toEqual([]);
  });

  it('returns empty array when all visits have unknown handles', () => {
    const visits = [mkVisit({ handle: 'unknown' })];
    expect(aggregateBotVisits(visits, handleNpubMap, '2025-01-15')).toEqual([]);
  });
});
