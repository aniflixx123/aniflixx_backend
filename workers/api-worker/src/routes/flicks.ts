// workers/api-worker/src/routes/flicks.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { FlicksService } from '../services/flicks.service';
import { AnalyticsService } from '../services/analytics.service';

type Variables = {
  user: {
    id: string;
    email: string;
    username: string;
  };
};

const flicksRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const uploadUrlSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  hashtags: z.array(z.string()).max(10).optional(),
});

const registerFlickSchema = z.object({
  videoId: z.string(),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  hashtags: z.string().optional(),
});

// Initialize services
const getServices = (env: Env) => ({
  flicks: new FlicksService(env.DB, env.CACHE, env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_STREAM_CUSTOMER_CODE),
  analytics: new AnalyticsService(env.DB, env.VIEWER_TRACKER),
});

// Generate upload URL
flicksRouter.post('/upload-url', async (c) => {
  const user = c.get('user');
  const services = getServices(c.env);

  try {
    const body = await c.req.json();
    const data:any = uploadUrlSchema.parse(body);

    const result = await services.flicks.generateUploadUrl(user.id, data);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ 
        success: false, 
        error: 'Invalid request data',
        details: error.errors 
      }, 400);
    }
    console.error('Upload URL generation failed:', error);
    return c.json({ success: false, error: 'Failed to generate upload URL' }, 500);
  }
});

// Register flick after upload
flicksRouter.post('/register', async (c) => {
  const user = c.get('user');
  const services = getServices(c.env);

  try {
    const body = await c.req.json();
    const data :any= registerFlickSchema.parse(body);

    const flick = await services.flicks.registerFlick(user.id, data);

    return c.json({
      success: true,
      data: {
        flickId: flick.id,
        message: 'Flick uploaded successfully',
        flick: {
          id: flick.id,
          title: flick.title,
          thumbnail: flick.thumbnail_url,
          duration: flick.duration,
        },
      },
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ 
        success: false, 
        error: 'Invalid request data',
        details: error.errors 
      }, 400);
    }
    console.error('Flick registration failed:', error);
    return c.json({ success: false, error: 'Failed to register flick' }, 500);
  }
});

// Update the trending endpoint in flicks.ts with more logging:

// Get trending flicks
flicksRouter.get('/trending', async (c) => {
  console.log('📊 Trending endpoint called');
  const user = c.get('user');
  console.log('👤 User requesting trending:', user.id, user.username);
  
  const services = getServices(c.env);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
  console.log('📄 Pagination:', { page, limit });
  
  try {
    console.log('🔄 Calling getTrendingFlicks service method...');
    const result = await services.flicks.getTrendingFlicks(page, limit);
    console.log('✅ Trending flicks result:', {
      flicksCount: result.flicks?.length || 0,
      total: result.total,
      hasMore: result.hasMore
    });

    return c.json({
      success: true,
      data: result.flicks,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching trending flicks:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ success: false, error: 'Failed to load trending flicks' }, 500);
  }
});
// Get saved flicks
// Update your /saved endpoint with logging:

// Get saved flicks
flicksRouter.get('/saved', async (c) => {
  console.log('📚 Saved flicks endpoint called');
  const user = c.get('user');
  console.log('👤 User requesting saved flicks:', user.id, user.username);
  
  const services = getServices(c.env);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 50);
  console.log('📄 Pagination:', { page, limit });

  try {
    console.log('🔄 Calling getSavedFlicks service method...');
    const result = await services.flicks.getSavedFlicks(user.id, page, limit);
    console.log('✅ Saved flicks result:', {
      flicksCount: result.flicks?.length || 0,
      total: result.total,
      hasMore: result.hasMore
    });
    
    if (result.flicks && result.flicks.length > 0) {
      console.log('🎬 First saved flick:', result.flicks[0]);
    }

    return c.json({
      success: true,
      data: result.flicks,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching saved flicks:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    return c.json({ success: false, error: 'Failed to load saved flicks' }, 500);
  }
});

// Get flicks feed
flicksRouter.get('/', async (c) => {
  const user = c.get('user');
  const services = getServices(c.env);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

  try {
    const result = await services.flicks.getFeed(user.id, page, limit);

    return c.json({
      success: true,
      data: result.flicks,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('Error fetching flicks:', error);
    return c.json({ success: false, error: 'Failed to load flicks' }, 500);
  }
});

// Get user's uploaded flicks
flicksRouter.get('/user/:userId', async (c) => {
  const currentUser = c.get('user');
  const targetUserId = c.req.param('userId');
  const services = getServices(c.env);
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

  try {
    const result = await services.flicks.getUserFlicks(targetUserId, currentUser.id, page, limit);

    return c.json({
      success: true,
      data: result.flicks,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('Error fetching user flicks:', error);
    return c.json({ success: false, error: 'Failed to load user flicks' }, 500);
  }
});

// Get single flick
flicksRouter.get('/:flickId', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    const flick = await services.flicks.getFlickById(flickId, user.id);

    if (!flick) {
      return c.json({ success: false, error: 'Flick not found' }, 404);
    }

    return c.json({
      success: true,
      data: flick,
    });
  } catch (error) {
    console.error('Error fetching flick:', error);
    return c.json({ success: false, error: 'Failed to load flick' }, 500);
  }
});

// Like/unlike flick
flicksRouter.post('/:flickId/like', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    const result = await services.flicks.toggleLike(flickId, user.id);

    // Update counters via Durable Object
    const id = c.env.FLICK_COUNTERS.idFromName(flickId);
    const obj = c.env.FLICK_COUNTERS.get(id);
    
    await obj.fetch(new Request(`http://internal/${result.liked ? 'increment' : 'decrement'}`, {
      method: 'POST',
      body: JSON.stringify({ field: 'likes' }),
    }));

    return c.json({
      success: true,
      data: {
        liked: result.liked,
        message: result.liked ? 'Flick liked' : 'Flick unliked',
      },
    });
  } catch (error) {
    console.error('Error liking flick:', error);
    return c.json({ success: false, error: 'Failed to like flick' }, 500);
  }
});

// Save/unsave flick
flicksRouter.post('/:flickId/save', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    const result = await services.flicks.toggleSave(flickId, user.id);

    return c.json({
      success: true,
      data: {
        saved: result.saved,
        message: result.saved ? 'Flick saved' : 'Flick unsaved',
      },
    });
  } catch (error) {
    console.error('Error saving flick:', error);
    return c.json({ success: false, error: 'Failed to save flick' }, 500);
  }
});

// Track view
flicksRouter.post('/:flickId/view', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    const body = await c.req.json();
    const { duration, watchTime } = body;

    await services.analytics.trackView(flickId, user.id, {
      duration: duration || 0,
      watchTime: watchTime || 0,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error tracking view:', error);
    return c.json({ success: false, error: 'Failed to track view' }, 500);
  }
});

// Delete flick
flicksRouter.delete('/:flickId', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    await services.flicks.deleteFlick(flickId, user.id);

    return c.json({
      success: true,
      data: {
        message: 'Flick deleted successfully',
      },
    });
  } catch (error:any) {
    console.error('Error deleting flick:', error);
    return c.json({ success: false, error: error.message || 'Failed to delete flick' }, 500);
  }
});

// Report flick
flicksRouter.post('/:flickId/report', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  const services = getServices(c.env);

  try {
    const body = await c.req.json();
    const { reason, description } = body;

    if (!reason) {
      return c.json({ success: false, error: 'Reason is required' }, 400);
    }

    await services.flicks.reportFlick(flickId, user.id, reason, description);

    return c.json({
      success: true,
      data: {
        message: 'Flick reported successfully',
      },
    });
  } catch (error) {
    console.error('Error reporting flick:', error);
    return c.json({ success: false, error: 'Failed to report flick' }, 500);
  }
});

// Viewer tracking endpoints
flicksRouter.post('/:flickId/viewers/register', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  
  try {
    const body = await c.req.json();
    const { sessionId } = body;

    // Register viewer in Durable Object
    const id = c.env.VIEWER_TRACKER.idFromName(flickId);
    const obj = c.env.VIEWER_TRACKER.get(id);
    
    const response = await obj.fetch(new Request('http://internal/register', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, sessionId }),
    }));

    const data = await response.json();

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error registering viewer:', error);
    return c.json({ success: false, error: 'Failed to register viewer' }, 500);
  }
});

flicksRouter.post('/:flickId/viewers/heartbeat', async (c) => {
  const flickId = c.req.param('flickId');
  
  try {
    const body = await c.req.json();
    const { sessionId } = body;

    // Update heartbeat in Durable Object
    const id = c.env.VIEWER_TRACKER.idFromName(flickId);
    const obj = c.env.VIEWER_TRACKER.get(id);
    
    const response = await obj.fetch(new Request('http://internal/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }));

    const data = await response.json();

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error updating heartbeat:', error);
    return c.json({ success: false, error: 'Failed to update heartbeat' }, 500);
  }
});

flicksRouter.post('/:flickId/viewers/deregister', async (c) => {
  const flickId = c.req.param('flickId');
  
  try {
    const body = await c.req.json();
    const { sessionId } = body;

    // Deregister viewer in Durable Object
    const id = c.env.VIEWER_TRACKER.idFromName(flickId);
    const obj = c.env.VIEWER_TRACKER.get(id);
    
    const response = await obj.fetch(new Request('http://internal/deregister', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }));

    const data = await response.json();

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error deregistering viewer:', error);
    return c.json({ success: false, error: 'Failed to deregister viewer' }, 500);
  }
});

export { flicksRouter };