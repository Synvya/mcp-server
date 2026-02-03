/**
 * AWS Lambda function to query Nostr relays for food establishment profiles
 * and store them in DynamoDB.
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SimplePool, Filter, Event as NostrEvent } from 'nostr-tools';
import { buildEventMap } from './dedup.js';

// Environment variables
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'synvya-nostr-events';
const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const NOSTR_RELAYS = (process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol').split(',');
const MAX_EVENTS_PER_RELAY = parseInt(process.env.MAX_EVENTS_PER_RELAY || '1000', 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '25000', 10);
const QUERY_COLLECTIONS = (process.env.QUERY_COLLECTIONS || 'true') === 'true';
const QUERY_PRODUCTS = (process.env.QUERY_PRODUCTS || 'true') === 'true';
const QUERY_OFFERS = (process.env.QUERY_OFFERS || 'true') === 'true';

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
 * Get the d-tag value from an event's tags
 */
function getDTag(event: NostrEvent): string | null {
  const dTag = event.tags.find(tag => tag[0] === 'd');
  return dTag ? dTag[1] : null;
}

/**
 * Find existing replaceable event in DynamoDB by [kind, pubkey, d-tag]
 */
async function findExistingReplaceableEvent(event: NostrEvent): Promise<any | null> {
  try {
    // Only for replaceable events (kind 30000-39999)
    if (event.kind < 30000 || event.kind >= 40000) {
      return null;
    }

    const dTag = getDTag(event);
    if (!dTag) {
      console.warn(`Replaceable event ${event.id} missing d-tag`);
      return null;
    }

    // Scan DynamoDB to find events with same [kind, pubkey, d-tag]
    const result = await docClient.send(new ScanCommand({
      TableName: DYNAMODB_TABLE_NAME,
      FilterExpression: '#kind = :kind AND pubkey = :pubkey',
      ExpressionAttributeNames: {
        '#kind': 'kind',
      },
      ExpressionAttributeValues: {
        ':kind': event.kind,
        ':pubkey': event.pubkey,
      },
    }));

    // Find event with matching d-tag
    const existingEvent = (result.Items || []).find(item => {
      const existingDTag = (item.tags as string[][]).find(tag => tag[0] === 'd');
      return existingDTag && existingDTag[1] === dTag;
    });

    return existingEvent || null;
  } catch (error) {
    console.error(`Error finding existing replaceable event:`, error);
    return null;
  }
}

/**
 * Find existing kind 0 (profile) event in DynamoDB by pubkey.
 * Kind 0 is replaceable per NIP-01; only the latest per pubkey should be stored.
 */
async function findExistingKind0Event(pubkey: string): Promise<NostrEvent | null> {
  try {
    const result = await docClient.send(new ScanCommand({
      TableName: DYNAMODB_TABLE_NAME,
      FilterExpression: '#kind = :kind AND pubkey = :pubkey',
      ExpressionAttributeNames: {
        '#kind': 'kind',
      },
      ExpressionAttributeValues: {
        ':kind': 0,
        ':pubkey': pubkey,
      },
    }));

    const items = (result.Items || []) as NostrEvent[];
    if (items.length === 0) return null;
    // Keep the event with the latest created_at
    return items.reduce((latest, item) =>
      item.created_at > latest.created_at ? item : latest
    );
  } catch (error) {
    console.error(`Error finding existing kind 0 event for pubkey ${pubkey.substring(0, 8)}...:`, error);
    return null;
  }
}

/**
 * Check if an event already exists in DynamoDB and if it's newer
 */
async function shouldStoreEvent(event: NostrEvent): Promise<{ shouldStore: boolean; oldEventId?: string }> {
  try {
    // For kind 0 (profile), replaceable per NIP-01: one per pubkey, keep latest
    if (event.kind === 0) {
      const existingEvent = await findExistingKind0Event(event.pubkey);
      if (!existingEvent) {
        return { shouldStore: true };
      }
      if (event.created_at > existingEvent.created_at) {
        return { shouldStore: true, oldEventId: existingEvent.id };
      }
      return { shouldStore: false };
    }

    // For replaceable events (kind 30000-39999), check by [kind, pubkey, d-tag]
    if (event.kind >= 30000 && event.kind < 40000) {
      const existingEvent = await findExistingReplaceableEvent(event);
      
      if (!existingEvent) {
        return { shouldStore: true };
      }

      // Only store if new event is newer
      if (event.created_at > existingEvent.created_at) {
        return { shouldStore: true, oldEventId: existingEvent.id };
      } else {
        return { shouldStore: false };
      }
    }

    // For non-replaceable events, check by event ID
    const result = await docClient.send(new GetCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { id: event.id },
    }));

    if (!result.Item) {
      return { shouldStore: true };
    }

    // Check if new event is newer than existing one
    const existingCreatedAt = result.Item.created_at as number;
    return { shouldStore: event.created_at > existingCreatedAt };
  } catch (error) {
    console.error(`Error checking event ${event.id}:`, error);
    return { shouldStore: true }; // On error, try to store anyway
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

    // Deduplicate events (kind 0 by pubkey, replaceable by [kind, pubkey, d-tag], others by id)
    const eventMap = buildEventMap(events);
    console.log(`Processing ${eventMap.size} unique events...`);

    // Store events in DynamoDB (skip if dryRun)
    if (dryRun) {
      console.log(`⚠️ DRY RUN: Would process ${eventMap.size} events (not storing)`);
      stats.eventsRetrieved = eventMap.size;
    } else {
      for (const [key, event] of eventMap.entries()) {
        try {
          const { shouldStore, oldEventId } = await shouldStoreEvent(event);
          
          if (shouldStore) {
            // Delete old replaceable event if it exists
            if (oldEventId && oldEventId !== event.id) {
              await docClient.send(new DeleteCommand({
                TableName: DYNAMODB_TABLE_NAME,
                Key: { id: oldEventId },
              }));
              console.log(`Deleted old event ${oldEventId.substring(0, 8)}... (replaced by ${event.id.substring(0, 8)}...)`);
              stats.eventsUpdated++;
            } else if (oldEventId) {
              // Same event ID, just updating
              stats.eventsUpdated++;
            } else {
              // New event
              stats.eventsStored++;
            }
            
            await storeEvent(event);
            console.log(`Stored event ${event.id.substring(0, 8)}... (kind:${event.kind})`);
          } else {
            stats.eventsSkipped++;
            console.log(`Skipped event ${event.id.substring(0, 8)}... (older version)`);
          }
        } catch (error) {
          console.error(`Error storing event ${event.id}:`, error);
          stats.relayErrors.push(`Failed to store event ${event.id}: ${error}`);
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

    // Step 3: Query products (kind:30402) for known food establishments
    let productStats: QueryStats | null = null;
    
    if (QUERY_PRODUCTS && profileStats.eventsRetrieved > 0) {
      console.log('\n=== STEP 3: Querying products for food establishments ===');
      
      // Get all food establishment pubkeys from DynamoDB
      const pubkeys = await getFoodEstablishmentPubkeys();
      
      if (pubkeys.length > 0) {
        const productFilter: Filter = {
          kinds: [30402],
          authors: pubkeys,
          limit: MAX_EVENTS_PER_RELAY,
        };
        
        productStats = await queryNostrRelays(productFilter, 'products', dryRun);
      } else {
        console.log('No food establishment pubkeys found, skipping products query');
      }
    } else if (!QUERY_PRODUCTS) {
      console.log('\n=== STEP 3: Products query disabled (QUERY_PRODUCTS=false) ===');
    } else {
      console.log('\n=== STEP 3: Skipping products (no profiles retrieved) ===');
    }

    // Step 4: Query offers (kind:31556) for known food establishments
    let offerStats: QueryStats | null = null;
    
    if (QUERY_OFFERS && profileStats.eventsRetrieved > 0) {
      console.log('\n=== STEP 4: Querying offers for food establishments ===');
      
      // Get all food establishment pubkeys from DynamoDB
      const pubkeys = await getFoodEstablishmentPubkeys();
      
      if (pubkeys.length > 0) {
        const offerFilter: Filter = {
          kinds: [31556],
          authors: pubkeys,
          limit: MAX_EVENTS_PER_RELAY,
        };
        
        offerStats = await queryNostrRelays(offerFilter, 'offers', dryRun);
      } else {
        console.log('No food establishment pubkeys found, skipping offers query');
      }
    } else if (!QUERY_OFFERS) {
      console.log('\n=== STEP 4: Offers query disabled (QUERY_OFFERS=false) ===');
    } else {
      console.log('\n=== STEP 4: Skipping offers (no profiles retrieved) ===');
    }

    // Combine statistics
    const combinedStats: QueryStats = {
      eventsRetrieved: profileStats.eventsRetrieved + (collectionStats?.eventsRetrieved || 0) + (productStats?.eventsRetrieved || 0) + (offerStats?.eventsRetrieved || 0),
      eventsStored: profileStats.eventsStored + (collectionStats?.eventsStored || 0) + (productStats?.eventsStored || 0) + (offerStats?.eventsStored || 0),
      eventsUpdated: profileStats.eventsUpdated + (collectionStats?.eventsUpdated || 0) + (productStats?.eventsUpdated || 0) + (offerStats?.eventsUpdated || 0),
      eventsSkipped: profileStats.eventsSkipped + (collectionStats?.eventsSkipped || 0) + (productStats?.eventsSkipped || 0) + (offerStats?.eventsSkipped || 0),
      relayErrors: [...profileStats.relayErrors, ...(collectionStats?.relayErrors || []), ...(productStats?.relayErrors || []), ...(offerStats?.relayErrors || [])],
      duration: profileStats.duration + (collectionStats?.duration || 0) + (productStats?.duration || 0) + (offerStats?.duration || 0),
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
    
    if (productStats) {
      console.log('Products:');
      console.log(`  - Retrieved: ${productStats.eventsRetrieved}`);
      console.log(`  - Stored (new): ${productStats.eventsStored}`);
      console.log(`  - Updated: ${productStats.eventsUpdated}`);
      console.log(`  - Duration: ${productStats.duration}ms`);
    }
    
    if (offerStats) {
      console.log('Offers:');
      console.log(`  - Retrieved: ${offerStats.eventsRetrieved}`);
      console.log(`  - Stored (new): ${offerStats.eventsStored}`);
      console.log(`  - Updated: ${offerStats.eventsUpdated}`);
      console.log(`  - Duration: ${offerStats.duration}ms`);
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
          products: productStats,
          offers: offerStats,
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

