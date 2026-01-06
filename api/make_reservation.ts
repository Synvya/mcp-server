import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  loadProfileData,
  loadCollectionsData,
  loadProductsData,
  loadCalendarData,
  loadTablesData,
  type NostrEvent,
} from '../dist/data-loader.js';
import { makeReservation, type ToolData } from '../dist/tool-handlers.js';

// Rate limiting configuration
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store (resets on cold starts, which is acceptable)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

function getClientIdentifier(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0].trim() 
    : (typeof realIp === 'string' ? realIp : req.socket?.remoteAddress || 'unknown');
  return ip;
}

function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // Clean up old entries periodically
  if (Math.random() < 0.01) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }

  if (!entry || entry.resetTime < now) {
    const resetTime = now + RATE_LIMIT_WINDOW_MS;
    rateLimitStore.set(identifier, { count: 1, resetTime });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: resetTime };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetTime };
  }

  entry.count++;
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, 
    resetAt: entry.resetTime 
  };
}

// Load data with TTL caching (handled by data-loader.ts)
async function loadData() {
  try {
    const profiles = await loadProfileData();
    const collections = await loadCollectionsData();
    const products = await loadProductsData();
    const calendar = await loadCalendarData();
    const tables = await loadTablesData();
    
    console.log("✅ Data loaded for make_reservation:", {
      profiles: profiles.length,
      collections: collections.length,
      products: products.length,
      calendar: calendar.length,
      tables: tables.length,
    });
    
    return { profiles, collections, products, calendar, tables };
  } catch (error) {
    console.error("❌ Failed to load data:", error);
    throw error;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit(clientId);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', new Date(rateLimit.resetAt).toISOString());

  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute.`,
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    });
  }

  try {
    // Load data (uses TTL cache from data-loader.ts)
    const data = await loadData();

    // Parse and validate request body
    const body = req.body || {};
    
    // Validate required fields
    if (!body.restaurant_id || !body.time || !body.party_size || !body.name) {
      return res.status(400).json({
        "@context": "https://schema.org",
        "@type": "ReserveAction",
        "actionStatus": "FailedActionStatus",
        "error": {
          "@type": "Thing",
          "name": "InvalidReservationRequest",
          "description": "Missing required fields: restaurant_id, time, party_size, and name are required",
        },
      });
    }

    // Validate that at least one of telephone or email is provided
    if (!body.telephone && !body.email) {
      return res.status(400).json({
        "@context": "https://schema.org",
        "@type": "ReserveAction",
        "actionStatus": "FailedActionStatus",
        "error": {
          "@type": "Thing",
          "name": "InvalidReservationRequest",
          "description": "At least one of telephone or email must be provided",
        },
      });
    }

    const args: any = {
      restaurant_id: body.restaurant_id,
      time: body.time,
      party_size: Number(body.party_size),
      name: body.name,
    };

    // Only include telephone and email if they are provided
    if (body.telephone) {
      args.telephone = body.telephone;
    }
    if (body.email) {
      args.email = body.email;
    }

    // Call handler
    const result = await makeReservation(args, data);

    // Return appropriate HTTP status code
    const statusCode = result['@type'] === 'FoodEstablishmentReservation' ? 200 : 400;

    // Return JSON response
    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error in make_reservation:', error);
    return res.status(500).json({
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "error": {
        "@type": "Thing",
        "name": "InternalServerError",
        "description": error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

