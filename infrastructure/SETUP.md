# AWS Infrastructure Setup

## DynamoDB Table
- **Table Name**: synvya-nostr-events
- **Region**: us-east-1 (or your region)
- **ARN**: arn:aws:dynamodb:us-east-1:122610503853:table/synvya-nostr-events
- **Status**: Active
- **Billing Mode**: On-Demand
- **GSIs**: KindIndex, PubkeyIndex

## Lambda Function
- **Function Name**: synvya-nostr-querier
- **Runtime**: Node.js 20.x
- **Handler**: index.handler
- **Timeout**: 30 seconds
- **Memory**: 512 MB
- **Execution Role**: SynvyaNostrLambdaRole

## EventBridge Schedule
- **Schedule Name**: synvya-nostr-relay-schedule
- **Frequency**: Every 30 minutes (`rate(30 minutes)`)
- **Status**: Enabled
- **Description**: Triggers Nostr relay querier Lambda every 30 minutes
- **Schedule ARN**: arn:aws:scheduler:us-east-1:122610503853:schedule/default/synvya-nostr-relay-schedule
- **Created**: Dec 29, 2025

## IAM Role (Lambda)
- **Role Name**: SynvyaNostrLambdaRole
- **ARN**: arn:aws:iam::122610503853:role/SynvyaNostrLambdaRole
- **Purpose**: Lambda execution with DynamoDB write access

## IAM User (Vercel/MCP)
- **User Name**: synvya-mcp-server-user
- **Access Key ID**: AKIA... (stored in password manager)
- **Secret Access Key**: (stored in password manager)
- **Purpose**: Read-only DynamoDB access for MCP server

## Environment Variables for Next Steps

### Lambda Function
- DYNAMODB_TABLE_NAME=synvya-nostr-events
- REGION=us-east-1
- NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol
- MAX_EVENTS_PER_RELAY=1000
- QUERY_TIMEOUT_MS=25000

### Vercel (MCP Server)
- DYNAMODB_TABLE_NAME=synvya-nostr-events
- AWS_REGION=us-east-1
- AWS_ACCESS_KEY_ID=(from IAM user)
- AWS_SECRET_ACCESS_KEY=(from IAM user)
- USE_DYNAMODB=false (initially, switch to true after testing)