/**
 * AWS Lambda function to query Nostr relays for food establishment profiles
 * and store them in DynamoDB.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SimplePool, Filter, Event as NostrEvent } from 'nostr-tools';

// Environment variables
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'synvya-nostr-events';
const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol').split(',');
const MAX_EVENTS_PER_RELAY = parseInt(process.env.MAX_EVENTS_PER_RELAY || '1000', 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '25000', 10);

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Food establishment types to query
const FOOD_ESTABLISHMENT_TYPES = [
  'Bakery',
  'BarOrPub',
  'Brewery',
  'CafeOrCoffeeShop',
  'Distillery',
  'FastFoodRestaurant',
  'IceCreamShop',
  'Restaurant',
  'Winery',
];

interface LambdaEvent {
  kinds?: number[];
  tags?: string[];
  dryRun?: boolean;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

interface QueryStats {
  eventsRetrieved: number;
  eventsStored: number;
  eventsUpdated: number;
  eventsSkipped: number;
  relayErrors: string[];
  duration: number;
}

/**
 * Check if an event already exists in DynamoDB and if it's newer
 */
async function shouldStoreEvent(event: NostrEvent): Promise<boolean> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { id: event.id },
    }));

    if (!result.Item) {
      return true; // Event doesn't exist, store it
    }

    // Check if new event is newer than existing one
    const existingCreatedAt = result.Item.created_at as number;
    return event.created_at > existingCreatedAt;
  } catch (error) {
    console.error(`Error checking event ${event.id}:`, error);
    return true; // On error, try to store anyway
  }
}

/**
 * Store a Nostr event in DynamoDB
 */
async function storeEvent(event: NostrEvent): Promise<void> {
  const item = {
    id: event.id,
    kind: event.kind,
    pubkey: event.pubkey,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags,
    sig: event.sig,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await docClient.send(new PutCommand({
    TableName: DYNAMODB_TABLE_NAME,
    Item: item,
  }));
}

/**
 * Query Nostr relays for food establishment profiles
 */
async function queryNostrRelays(
  kinds: number[] = [0],
  tags: string[] = FOOD_ESTABLISHMENT_TYPES
): Promise<QueryStats> {
  const startTime = Date.now();
  const stats: QueryStats = {
    eventsRetrieved: 0,
    eventsStored: 0,
    eventsUpdated: 0,
    eventsSkipped: 0,
    relayErrors: [],
    duration: 0,
  };

  console.log('Starting Nostr relay query...');
  console.log(`Relays: ${NOSTR_RELAYS.join(', ')}`);
  console.log(`Kinds: ${kinds.join(', ')}`);
  console.log(`Tags: ${tags.map(t => `foodEstablishment:${t}`).join(', ')}`);

  const pool = new SimplePool();

  try {
    // Build single filter with all foodEstablishment tags
    // Nostr filters with multiple values in '#t' array use OR logic
    const filter: Filter = {
      kinds: kinds,
      '#t': tags.map(tag => `foodEstablishment:${tag}`),
      limit: MAX_EVENTS_PER_RELAY,
    };

    console.log(`Querying with filter for ${tags.length} establishment types...`);

    // Query all relays with timeout
    const eventsPromise = new Promise<NostrEvent[]>((resolve) => {
      const collectedEvents: NostrEvent[] = [];
      const sub = pool.subscribeMany(NOSTR_RELAYS, filter, {
        onevent(event) {
          collectedEvents.push(event);
        },
        oneose() {
          sub.close();
          resolve(collectedEvents);
        },
      });
    });

    const events = await Promise.race([
      eventsPromise,
      new Promise<NostrEvent[]>((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), QUERY_TIMEOUT_MS)
      ),
    ]);

    stats.eventsRetrieved = events.length;
    console.log(`Retrieved ${events.length} events from relays`);

    // Process events
    const eventMap = new Map<string, NostrEvent>();
    
    // Deduplicate by event ID (keep the one with latest created_at)
    for (const event of events) {
      const existing = eventMap.get(event.id);
      if (!existing || event.created_at > existing.created_at) {
        eventMap.set(event.id, event);
      }
    }

    console.log(`Processing ${eventMap.size} unique events...`);

    // Store events in DynamoDB
    for (const [eventId, event] of eventMap.entries()) {
      try {
        const shouldStore = await shouldStoreEvent(event);
        
        if (shouldStore) {
          await storeEvent(event);
          
          // Check if it was an update or new insert
          const wasUpdate = await docClient.send(new GetCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Key: { id: eventId },
          })).then(result => result.Item?.updatedAt !== event.created_at);
          
          if (wasUpdate) {
            stats.eventsUpdated++;
          } else {
            stats.eventsStored++;
          }
          
          console.log(`Stored event ${eventId.substring(0, 8)}... (${event.kind})`);
        } else {
          stats.eventsSkipped++;
          console.log(`Skipped event ${eventId.substring(0, 8)}... (older version)`);
        }
      } catch (error) {
        console.error(`Error storing event ${eventId}:`, error);
        stats.relayErrors.push(`Failed to store event ${eventId}: ${error}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error querying relays:', errorMsg);
    stats.relayErrors.push(errorMsg);
  } finally {
    // Clean up pool connections
    pool.close(NOSTR_RELAYS);
  }

  stats.duration = Date.now() - startTime;
  return stats;
}

/**
 * Lambda handler
 */
export const handler: Handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));

  try {
    // Parse event parameters
    const kinds = event.kinds || [0];
    const tags = event.tags || FOOD_ESTABLISHMENT_TYPES;
    const dryRun = event.dryRun || false;

    if (dryRun) {
      console.log('DRY RUN MODE - No events will be stored');
    }

    // Query Nostr relays
    const stats = await queryNostrRelays(kinds, tags);

    // Log summary
    console.log('Query completed:');
    console.log(`  - Events retrieved: ${stats.eventsRetrieved}`);
    console.log(`  - Events stored (new): ${stats.eventsStored}`);
    console.log(`  - Events updated: ${stats.eventsUpdated}`);
    console.log(`  - Events skipped: ${stats.eventsSkipped}`);
    console.log(`  - Errors: ${stats.relayErrors.length}`);
    console.log(`  - Duration: ${stats.duration}ms`);

    if (stats.relayErrors.length > 0) {
      console.error('Errors encountered:');
      stats.relayErrors.forEach(error => console.error(`  - ${error}`));
    }

    // Determine success status
    const isSuccess = stats.eventsRetrieved > 0 && stats.relayErrors.length === 0;
    const statusCode = isSuccess ? 200 : (stats.eventsRetrieved > 0 ? 207 : 500);

    return {
      statusCode,
      body: JSON.stringify({
        success: isSuccess,
        stats,
        message: isSuccess 
          ? 'Successfully queried Nostr relays and stored events'
          : stats.relayErrors.length > 0
            ? 'Completed with errors'
            : 'Failed to retrieve events from relays',
      }),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Lambda execution failed:', errorMsg);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMsg,
        message: 'Lambda execution failed',
      }),
    };
  }
};

