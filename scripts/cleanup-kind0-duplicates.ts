#!/usr/bin/env npx tsx
/**
 * One-time cleanup: remove duplicate kind 0 (profile) rows from DynamoDB.
 * Keeps the event with the latest created_at per pubkey and deletes the rest.
 *
 * Run only after deploying the kind 0 replaceable fix (Lambda + data loader).
 * Do NOT run automatically in production. Prefer testing against a staging
 * or copy of the table first.
 *
 * Usage:
 *   DRY RUN (recommended first):  npx tsx scripts/cleanup-kind0-duplicates.ts --dry-run
 *   WITH DELETES:                 DYNAMODB_TABLE_NAME=synvya-nostr-events AWS_REGION=us-east-1 npx tsx scripts/cleanup-kind0-duplicates.ts
 *
 * Env: DYNAMODB_TABLE_NAME, AWS_REGION or REGION (default: synvya-nostr-events, us-east-1)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DYNAMODB_TABLE_NAME || 'synvya-nostr-events';
const REGION = process.env.AWS_REGION || process.env.REGION || 'us-east-1';

interface Kind0Item {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('DRY RUN: no rows will be deleted.\n');
  }

  const client = new DynamoDBClient({ region: REGION });
  const doc = DynamoDBDocumentClient.from(client);

  console.log(`Scanning table ${TABLE} (${REGION}) for kind=0...`);
  const scan = await doc.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#kind = :kind',
      ExpressionAttributeNames: { '#kind': 'kind' },
      ExpressionAttributeValues: { ':kind': 0 },
    })
  );

  const items = (scan.Items || []) as Kind0Item[];
  console.log(`Found ${items.length} kind 0 event(s).`);

  // Group by pubkey; keep the one with max created_at
  const byPubkey = new Map<string, Kind0Item>();
  for (const item of items) {
    const existing = byPubkey.get(item.pubkey);
    const itemTs = item.created_at ?? 0;
    const existingTs = existing?.created_at ?? 0;
    if (!existing || itemTs > existingTs) {
      byPubkey.set(item.pubkey, item);
    }
  }

  const idsToDelete: string[] = [];
  for (const item of items) {
    const keeper = byPubkey.get(item.pubkey);
    if (keeper && keeper.id !== item.id) {
      idsToDelete.push(item.id);
    }
  }

  if (idsToDelete.length === 0) {
    console.log('No duplicate kind 0 rows to remove.');
    return;
  }

  console.log(`Would delete ${idsToDelete.length} duplicate row(s), keeping ${byPubkey.size} profile(s) per pubkey.`);

  if (!dryRun) {
    for (const id of idsToDelete) {
      await doc.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { id },
        })
      );
      console.log(`Deleted ${id.substring(0, 12)}...`);
    }
    console.log(`Done. Deleted ${idsToDelete.length} row(s).`);
  } else {
    console.log('Dry run: no deletes performed. Run without --dry-run to apply.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
