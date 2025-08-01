// workers/api-worker/src/routes/feed.ts

import { Hono } from 'hono';
import type { Env, Post } from '../types';
import { FeedService } from '../services/feed.service';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get home feed (mix of following + trending)
router.get('/home', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getHomeFeed(user.id, page, limit);
    
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
    console.error('Get home feed error:', error);
    return c.json({ success: false, error: 'Failed to get home feed' }, 500);
  }
});

// Get trending feed (public)
router.get('/trending', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const timeframe = c.req.query('timeframe') || '24h'; // 24h, 7d, 30d
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
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

// Get following feed
router.get('/following', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getFollowingFeed(user.id, page, limit);
    
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
    console.error('Get following feed error:', error);
    return c.json({ success: false, error: 'Failed to get following feed' }, 500);
  }
});

// Get clan feed
router.get('/clan/:clanId', async (c) => {
  try {
    const clanId = c.req.param('clanId');
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    // Check if user is member of clan (if clan is private)
    if (user) {
      const membership = await c.env.DB.prepare(
        'SELECT 1 FROM clan_members WHERE clan_id = ? AND user_id = ?'
      ).bind(clanId, user.id).first();
      
      if (!membership) {
        // Check if clan is public
        const clan = await c.env.DB.prepare(
          'SELECT is_active FROM clans WHERE id = ?'
        ).bind(clanId).first();
        
        if (!clan || !clan.is_active) {
          return c.json({ success: false, error: 'Clan not found or inactive' }, 404);
        }
      }
    }
    
    const feedService = new FeedService(c.env.DB, c.env.CACHE);
    const result = await feedService.getClanFeed(clanId, page, limit);
    
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
    console.error('Get clan feed error:', error);
    return c.json({ success: false, error: 'Failed to get clan feed' }, 500);
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
      data: result.posts,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get discover feed error:', error);
    return c.json({ success: false, error: 'Failed to get discover feed' }, 500);
  }
});

export { router as feedRouter };