import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initializeServer, type ResponseFormatter } from '../dist/server-shared.js';

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
  // Try to get real IP from various headers (Vercel sets these)
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

  // Clean up old entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }

  if (!entry || entry.resetTime < now) {
    // New window or expired entry
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

// V1 formatter - structured data in both content (serialized JSON) and structuredContent
const v1Formatter: ResponseFormatter = (result) => {
  return {
    structuredContent: result.structuredData,
    content: [
      {
        type: "text",
        text: JSON.stringify(result.structuredData, null, 2),
      },
    ],
    ...(result.meta && { _meta: result.meta }),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Rate limiting
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit(clientId);

  // Set rate limit headers (standard format)
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
    const { transport } = await initializeServer(v1Formatter);
    if (!transport) {
      return res.status(500).json({ error: 'Server not initialized' });
    }

    // Vercel already parses JSON bodies, so req.body is available
    // The StreamableHTTPServerTransport expects Node.js request/response objects
    // Vercel's request/response objects are compatible with Node.js IncomingMessage/ServerResponse
    await transport.handleRequest(req as any, res as any, req.body);
  } catch (error) {
    console.error('Error handling request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

