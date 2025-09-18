// workers/api-worker/src/index.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { postsRouter } from './routes/posts';
import { usersRouter } from './routes/users';
import { feedRouter } from './routes/feed';
import { socialRouter } from './routes/social';
import { flicksRouter } from './routes/flicks';
import { commentsRouter } from './routes/comments';
import { analyticsRouter } from './routes/analytics';
import { mediaRouter } from './routes/media';
import { postCommentsRouter } from './routes/postComments';
import { clansRouter } from './routes/clans';
import { paymentsRouter } from './routes/payments';
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
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
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

// Public trending endpoints
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

// Public trending flicks endpoint
app.get('/api/flicks/trending', async (c) => {
  const { FlicksService } = await import('./services/flicks.service');
  const flicksService = new FlicksService(
    c.env.DB, 
    c.env.CACHE,
    c.env.CLOUDFLARE_ACCOUNT_ID,
    c.env.CLOUDFLARE_API_TOKEN,
    c.env.CLOUDFLARE_STREAM_CUSTOMER_CODE
  );
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  
  try {
    const result = await flicksService.getTrendingFlicks(page, limit);
    
    return c.json({
      success: true,
      data: result.flicks,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Get trending flicks error:', error);
    return c.json({ success: false, error: 'Failed to get trending flicks' }, 500);
  }
});

// Public clan endpoints (some clan endpoints should be public)
app.get('/api/clans/discover', async (c) => {
  const { ClanService } = await import('./services/clan.service');
  const clanService = new ClanService(c.env.DB, c.env.CACHE);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  
  try {
    const result = await clanService.discoverClans({
      page,
      limit,
      userId: undefined // Public discovery
    });
    
    return c.json({
      success: true,
      clans: result.clans,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Discover clans error:', error);
    return c.json({ success: false, error: 'Failed to discover clans' }, 500);
  }
});

app.get('/api/clans/trending', async (c) => {
  const { ClanService } = await import('./services/clan.service');
  const clanService = new ClanService(c.env.DB, c.env.CACHE);
  
  const timeframe = c.req.query('timeframe') || 'week';
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
  
  try {
    const result = await clanService.getTrendingClans(timeframe, limit);
    
    return c.json({
      success: true,
      clans: result.clans
    });
  } catch (error) {
    console.error('Get trending clans error:', error);
    return c.json({ success: false, error: 'Failed to fetch trending clans' }, 500);
  }
});

// Public clan details (allow viewing clan details without auth)
app.get('/api/clans/:id', async (c) => {
  const { ClanService } = await import('./services/clan.service');
  const clanService = new ClanService(c.env.DB, c.env.CACHE);
  
  const clanId = c.req.param('id');
  
  try {
    const clan = await clanService.getClanDetails(clanId, undefined);
    
    if (!clan) {
      return c.json({ success: false, error: 'Clan not found' }, 404);
    }
    
    return c.json({
      success: true,
      data: clan
    });
  } catch (error) {
    console.error('Get clan details error:', error);
    return c.json({ success: false, error: 'Failed to fetch clan details' }, 500);
  }
});

// Protected routes - require authentication
app.use('/api/*', authMiddleware);

// Mount routers
app.route('/api/posts', postsRouter);
app.route('/api/users', usersRouter);
app.route('/api/feed', feedRouter);
app.route('/api/social', socialRouter);
app.route('/api/flicks', flicksRouter);
app.route('/api/comments', commentsRouter);
app.route('/api/post-comments', postCommentsRouter);
app.route('/api/analytics', analyticsRouter);
app.route('/api/media', mediaRouter);
app.route('/api/clans', clansRouter);
app.route('/api/payments', paymentsRouter);

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

// Durable Object for flick counters
export class FlickCounter implements DurableObject {
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

// Durable Object for viewer tracking
export class ViewerTracker implements DurableObject {
  state: DurableObjectState;
  viewers: Map<string, { userId: string; lastHeartbeat: number }>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.viewers = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/register':
        return this.handleRegister(request);
      case '/heartbeat':
        return this.handleHeartbeat(request);
      case '/deregister':
        return this.handleDeregister(request);
      case '/count':
        return this.handleCount();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  async handleRegister(request: Request): Promise<Response> {
    try {
      const { userId, sessionId } = await request.json() as any;
      
      this.cleanupStaleViewers();
      
      this.viewers.set(sessionId, {
        userId,
        lastHeartbeat: Date.now(),
      });

      await this.state.storage.put('viewers', Array.from(this.viewers.entries()));

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to register viewer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleHeartbeat(request: Request): Promise<Response> {
    try {
      const { sessionId } = await request.json() as any;
      
      const viewer = this.viewers.get(sessionId);
      if (viewer) {
        viewer.lastHeartbeat = Date.now();
        await this.state.storage.put('viewers', Array.from(this.viewers.entries()));
      }

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to update heartbeat' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleDeregister(request: Request): Promise<Response> {
    try {
      const { sessionId } = await request.json() as any;
      
      this.viewers.delete(sessionId);
      await this.state.storage.put('viewers', Array.from(this.viewers.entries()));

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to deregister viewer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleCount(): Promise<Response> {
    this.cleanupStaleViewers();
    
    return new Response(JSON.stringify({
      count: this.viewers.size,
      viewers: Array.from(this.viewers.values()),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  cleanupStaleViewers() {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    for (const [sessionId, viewer] of this.viewers.entries()) {
      if (now - viewer.lastHeartbeat > timeout) {
        this.viewers.delete(sessionId);
      }
    }
  }

  async initialize() {
    const stored = await this.state.storage.get('viewers');
    if (stored) {
      this.viewers = new Map(stored as any);
      this.cleanupStaleViewers();
    }
  }
}

export default app;