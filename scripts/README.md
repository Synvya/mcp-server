# Scripts

## cleanup-kind0-duplicates

One-time cleanup of duplicate kind 0 (profile) rows in DynamoDB. After deploying the [kind 0 replaceable fix](https://github.com/Synvya/mcp-server/issues/68) (Lambda + data loader), the table may still contain multiple kind 0 events per pubkey from earlier runs. This script keeps the latest event per pubkey (by `created_at`) and deletes the rest.

**When to run:** Once, after the kind 0 replaceable Lambda and data-loader changes are deployed. Do not run automatically in production.

**Before running in production:** Prefer running against a staging table or a copy of the table first. Use `--dry-run` to see what would be deleted without making changes.

**Usage:**

```bash
# Dry run (no deletes; recommended first)
npx tsx scripts/cleanup-kind0-duplicates.ts --dry-run

# Apply deletes (set env for table and region)
DYNAMODB_TABLE_NAME=synvya-nostr-events AWS_REGION=us-east-1 npx tsx scripts/cleanup-kind0-duplicates.ts
```

**Environment:**

- `DYNAMODB_TABLE_NAME` – Table name (default: `synvya-nostr-events`)
- `AWS_REGION` or `REGION` – AWS region (default: `us-east-1`)

AWS credentials must be configured (e.g. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or an IAM role).
