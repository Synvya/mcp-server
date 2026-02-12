import { CloudFrontLogEntry, BotVisit, BOT_USER_AGENTS, FieldIndexMap } from './types.js';

/**
 * Parse the #Fields header line from a CloudFront log to build a
 * field-name → column-index map. This avoids hardcoding field positions,
 * which can vary depending on CloudFront logging configuration.
 *
 * Example header:
 *   #Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) ...
 */
export function parseFieldsHeader(line: string): FieldIndexMap | null {
  if (!line.startsWith('#Fields:')) {
    return null;
  }

  const fields = line.replace('#Fields:', '').trim().split(/\s+/);
  const map: FieldIndexMap = {};
  for (let i = 0; i < fields.length; i++) {
    map[fields[i]] = i;
  }
  return map;
}

/**
 * Parse a single CloudFront access log line using the provided field index map.
 * Returns null for comment lines or lines with insufficient fields.
 */
export function parseLogLine(
  line: string,
  fieldMap: FieldIndexMap
): CloudFrontLogEntry | null {
  if (line.startsWith('#') || line.trim() === '') {
    return null;
  }

  const fields = line.split('\t');

  const dateIdx = fieldMap['date'];
  const timeIdx = fieldMap['time'];
  const uriIdx = fieldMap['cs-uri-stem'];
  const statusIdx = fieldMap['sc-status'];
  const uaIdx = fieldMap['cs(User-Agent)'];
  const methodIdx = fieldMap['cs-method'];

  if (
    dateIdx === undefined ||
    timeIdx === undefined ||
    uriIdx === undefined ||
    statusIdx === undefined ||
    uaIdx === undefined ||
    methodIdx === undefined
  ) {
    return null;
  }

  const maxRequired = Math.max(dateIdx, timeIdx, uriIdx, statusIdx, uaIdx, methodIdx);
  if (fields.length <= maxRequired) {
    return null;
  }

  return {
    date: fields[dateIdx],
    time: fields[timeIdx],
    uri: fields[uriIdx],
    statusCode: parseInt(fields[statusIdx], 10),
    userAgent: fields[uaIdx],
    method: fields[methodIdx],
  };
}

/**
 * Identify which bot (if any) made the request based on the user-agent string.
 * CloudFront URL-encodes the user-agent, so we decode it first.
 * Returns the canonical bot name or null for non-bot user agents.
 */
export function identifyBot(userAgent: string): string | null {
  const decoded = decodeURIComponent(userAgent);
  const lower = decoded.toLowerCase();

  for (const bot of BOT_USER_AGENTS) {
    if (lower.includes(bot.toLowerCase())) {
      return bot;
    }
  }

  return null;
}

/**
 * Extract the restaurant handle from a CloudFront URI path.
 * e.g., "/restaurant/india-belly/index.html" → "india-belly"
 *       "/cafe/trail-youth-coffee/" → "trail-youth-coffee"
 */
export function extractHandleFromUri(uri: string): string | null {
  const segments = uri.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  return segments[1];
}

/**
 * Parse an entire CloudFront log file content and extract bot visits.
 * Dynamically reads the #Fields header to determine column positions.
 */
export function parseLogFile(content: string, targetDate: string): BotVisit[] {
  const lines = content.split('\n');
  const visits: BotVisit[] = [];

  let fieldMap: FieldIndexMap | null = null;

  for (const line of lines) {
    // Look for #Fields header to determine column layout
    if (line.startsWith('#Fields:')) {
      fieldMap = parseFieldsHeader(line);
      continue;
    }

    // Skip other comment lines
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }

    if (!fieldMap) {
      // No #Fields header seen yet — can't parse data lines
      continue;
    }

    const entry = parseLogLine(line, fieldMap);
    if (!entry) continue;

    // Filter by target date
    if (entry.date !== targetDate) continue;

    // Identify bot
    const bot = identifyBot(entry.userAgent);
    if (!bot) continue;

    // Extract handle
    const handle = extractHandleFromUri(entry.uri);
    if (!handle) continue;

    visits.push({
      handle,
      bot,
      uri: entry.uri,
      timestamp: `${entry.date}T${entry.time}Z`,
    });
  }

  return visits;
}
