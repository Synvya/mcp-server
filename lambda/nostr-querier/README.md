# Synvya Nostr Relay Querier Lambda

AWS Lambda function that queries multiple Nostr relays for food establishment profiles (kind:0), collections (kind:30405), and products (kind:30402), then stores them in DynamoDB.

## Overview

This Lambda function:
- Connects to multiple Nostr relays via WebSocket
- **Step 1**: Queries for kind:0 events with `foodEstablishment:*` tags (profiles)
- **Step 2**: Queries for kind:30405 events from known food establishment pubkeys (collections/menus)
- **Step 3**: Queries for kind:30402 events from known food establishment pubkeys (products/menu items)
- Deduplicates events by [kind, pubkey, d-tag] triplet for replaceable events
- Stores/updates events in DynamoDB
- Handles relay failures gracefully
- Logs detailed execution statistics

## Prerequisites

- AWS Account with Lambda and DynamoDB access
- DynamoDB table `synvya-nostr-events` created (see Issue #30)
- IAM role `SynvyaNostrLambdaRole` with DynamoDB permissions
- Node.js 18.x or later (for local development)

## Installation

```bash
cd lambda/nostr-querier
npm install
```

## Build

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Package for Deployment

```bash
npm run package
```

This creates `lambda.zip` with all necessary files for Lambda deployment.

## Deployment

### Option 1: AWS Console

1. Build and package the Lambda:
   ```bash
   npm run package
   ```

2. Create Lambda function in AWS Console:
   - Go to: https://console.aws.amazon.com/lambda
   - Click **"Create function"**
   - **Function name**: `synvya-nostr-querier`
   - **Runtime**: Node.js 20.x
   - **Architecture**: x86_64
   - **Execution role**: Use existing role `SynvyaNostrLambdaRole`
   - Click **"Create function"**

3. Upload the code:
   - In the Lambda function page, click **"Upload from"** → **".zip file"**
   - Upload `lambda.zip`
   - Click **"Save"**

4. Configure Lambda settings:
   - **Handler**: `index.handler`
   - **Timeout**: 30 seconds
   - **Memory**: 512 MB
   - **Environment variables** (see below)

### Option 2: AWS CLI

```bash
# Create Lambda function
aws lambda create-function \
  --function-name synvya-nostr-querier \
  --runtime nodejs20.x \
  --role arn:aws:iam::ACCOUNT_ID:role/SynvyaNostrLambdaRole \
  --handler index.handler \
  --zip-file fileb://lambda.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment Variables="{DYNAMODB_TABLE_NAME=synvya-nostr-events,REGION=us-east-1,NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol}"

# Update function code (subsequent deployments)
npm run deploy
```

## Environment Variables

Configure these in the Lambda console under **Configuration → Environment variables**:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DYNAMODB_TABLE_NAME` | Yes | `synvya-nostr-events` | DynamoDB table name |
| `REGION` | Yes | `us-east-1` | AWS region for DynamoDB (use `REGION` not `AWS_REGION` - reserved) |
| `NOSTR_RELAYS` | No | See below | Comma-separated list of relay URLs |
| `MAX_EVENTS_PER_RELAY` | No | `1000` | Max events to retrieve per filter |
| `QUERY_TIMEOUT_MS` | No | `25000` | Query timeout in milliseconds |
| `QUERY_COLLECTIONS` | No | `true` | Enable/disable collections (kind:30405) querying |
| `QUERY_PRODUCTS` | No | `true` | Enable/disable products (kind:30402) querying |

**Default Nostr Relays:**
```
wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol
```

## Testing

### Manual Invocation (AWS Console)

1. Go to your Lambda function in the console
2. Click **"Test"** tab
3. Create a test event with:

**Event name**: `TestQuery`
**Event JSON**:
```json
{
  "kinds": [0],
  "tags": ["Restaurant", "Bakery"],
  "dryRun": false
}
```

4. Click **"Test"**
5. View execution results and CloudWatch logs

### AWS CLI Test

```bash
aws lambda invoke \
  --function-name synvya-nostr-querier \
  --payload '{"kinds":[0],"tags":["Restaurant"]}' \
  response.json

cat response.json
```

### Check DynamoDB

After successful execution, verify events in DynamoDB:

**Check profiles (kind:0)**:
```bash
aws dynamodb scan \
  --table-name synvya-nostr-events \
  --filter-expression "#k = :kind" \
  --expression-attribute-names '{"#k":"kind"}' \
  --expression-attribute-values '{":kind":{"N":"0"}}' \
  --limit 10
```

**Check collections (kind:30405)**:
```bash
aws dynamodb scan \
  --table-name synvya-nostr-events \
  --filter-expression "#k = :kind" \
  --expression-attribute-names '{"#k":"kind"}' \
  --expression-attribute-values '{":kind":{"N":"30405"}}' \
  --limit 10
```

## Event Parameters

The Lambda no longer accepts parameters via the event. It automatically:
1. Queries all food establishment profiles (kind:0)
2. Queries collections (kind:30405) for those establishments

**Legacy Parameters** (ignored in current version):
- ~~`kinds`~~ - Now fixed to [0] for profiles, then [30405] for collections, then [30402] for products
- ~~`tags`~~ - Now queries all food establishment types automatically
- **`dryRun`** (boolean): If true, retrieves events but doesn't store them (default: `false`)

**Example Test Event**:
```json
{
  "dryRun": false
}
```

**Expected Output Summary**:
- Step 1: Profiles (kind:0) retrieved and stored
- Step 2: Collections (kind:30405) retrieved and stored
- Step 3: Products (kind:30402) retrieved and stored
- Total statistics: retrieved, stored, updated, skipped, errors, duration

## Response Format

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "stats": {
      "combined": {
        "eventsRetrieved": 52,
        "eventsStored": 20,
        "eventsUpdated": 15,
        "eventsSkipped": 17,
        "relayErrors": [],
        "duration": 15234
      },
      "profiles": {
        "eventsRetrieved": 42,
        "eventsStored": 15,
        "eventsUpdated": 10,
        "eventsSkipped": 17,
        "relayErrors": [],
        "duration": 12453
      },
      "collections": {
        "eventsRetrieved": 10,
        "eventsStored": 5,
        "eventsUpdated": 5,
        "eventsSkipped": 0,
        "relayErrors": [],
        "duration": 2781
      }
    },
    "message": "Successfully queried Nostr relays and stored events"
  }
}
```

## Monitoring

### CloudWatch Logs

- Log Group: `/aws/lambda/synvya-nostr-querier`
- View logs: https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups

### CloudWatch Metrics

Key metrics to monitor:
- **Invocations**: Number of Lambda executions
- **Duration**: Execution time (should be < 30s)
- **Errors**: Failed executions
- **Throttles**: Rate-limited invocations

### Custom Metrics (from logs)

The Lambda logs structured data you can extract:
- Events retrieved per execution
- Events stored/updated/skipped
- Relay errors
- Execution duration

## Troubleshooting

### No events retrieved

**Symptoms**: `eventsRetrieved: 0`

**Possible causes**:
- Relays are down or unreachable
- Network connectivity issues
- Filters are too restrictive

**Solutions**:
- Check relay URLs are correct
- Test relay connectivity manually
- Verify event kinds and tags exist on relays

### Timeout errors

**Symptoms**: Lambda times out after 30 seconds

**Possible causes**:
- Too many events to process
- Slow relay responses
- Network issues

**Solutions**:
- Reduce `MAX_EVENTS_PER_RELAY`
- Reduce `QUERY_TIMEOUT_MS`
- Add more specific filters

### DynamoDB errors

**Symptoms**: `Failed to store event` errors in logs

**Possible causes**:
- Insufficient IAM permissions
- Table doesn't exist
- Throttling due to high write volume

**Solutions**:
- Verify IAM role has `dynamodb:PutItem` permission
- Check table name matches environment variable
- Consider provisioned capacity if using on-demand

### High costs

**Symptoms**: AWS bill higher than expected

**Possible causes**:
- Too frequent invocations
- Too many DynamoDB writes
- High memory allocation

**Solutions**:
- Reduce EventBridge schedule frequency (currently every 30 minutes)
- Increase cache TTL in MCP server
- Optimize memory allocation (start with 512 MB)

## Performance Optimization

### Memory Configuration

Start with 512 MB and adjust based on CloudWatch metrics:
- **< 400 MB used**: Reduce to 256 MB
- **> 450 MB used**: Increase to 1024 MB

### Timeout Configuration

Default is 30 seconds. Adjust based on needs:
- Most queries complete in 10-20 seconds
- Increase only if consistently timing out
- Consider reducing `MAX_EVENTS_PER_RELAY` instead

### Relay Selection

Choose relays based on:
- **Reliability**: Uptime and response time
- **Coverage**: Number of food establishment profiles
- **Geography**: Closer relays = lower latency

Recommended relays:
- `wss://relay.damus.io` - High reliability, good coverage
- `wss://relay.nostr.band` - Excellent indexing
- `wss://nos.lol` - Good performance
- `wss://relay.snort.social` - Active community

## Automated Execution

The Lambda function is configured to run automatically via EventBridge:

- **Schedule Name**: `synvya-nostr-relay-schedule`
- **Frequency**: Every 30 minutes (`rate(30 minutes)`)
- **Status**: Enabled
- **Executions per day**: 48
- **Schedule ARN**: `arn:aws:scheduler:us-east-1:122610503853:schedule/default/synvya-nostr-relay-schedule`

### Managing the Schedule

You can control the schedule via AWS Console:
1. Navigate to: https://console.aws.amazon.com/scheduler
2. Select the schedule: `synvya-nostr-relay-schedule`
3. Actions available:
   - **Disable**: Temporarily stop automatic executions
   - **Edit**: Change the frequency or configuration
   - **Delete**: Remove the schedule entirely

### Common Schedule Patterns

If you need to adjust the frequency:
- **Every 15 minutes**: `rate(15 minutes)`
- **Every hour**: `rate(1 hour)`
- **Every 6 hours**: `rate(6 hours)`
- **Daily at midnight**: `cron(0 0 * * ? *)`

## Next Steps

After deploying this Lambda:
1. ✅ EventBridge schedule configured (runs every 30 minutes)
2. Test manual execution
3. Monitor CloudWatch logs
4. Verify DynamoDB contains events
5. Proceed to MCP server integration (Issue #33)

## Support

For issues or questions:
- Check CloudWatch logs first
- Review DynamoDB table contents
- Verify IAM permissions
- Test relay connectivity manually

