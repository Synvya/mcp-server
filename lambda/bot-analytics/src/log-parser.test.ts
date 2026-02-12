import { describe, it, expect } from 'vitest';
import {
  parseFieldsHeader,
  parseLogLine,
  identifyBot,
  extractHandleFromUri,
  parseLogFile,
} from './log-parser.js';

const SAMPLE_FIELDS_HEADER =
  '#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) cs-uri-query';

function buildFieldMap() {
  return parseFieldsHeader(SAMPLE_FIELDS_HEADER)!;
}

function mkLogLine(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    date: '2025-01-15',
    time: '10:30:00',
    'x-edge-location': 'IAD79-C3',
    'sc-bytes': '1234',
    'c-ip': '1.2.3.4',
    'cs-method': 'GET',
    'cs(Host)': 'synvya.com',
    'cs-uri-stem': '/restaurant/india-belly/index.html',
    'sc-status': '200',
    'cs(Referer)': '-',
    'cs(User-Agent)': 'Mozilla/5.0%20(compatible;%20GPTBot/1.0)',
    'cs-uri-query': '-',
  };
  const merged = { ...defaults, ...overrides };
  // Fields order matches SAMPLE_FIELDS_HEADER
  return [
    merged['date'],
    merged['time'],
    merged['x-edge-location'],
    merged['sc-bytes'],
    merged['c-ip'],
    merged['cs-method'],
    merged['cs(Host)'],
    merged['cs-uri-stem'],
    merged['sc-status'],
    merged['cs(Referer)'],
    merged['cs(User-Agent)'],
    merged['cs-uri-query'],
  ].join('\t');
}

describe('parseFieldsHeader', () => {
  it('parses a valid #Fields header into index map', () => {
    const map = parseFieldsHeader(SAMPLE_FIELDS_HEADER);
    expect(map).not.toBeNull();
    expect(map!['date']).toBe(0);
    expect(map!['time']).toBe(1);
    expect(map!['cs-uri-stem']).toBe(7);
    expect(map!['sc-status']).toBe(8);
    expect(map!['cs(User-Agent)']).toBe(10);
    expect(map!['cs-method']).toBe(5);
  });

  it('returns null for non-#Fields lines', () => {
    expect(parseFieldsHeader('#Version: 1.0')).toBeNull();
    expect(parseFieldsHeader('2025-01-15\t10:30:00')).toBeNull();
  });
});

describe('parseLogLine', () => {
  it('parses a valid CloudFront log line', () => {
    const fieldMap = buildFieldMap();
    const entry = parseLogLine(mkLogLine(), fieldMap);
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe('2025-01-15');
    expect(entry!.time).toBe('10:30:00');
    expect(entry!.uri).toBe('/restaurant/india-belly/index.html');
    expect(entry!.statusCode).toBe(200);
    expect(entry!.method).toBe('GET');
    expect(entry!.userAgent).toBe('Mozilla/5.0%20(compatible;%20GPTBot/1.0)');
  });

  it('returns null for comment lines', () => {
    const fieldMap = buildFieldMap();
    expect(parseLogLine('#Version: 1.0', fieldMap)).toBeNull();
    expect(parseLogLine('#Fields: date time', fieldMap)).toBeNull();
  });

  it('returns null for empty lines', () => {
    const fieldMap = buildFieldMap();
    expect(parseLogLine('', fieldMap)).toBeNull();
    expect(parseLogLine('   ', fieldMap)).toBeNull();
  });

  it('returns null when line has insufficient fields', () => {
    const fieldMap = buildFieldMap();
    expect(parseLogLine('2025-01-15\t10:30:00', fieldMap)).toBeNull();
  });
});

describe('identifyBot', () => {
  it('identifies GPTBot', () => {
    expect(identifyBot('Mozilla/5.0%20(compatible;%20GPTBot/1.0)')).toBe('GPTBot');
  });

  it('identifies ChatGPT-User', () => {
    expect(identifyBot('Mozilla/5.0%20ChatGPT-User/1.0')).toBe('ChatGPT-User');
  });

  it('identifies Googlebot', () => {
    expect(identifyBot('Mozilla/5.0%20(compatible;%20Googlebot/2.1)')).toBe('Googlebot');
  });

  it('identifies ClaudeBot', () => {
    expect(identifyBot('ClaudeBot/1.0')).toBe('ClaudeBot');
  });

  it('identifies Anthropic-AI', () => {
    expect(identifyBot('Anthropic-AI')).toBe('Anthropic-AI');
  });

  it('identifies CCBot', () => {
    expect(identifyBot('CCBot/2.0')).toBe('CCBot');
  });

  it('identifies BraveBot', () => {
    expect(identifyBot('BraveBot/1.0')).toBe('BraveBot');
  });

  it('identifies PerplexityBot', () => {
    expect(identifyBot('PerplexityBot/1.0')).toBe('PerplexityBot');
  });

  it('identifies Bingbot case-insensitively', () => {
    expect(identifyBot('Mozilla/5.0%20(compatible;%20bingbot/2.0)')).toBe('Bingbot');
  });

  it('returns null for regular browser user agents', () => {
    expect(identifyBot('Mozilla/5.0%20(Windows%20NT%2010.0)')).toBeNull();
  });

  it('returns null for empty user agent', () => {
    expect(identifyBot('-')).toBeNull();
  });
});

describe('extractHandleFromUri', () => {
  it('extracts handle from /restaurant/india-belly/index.html', () => {
    expect(extractHandleFromUri('/restaurant/india-belly/index.html')).toBe('india-belly');
  });

  it('extracts handle from /cafe/trail-youth-coffee/', () => {
    expect(extractHandleFromUri('/cafe/trail-youth-coffee/')).toBe('trail-youth-coffee');
  });

  it('extracts handle from /bakery/sweet-treats/page.html', () => {
    expect(extractHandleFromUri('/bakery/sweet-treats/page.html')).toBe('sweet-treats');
  });

  it('returns null for root path /', () => {
    expect(extractHandleFromUri('/')).toBeNull();
  });

  it('returns null for single-segment paths', () => {
    expect(extractHandleFromUri('/robots.txt')).toBeNull();
  });
});

describe('parseLogFile', () => {
  it('extracts bot visits from multi-line log content', () => {
    const content = [
      '#Version: 1.0',
      SAMPLE_FIELDS_HEADER,
      mkLogLine(),
      mkLogLine({ 'cs-uri-stem': '/cafe/coffee/index.html', 'cs(User-Agent)': 'ClaudeBot/1.0' }),
    ].join('\n');

    const visits = parseLogFile(content, '2025-01-15');
    expect(visits).toHaveLength(2);
    expect(visits[0].handle).toBe('india-belly');
    expect(visits[0].bot).toBe('GPTBot');
    expect(visits[1].handle).toBe('coffee');
    expect(visits[1].bot).toBe('ClaudeBot');
  });

  it('filters out non-bot visits', () => {
    const content = [
      SAMPLE_FIELDS_HEADER,
      mkLogLine({ 'cs(User-Agent)': 'Mozilla/5.0%20(Windows%20NT%2010.0)' }),
    ].join('\n');

    const visits = parseLogFile(content, '2025-01-15');
    expect(visits).toHaveLength(0);
  });

  it('filters by target date', () => {
    const content = [
      SAMPLE_FIELDS_HEADER,
      mkLogLine({ date: '2025-01-15' }),
      mkLogLine({ date: '2025-01-16' }),
    ].join('\n');

    const visits = parseLogFile(content, '2025-01-15');
    expect(visits).toHaveLength(1);
    expect(visits[0].timestamp).toBe('2025-01-15T10:30:00Z');
  });

  it('handles empty log content', () => {
    expect(parseLogFile('', '2025-01-15')).toEqual([]);
  });

  it('handles log content with only comments', () => {
    const content = '#Version: 1.0\n#Fields: date time\n';
    expect(parseLogFile(content, '2025-01-15')).toEqual([]);
  });

  it('skips data lines before #Fields header is seen', () => {
    const content = [
      mkLogLine(), // data line before header — should be skipped
      SAMPLE_FIELDS_HEADER,
      mkLogLine(),
    ].join('\n');

    const visits = parseLogFile(content, '2025-01-15');
    expect(visits).toHaveLength(1);
  });

  it('skips URIs without a handle segment', () => {
    const content = [
      SAMPLE_FIELDS_HEADER,
      mkLogLine({ 'cs-uri-stem': '/robots.txt' }),
    ].join('\n');

    const visits = parseLogFile(content, '2025-01-15');
    expect(visits).toHaveLength(0);
  });
});
