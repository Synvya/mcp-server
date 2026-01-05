/**
 * Reservation State Store
 * Manages reservation request/response state in DynamoDB for multi-instance serverless environments
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Rumor } from '../lib/nip59.js';
import { RESERVATION_TABLE_NAME } from '../config.js';

/**
 * Reservation request stored in DynamoDB
 */
export interface ReservationRequest {
  requestId: string;
  status: 'pending' | 'confirmed' | 'denied';
  createdAt: number;
  expiresAt: number;
  requestData: Record<string, any>;
  responseData?: Rumor;
  responseReceivedAt?: number;
}

/**
 * ReservationStateStore class for managing reservation state in DynamoDB
 */
export class ReservationStateStore {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName?: string) {
    // Use provided table name or get from environment
    this.tableName = tableName || RESERVATION_TABLE_NAME || '';
    
    if (!this.tableName) {
      throw new Error('RESERVATION_TABLE_NAME environment variable is required');
    }
    
    const region = process.env.AWS_REGION || 'us-west-2';
    const dynamoClient = new DynamoDBClient({ region });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    
    console.log(`Initialized ReservationStateStore with table: ${this.tableName} in region: ${region}`);
  }

  /**
   * Create a new pending reservation request in DynamoDB
   */
  async createPendingRequest(
    requestId: string,
    requestData: Record<string, any>
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const item: ReservationRequest = {
      requestId,
      status: 'pending',
      createdAt: now,
      expiresAt: now + 300, // 5 minutes TTL
      requestData,
    };

    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
      }));
      console.log(`✅ Created pending request in DynamoDB: ${requestId.substring(0, 8)}...`);
    } catch (error) {
      console.error(`❌ Failed to create pending request in DynamoDB:`, error);
      throw error;
    }
  }

  /**
   * Get a reservation request from DynamoDB
   */
  async getRequest(requestId: string): Promise<ReservationRequest | null> {
    try {
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { requestId },
      }));

      return (result.Item as ReservationRequest) || null;
    } catch (error) {
      console.error(`❌ Failed to get request from DynamoDB:`, error);
      throw error;
    }
  }

  /**
   * Update a reservation request with the response from the restaurant
   */
  async updateWithResponse(
    requestId: string,
    response: Rumor
  ): Promise<void> {
    const statusTag = response.tags.find(t => t[0] === 'status');
    const status = statusTag?.[1] === 'confirmed' ? 'confirmed' : 'denied';

    try {
      await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { requestId },
        UpdateExpression: 'SET #status = :status, responseData = :responseData, responseReceivedAt = :receivedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':responseData': response,
          ':receivedAt': Math.floor(Date.now() / 1000),
        },
      }));
      console.log(`✅ Updated DynamoDB with ${status} response for ${requestId.substring(0, 8)}...`);
    } catch (error) {
      console.error(`❌ Failed to update request in DynamoDB:`, error);
      throw error;
    }
  }

  /**
   * Wait for a response by polling DynamoDB
   * 
   * @param requestId - The ID of the request rumor (from kind:9901)
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @param pollIntervalMs - How often to check DynamoDB (default: 2000ms)
   * @returns Promise that resolves with the response rumor or rejects on timeout
   */
  async waitForResponse(
    requestId: string,
    timeoutMs: number,
    pollIntervalMs: number = 2000
  ): Promise<Rumor> {
    const startTime = Date.now();
    let pollCount = 0;

    console.log(`⏳ Polling DynamoDB for response to ${requestId.substring(0, 8)}... (timeout: ${timeoutMs}ms)`);

    while (Date.now() - startTime < timeoutMs) {
      pollCount++;
      
      try {
        const request = await this.getRequest(requestId);

        if (!request) {
          console.error(`❌ Request ${requestId.substring(0, 8)}... not found in DynamoDB`);
          throw new Error(`Request ${requestId} not found in state store`);
        }

        if (request.status !== 'pending' && request.responseData) {
          const elapsed = Date.now() - startTime;
          console.log(`✅ Response received for ${requestId.substring(0, 8)}... after ${elapsed}ms (${pollCount} polls)`);
          return request.responseData;
        }

        // Log poll progress every 10 polls
        if (pollCount % 10 === 0) {
          const elapsed = Date.now() - startTime;
          console.log(`⏳ Still waiting for response (${elapsed}ms elapsed, ${pollCount} polls)...`);
        }
      } catch (error) {
        console.error(`Error polling DynamoDB:`, error);
        // Continue polling unless we hit timeout
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.error(`⏱️ Timeout after ${timeoutMs}ms waiting for response to ${requestId.substring(0, 8)}...`);
    throw new Error(`Timeout waiting for response to request ${requestId} after ${timeoutMs}ms`);
  }

  /**
   * Check if a specific request is pending
   */
  async isPending(requestId: string): Promise<boolean> {
    const request = await this.getRequest(requestId);
    return request?.status === 'pending';
  }

  /**
   * Get all pending request IDs (for debugging)
   * Note: This is expensive and should only be used for debugging
   */
  async getPendingRequestIds(): Promise<string[]> {
    // This would require a Scan operation which is expensive
    // For now, we'll just return empty array
    // In production, consider using a GSI if you need to list pending requests
    console.warn('getPendingRequestIds() is not implemented for DynamoDB (requires expensive Scan operation)');
    return [];
  }
}

