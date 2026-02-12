import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { BotVisit, DailyBotSummary, HandleNpubMap } from './types.js';

const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Aggregate bot visits into daily summaries grouped by (handle, bot).
 * Looks up the npub for each handle using the provided map.
 * Visits with unknown handles are skipped.
 */
export function aggregateBotVisits(
  visits: BotVisit[],
  handleNpubMap: HandleNpubMap,
  date: string
): DailyBotSummary[] {
  const groups = new Map<string, { bot: string; handle: string; uris: Set<string>; count: number }>();

  for (const visit of visits) {
    if (!handleNpubMap[visit.handle]) {
      continue;
    }

    const key = `${visit.handle}#${visit.bot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.uris.add(visit.uri);
    } else {
      groups.set(key, {
        bot: visit.bot,
        handle: visit.handle,
        uris: new Set([visit.uri]),
        count: 1,
      });
    }
  }

  const summaries: DailyBotSummary[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const group of groups.values()) {
    const npub = handleNpubMap[group.handle];
    summaries.push({
      npub,
      dateBotKey: `${date}#${group.bot}`,
      date,
      bot: group.bot,
      visitCount: group.count,
      pages: Array.from(group.uris),
      handle: group.handle,
      updatedAt: now,
    });
  }

  return summaries;
}

/**
 * Write daily bot summaries to DynamoDB using BatchWriteCommand.
 * Uses PutRequest for upsert semantics (idempotent).
 * Returns the number of items written.
 */
export async function writeSummaries(
  summaries: DailyBotSummary[],
  tableName: string,
  dryRun: boolean
): Promise<number> {
  if (summaries.length === 0) return 0;

  if (dryRun) {
    for (const s of summaries) {
      console.log(`[DRY RUN] Would write: ${s.npub} | ${s.dateBotKey} | ${s.visitCount} visits`);
    }
    return 0;
  }

  let written = 0;

  // BatchWriteCommand supports up to 25 items per call
  for (let i = 0; i < summaries.length; i += 25) {
    const batch = summaries.slice(i, i + 25);
    const command = new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map((s) => ({
          PutRequest: {
            Item: s,
          },
        })),
      },
    });

    await docClient.send(command);
    written += batch.length;
  }

  return written;
}
