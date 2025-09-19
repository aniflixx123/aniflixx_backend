// workers/api-worker/src/routes/ads.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { AdsService } from '../services/ads.service';

type Variables = {
  user: {
    id: string;
    email: string;
    username: string;
  };
};

const adsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Track ad impression
adsRouter.post('/impression', async (c) => {
  const user = c.get('user');
  const service = new AdsService(c.env.DB, c.env.CACHE);
  
  try {
    const body = await c.req.json();
    
    const impression = await service.trackImpression({
      userId: user.id,
      ...body
    });
    
    return c.json({ success: true, data: impression });
  } catch (error) {
    console.error('Track impression error:', error);
    return c.json({ success: false, error: 'Failed to track impression' }, 500);
  }
});

// Update ad interaction (click, skip, etc)
adsRouter.post('/interaction', async (c) => {
  const user = c.get('user');
  
  try {
    const body = await c.req.json();
    const { impressionId, action, data } = body;
    
    if (action === 'click') {
      await c.env.DB.prepare(`
        UPDATE ad_impressions 
        SET clicked = 1 
        WHERE id = ? AND user_id = ?
      `).bind(impressionId, user.id).run();
    } else if (action === 'skip') {
      await c.env.DB.prepare(`
        UPDATE ad_impressions 
        SET skipped = 1, viewed_duration = ?
        WHERE id = ? AND user_id = ?
      `).bind(data.duration || 0, impressionId, user.id).run();
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Update interaction error:', error);
    return c.json({ success: false, error: 'Failed to update interaction' }, 500);
  }
});

// Get user ad preferences
adsRouter.get('/preferences', async (c) => {
  const user = c.get('user');
  const service = new AdsService(c.env.DB, c.env.CACHE);
  
  try {
    const prefs = await service.getUserAdPreferences(user.id);
    const frequency = await service.getAdFrequency(user.id);
    
    return c.json({
      success: true,
      data: {
        preferences: prefs || {
          frequencyPreference: 'normal',
          totalAdsViewed: 0,
          totalAdsClicked: 0,
          optOut: false
        },
        suggestedFrequency: frequency
      }
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    return c.json({ success: false, error: 'Failed to get preferences' }, 500);
  }
});

// Update user ad preferences
adsRouter.put('/preferences', async (c) => {
  const user = c.get('user');
  
  try {
    const body = await c.req.json();
    const { frequencyPreference, categoriesBlocked, optOut } = body;
    
    await c.env.DB.prepare(`
      INSERT INTO user_ad_preferences (
        user_id, frequency_preference, categories_blocked, opt_out
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        frequency_preference = ?,
        categories_blocked = ?,
        opt_out = ?,
        updated_at = datetime('now')
    `).bind(
      user.id,
      frequencyPreference,
      JSON.stringify(categoriesBlocked || []),
      optOut ? 1 : 0,
      frequencyPreference,
      JSON.stringify(categoriesBlocked || []),
      optOut ? 1 : 0
    ).run();
    
    // Clear cache
    await c.env.CACHE.delete(`ad_prefs:${user.id}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Update preferences error:', error);
    return c.json({ success: false, error: 'Failed to update preferences' }, 500);
  }
});

// Get ad configuration for frontend
adsRouter.get('/config', async (c) => {
  const user = c.get('user');
  const service = new AdsService(c.env.DB, c.env.CACHE);
  
  try {
    const config = await service.getAdConfig();
    const userPrefs = await service.getUserAdPreferences(user.id);
    
    // Check if user is in test group
    const isTestUser = user.id.charCodeAt(0) % 10 < 1; // 10% test group
    
    return c.json({
      success: true,
      data: {
        enabled: userPrefs?.optOut ? false : (config?.enabled ?? false),
        frequency: await service.getAdFrequency(user.id),
        adUnitIds: {
          native: config?.nativeAdUnitId,
          interstitial: config?.interstitialAdUnitId
        },
        isTestUser,
        userSegment: userPrefs ? 'returning' : 'new'
      }
    });
  } catch (error) {
    console.error('Get config error:', error);
    return c.json({ success: false, error: 'Failed to get config' }, 500);
  }
});

export { adsRouter };