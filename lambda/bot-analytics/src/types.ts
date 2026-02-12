/** Mapping from URL handle (e.g., "india-belly") to Nostr npub */
export type HandleNpubMap = Record<string, string>;

/** A single parsed CloudFront access log entry */
export interface CloudFrontLogEntry {
  date: string;
  time: string;
  uri: string;
  userAgent: string;
  statusCode: number;
  method: string;
}

/** Bot user-agent identifiers to filter for */
export const BOT_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'Bingbot',
  'BraveBot',
  'PerplexityBot',
  'Googlebot',
  'ClaudeBot',
  'Anthropic-AI',
  'CCBot',
] as const;

/** A bot visit extracted from log analysis */
export interface BotVisit {
  handle: string;
  bot: string;
  uri: string;
  timestamp: string;
}

/** Aggregated daily summary for a single npub+bot combination */
export interface DailyBotSummary {
  npub: string;
  dateBotKey: string;
  date: string;
  bot: string;
  visitCount: number;
  pages: string[];
  handle: string;
  updatedAt: number;
}

/** Lambda handler event (from EventBridge or manual invocation) */
export interface BotAnalyticsEvent {
  date?: string;
  dryRun?: boolean;
}

/** Lambda handler response */
export interface BotAnalyticsResponse {
  statusCode: number;
  body: string;
}

/** Stats for the execution summary */
export interface ExecutionStats {
  htmlFilesScanned: number;
  handlesResolved: number;
  logFilesProcessed: number;
  logLinesProcessed: number;
  botVisitsFound: number;
  summariesWritten: number;
  errors: string[];
  duration: number;
}

/** Parsed field index map from CloudFront #Fields header */
export type FieldIndexMap = Record<string, number>;
