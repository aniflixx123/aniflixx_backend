// workers/api-worker/src/routes/analytics.ts

import { Hono } from 'hono';
import type { Env } from '../types';
import { AnalyticsService } from '../services/analytics.service';

type Variables = {
  user: {
    id: string;
    email: string;
    username: string;
  };
};

const analyticsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Initialize service
const getAnalyticsService = (env: Env) => new AnalyticsService(env.DB, env.VIEWER_TRACKER);

// Get analytics for user's flicks
analyticsRouter.get('/flicks', async (c) => {
  const user = c.get('user');
  const analyticsService = getAnalyticsService(c.env);
  
  const period = c.req.query('period') || '7d'; // 7d, 30d, all
  const flickId = c.req.query('flickId'); // Optional: specific flick

  try {
    const data = await analyticsService.getFlicksAnalytics(user.id, period, flickId);

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return c.json({ success: false, error: 'Failed to load analytics' }, 500);
  }
});

// Get real-time stats
analyticsRouter.get('/realtime', async (c) => {
  const user = c.get('user');
  const analyticsService = getAnalyticsService(c.env);

  try {
    const data = await analyticsService.getRealtimeStats(user.id);

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching realtime stats:', error);
    return c.json({ success: false, error: 'Failed to load realtime stats' }, 500);
  }
});

// Track engagement event
analyticsRouter.post('/track', async (c) => {
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const { flickId, event, data } = body;

    // Validate event type
    const validEvents = [
      'view_start',
      'view_end',
      'like',
      'unlike',
      'comment',
      'share',
      'save',
      'unsave',
    ];

    if (!validEvents.includes(event)) {
      return c.json({ success: false, error: 'Invalid event type' }, 400);
    }

    // Log the event (you could send this to a separate analytics service)
    console.log('Analytics event:', {
      userId: user.id,
      flickId,
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    // For specific events, update analytics
    if (event === 'share' && flickId) {
      await c.env.DB.prepare(
        'UPDATE flick_analytics SET shares = shares + 1 WHERE flick_id = ?'
      ).bind(flickId).run();
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error tracking event:', error);
    return c.json({ success: false, error: 'Failed to track event' }, 500);
  }
});

// Get trending hashtags
analyticsRouter.get('/trending/hashtags', async (c) => {
  const analyticsService = getAnalyticsService(c.env);
  const period = c.req.query('period') || '7d';

  try {
    const hashtags = await analyticsService.getTrendingHashtags(period);

    return c.json({
      success: true,
      data: {
        trending: hashtags,
        period,
      },
    });
  } catch (error) {
    console.error('Error fetching trending hashtags:', error);
    return c.json({ success: false, error: 'Failed to load trending hashtags' }, 500);
  }
});

// Get trending flicks
analyticsRouter.get('/trending/flicks', async (c) => {
  const analyticsService = getAnalyticsService(c.env);
  const period = c.req.query('period') || '24h';
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);

  try {
    const flicks = await analyticsService.getTrendingFlicks(period, limit);

    return c.json({
      success: true,
      data: flicks,
    });
  } catch (error) {
    console.error('Error fetching trending flicks:', error);
    return c.json({ success: false, error: 'Failed to load trending flicks' }, 500);
  }
});

// Get user engagement stats
analyticsRouter.get('/users/:userId/engagement', async (c) => {
  const analyticsService = getAnalyticsService(c.env);
  const userId = c.req.param('userId');
  const period = c.req.query('period') || '30d';

  try {
    const stats = await analyticsService.getUserEngagementStats(userId, period);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching user engagement:', error);
    return c.json({ success: false, error: 'Failed to load user engagement' }, 500);
  }
});

export { analyticsRouter };