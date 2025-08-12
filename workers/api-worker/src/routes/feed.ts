// workers/api-worker/src/routes/feed.ts

import { Hono } from 'hono';
import type { Env } from '../types';
import { FeedService } from '../services/feed.service';

// FIX: Define the Variables type
type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get home feed (personalized for logged-in users, trending for anonymous)
router.get('/home', async (c) => {
  try {
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    
    let result;
    if (user) {
      result = await feedService.getHomeFeed(user.id, page, limit);
    } else {
      // For anonymous users, show trending
      result = await feedService.getTrendingFeed('24h', page, limit);
    }
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field instead of 'posts'
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get home feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get home feed',
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

// Get following feed (posts from users you follow)
router.get('/following', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ 
        success: false, 
        error: 'Authentication required',
        data: []  // FIX: Include empty data array
      }, 401);
    }
    
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getFollowingFeed(user.id, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get following feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get following feed',
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

// Get trending feed
router.get('/trending', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const timeframe = c.req.query('timeframe') || '24h';
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getTrendingFeed(timeframe, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get trending feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get trending feed',
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

// Get discover/explore feed (personalized recommendations)
router.get('/discover', async (c) => {
  try {
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getDiscoverFeed(user?.id, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get discover feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get discover feed',
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

// Get clan feed
router.get('/clan/:clanId', async (c) => {
  try {
    const clanId = c.req.param('clanId');
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    // Check if clan exists and is accessible
    const clan = await c.env.DB.prepare(
      'SELECT id, is_active, is_private FROM clans WHERE id = ?'
    ).bind(clanId).first();
    
    if (!clan || !clan.is_active) {
      return c.json({ 
        success: false, 
        error: 'Clan not found or inactive',
        data: []  // FIX: Include empty data array
      }, 404);
    }
    
    // If clan is private, check membership
    if (clan.is_private && user) {
      const membership = await c.env.DB.prepare(
        'SELECT 1 FROM clan_members WHERE clan_id = ? AND user_id = ?'
      ).bind(clanId, user.id).first();
      
      if (!membership) {
        return c.json({ 
          success: false, 
          error: 'You must be a member to view this clan\'s posts',
          data: []  // FIX: Include empty data array
        }, 403);
      }
    } else if (clan.is_private && !user) {
      return c.json({ 
        success: false, 
        error: 'Authentication required to view private clan',
        data: []  // FIX: Include empty data array
      }, 401);
    }
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getClanFeed(clanId, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get clan feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get clan feed',
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

export { router as feedRouter };