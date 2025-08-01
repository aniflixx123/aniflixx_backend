// workers/api-worker/src/middleware/rateLimit.ts

import type { Context, Next } from 'hono';
import type { Env } from '../types';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  try {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;
    
    // Different limits for different endpoints
    let limit = 100; // Default: 100 requests per minute
    let windowMs = 60; // 1 minute in seconds
    
    // Stricter limits for write operations
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (path.includes('/posts')) {
        limit = 10; // 10 posts per minute
      } else if (path.includes('/like') || path.includes('/follow')) {
        limit = 30; // 30 likes/follows per minute
      } else {
        limit = 20; // 20 write operations per minute
      }
    }
    
    const key = `rate_limit:${ip}:${method}:${path}`;
    const current = await c.env.RATE_LIMIT.get(key);
    const count = current ? parseInt(current) : 0;
    
    if (count >= limit) {
      return c.json({ 
        success: false, 
        error: 'Too many requests',
        retryAfter: windowMs
      }, 429);
    }
    
    // Increment counter
    await c.env.RATE_LIMIT.put(key, (count + 1).toString(), {
      expirationTtl: windowMs
    });
    
    // Add rate limit headers
    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', (limit - count - 1).toString());
    c.header('X-RateLimit-Reset', (Date.now() + windowMs * 1000).toString());
    
    await next();
    
  } catch (error) {
    console.error('Rate limit middleware error:', error);
    // Don't block request on rate limit errors
    await next();
  }
}