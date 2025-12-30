/**
 * AWS Lambda function to query Nostr relays for food establishment profiles
 * and store them in DynamoDB.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SimplePool, Filter, Event as NostrEvent } from 'nostr-tools';

// Environment variables
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'synvya-nostr-events';
const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol').split(',');
const MAX_EVENTS_PER_RELAY = parseInt(process.env.MAX_EVENTS_PER_RELAY || '1000', 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '25000', 10);
const QUERY_COLLECTIONS = (process.env.QUERY_COLLECTIONS || 'true') === 'true';

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
 * Get all food establishment pubkeys from DynamoDB
 */
async function getFoodEstablishmentPubkeys(): Promise<string[]> {
  try {
    console.log('Fetching food establishment pubkeys from DynamoDB...');
    
    const command = new ScanCommand({
      TableName: DYNAMODB_TABLE_NAME,
      FilterExpression: '#kind = :kind',
      ExpressionAttributeNames: {
        '#kind': 'kind',
      },
      ExpressionAttributeValues: {
        ':kind': 0,
      },
      ProjectionExpression: 'pubkey',
    });
    
    const result = await docClient.send(command);
    const pubkeys = (result.Items || [])
      .map(item => item.pubkey as string)
      .filter((pubkey, index, self) => self.indexOf(pubkey) === index); // Deduplicate
    
    console.log(`Found ${pubkeys.length} unique food establishment pubkeys`);
    return pubkeys;
  } catch (error) {
    console.error('Error fetching pubkeys from DynamoDB:', error);
    return [];
  }
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
 * Query Nostr relays for events with given filter
 */
async function queryNostrRelays(
  filter: Filter,
  description: string,
  dryRun: boolean = false
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

  console.log(`Starting Nostr relay query for ${description}...`);
  console.log(`Relays: ${NOSTR_RELAYS.join(', ')}`);
  console.log(`Filter:`, JSON.stringify(filter, null, 2));
  if (dryRun) {
    console.log('⚠️ DRY RUN MODE - Events will NOT be stored in DynamoDB');
  }

  const pool = new SimplePool();

  try {
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

    // Store events in DynamoDB (skip if dryRun)
    if (dryRun) {
      console.log(`⚠️ DRY RUN: Would process ${eventMap.size} events (not storing)`);
      stats.eventsRetrieved = eventMap.size;
    } else {
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
            
            console.log(`Stored event ${eventId.substring(0, 8)}... (kind:${event.kind})`);
          } else {
            stats.eventsSkipped++;
            console.log(`Skipped event ${eventId.substring(0, 8)}... (older version)`);
          }
        } catch (error) {
          console.error(`Error storing event ${eventId}:`, error);
          stats.relayErrors.push(`Failed to store event ${eventId}: ${error}`);
        }
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
export const handler: Handler = async (event: LambdaEvent) => {
  console.log('Lambda invoked with event:', JSON.stringify(event, null, 2));

  try {
    const dryRun = event.dryRun || false;

    if (dryRun) {
      console.log('DRY RUN MODE - No events will be stored');
    }

    // Step 1: Query profiles (kind:0) with foodEstablishment tags
    console.log('\n=== STEP 1: Querying food establishment profiles ===');
    const profileFilter: Filter = {
      kinds: [0],
      '#t': FOOD_ESTABLISHMENT_TYPES.map(tag => `foodEstablishment:${tag}`),
      limit: MAX_EVENTS_PER_RELAY,
    };
    
    const profileStats = await queryNostrRelays(profileFilter, 'food establishment profiles', dryRun);

    // Step 2: Query collections (kind:30405) for known food establishments
    let collectionStats: QueryStats | null = null;
    
    if (QUERY_COLLECTIONS && profileStats.eventsRetrieved > 0) {
      console.log('\n=== STEP 2: Querying collections for food establishments ===');
      
      // Get all food establishment pubkeys from DynamoDB
      const pubkeys = await getFoodEstablishmentPubkeys();
      
      if (pubkeys.length > 0) {
        const collectionFilter: Filter = {
          kinds: [30405],
          authors: pubkeys,
          since: Math.floor(Date.now() / 1000) - (24 * 60 * 60), // Last 24 hours
          limit: MAX_EVENTS_PER_RELAY,
        };
        
        collectionStats = await queryNostrRelays(collectionFilter, 'collections', dryRun);
      } else {
        console.log('No food establishment pubkeys found, skipping collections query');
      }
    } else if (!QUERY_COLLECTIONS) {
      console.log('\n=== STEP 2: Collections query disabled (QUERY_COLLECTIONS=false) ===');
    } else {
      console.log('\n=== STEP 2: Skipping collections (no profiles retrieved) ===');
    }

    // Combine statistics
    const combinedStats: QueryStats = {
      eventsRetrieved: profileStats.eventsRetrieved + (collectionStats?.eventsRetrieved || 0),
      eventsStored: profileStats.eventsStored + (collectionStats?.eventsStored || 0),
      eventsUpdated: profileStats.eventsUpdated + (collectionStats?.eventsUpdated || 0),
      eventsSkipped: profileStats.eventsSkipped + (collectionStats?.eventsSkipped || 0),
      relayErrors: [...profileStats.relayErrors, ...(collectionStats?.relayErrors || [])],
      duration: profileStats.duration + (collectionStats?.duration || 0),
    };

    // Log summary
    console.log('\n=== QUERY SUMMARY ===');
    console.log('Profiles:');
    console.log(`  - Retrieved: ${profileStats.eventsRetrieved}`);
    console.log(`  - Stored (new): ${profileStats.eventsStored}`);
    console.log(`  - Updated: ${profileStats.eventsUpdated}`);
    console.log(`  - Duration: ${profileStats.duration}ms`);
    
    if (collectionStats) {
      console.log('Collections:');
      console.log(`  - Retrieved: ${collectionStats.eventsRetrieved}`);
      console.log(`  - Stored (new): ${collectionStats.eventsStored}`);
      console.log(`  - Updated: ${collectionStats.eventsUpdated}`);
      console.log(`  - Duration: ${collectionStats.duration}ms`);
    }
    
    console.log('Total:');
    console.log(`  - Events retrieved: ${combinedStats.eventsRetrieved}`);
    console.log(`  - Events stored (new): ${combinedStats.eventsStored}`);
    console.log(`  - Events updated: ${combinedStats.eventsUpdated}`);
    console.log(`  - Events skipped: ${combinedStats.eventsSkipped}`);
    console.log(`  - Errors: ${combinedStats.relayErrors.length}`);
    console.log(`  - Total duration: ${combinedStats.duration}ms`);

    if (combinedStats.relayErrors.length > 0) {
      console.error('Errors encountered:');
      combinedStats.relayErrors.forEach(error => console.error(`  - ${error}`));
    }

    // Determine success status
    const isSuccess = combinedStats.eventsRetrieved > 0 && combinedStats.relayErrors.length === 0;
    const statusCode = isSuccess ? 200 : (combinedStats.eventsRetrieved > 0 ? 207 : 500);

    return {
      statusCode,
      body: JSON.stringify({
        success: isSuccess,
        stats: {
          combined: combinedStats,
          profiles: profileStats,
          collections: collectionStats,
        },
        message: isSuccess 
          ? 'Successfully queried Nostr relays and stored events'
          : combinedStats.relayErrors.length > 0
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

