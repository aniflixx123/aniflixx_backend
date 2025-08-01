// workers/api-worker/src/index.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { postsRouter } from './routes/posts';
import { usersRouter } from './routes/users';
import { feedRouter } from './routes/feed';
import { socialRouter } from './routes/social';
import type { Env } from './types';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS configuration
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = [
      'https://aniflixx.com',
      'https://www.aniflixx.com',
      'https://app.aniflixx.com',
      'http://localhost:3000',
      'http://localhost:5173'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      return origin || allowedOrigins[0];
    }
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// Global rate limiting
app.use('*', rateLimitMiddleware);

// Health check (public)
app.get('/', (c) => {
  return c.json({ 
    service: 'aniflixx-api',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Public trending endpoint
app.get('/api/feed/trending', async (c) => {
  const { FeedService } = await import('./services/feed.service');
  const feedService = new FeedService(c.env.DB, c.env.CACHE);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const timeframe = c.req.query('timeframe') || '24h';
  
  try {
    const result = await feedService.getTrendingFeed(timeframe, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Get trending feed error:', error);
    return c.json({ success: false, error: 'Failed to get trending feed' }, 500);
  }
});

// Protected routes - require authentication
app.use('/api/*', authMiddleware);

// Mount routers
app.route('/api/posts', postsRouter);
app.route('/api/users', usersRouter);
app.route('/api/feed', feedRouter);
app.route('/api/social', socialRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ 
    success: false, 
    error: 'Endpoint not found' 
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  
  if (err instanceof Error) {
    return c.json({ 
      success: false, 
      error: err.message 
    }, 500);
  }
  
  return c.json({ 
    success: false, 
    error: 'Internal server error' 
  }, 500);
});

// Durable Object for post counters
export class PostCounter implements DurableObject {
  constructor(private state: DurableObjectState) {}
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === '/increment') {
      const { field } = await request.json() as { field: string };
      const current = await this.state.storage.get<number>(field) || 0;
      await this.state.storage.put(field, current + 1);
      return new Response(JSON.stringify({ count: current + 1 }));
    }
    
    if (path === '/decrement') {
      const { field } = await request.json() as { field: string };
      const current = await this.state.storage.get<number>(field) || 0;
      const newCount = Math.max(0, current - 1);
      await this.state.storage.put(field, newCount);
      return new Response(JSON.stringify({ count: newCount }));
    }
    
    if (path === '/get') {
      const counts = await this.state.storage.list();
      const result: Record<string, number> = {};
      counts.forEach((value, key) => {
        result[key as string] = value as number;
      });
      return new Response(JSON.stringify(result));
    }
    
    return new Response('Not found', { status: 404 });
  }
}

export default app;