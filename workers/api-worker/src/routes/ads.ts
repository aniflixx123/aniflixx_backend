// workers/api-worker/src/routes/ads.ts - FIXED CONFIG ENDPOINT
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
      `).bind(data?.duration || 0, impressionId, user.id).run();
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Update interaction error:', error);
    return c.json({ success: false, error: 'Failed to update interaction' }, 500);
  }
});

// Get user ad stats
adsRouter.get('/stats', async (c) => {
  const user = c.get('user');
  
  try {
    const stats:any = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as totalImpressions,
        SUM(clicked) as totalClicks,
        SUM(skipped) as totalSkips,
        AVG(viewed_duration) as averageViewDuration,
        MAX(created_at) as lastAdShownAt
      FROM ad_impressions
      WHERE user_id = ?
    `).bind(user.id).first();
    
    const clickThroughRate = stats && stats.totalImpressions > 0 
      ? (stats.totalClicks / stats.totalImpressions) * 100 
      : 0;
    
    return c.json({
      success: true,
      data: {
        totalImpressions: stats?.totalImpressions || 0,
        totalClicks: stats?.totalClicks || 0,
        totalSkips: stats?.totalSkips || 0,
        averageViewDuration: stats?.averageViewDuration || 0,
        lastAdShownAt: stats?.lastAdShownAt,
        clickThroughRate: clickThroughRate
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return c.json({ success: false, error: 'Failed to get stats' }, 500);
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

// Get ad configuration for frontend - FIXED VERSION
adsRouter.get('/config', async (c) => {
  const user = c.get('user');
  const service = new AdsService(c.env.DB, c.env.CACHE);
  
  try {
    console.log('[Ads Config] Starting request for user:', user.id);
    
    // Get the config from database
    const configData = await service.getAdConfig();
    console.log('[Ads Config] Config data retrieved:', configData ? 'found' : 'not found');
    
    // Get user preferences
    const userPrefs = await service.getUserAdPreferences(user.id);
    console.log('[Ads Config] User preferences:', userPrefs ? 'found' : 'not found');
    
    // Parse the config properly
    let parsedConfig = null;
    if (configData) {
      parsedConfig = configData;
      console.log('[Ads Config] Parsed config:', {
        enabled: parsedConfig.enabled,
        nativeAdUnitId: parsedConfig.nativeAdUnitId,
        frequency: parsedConfig.frequency
      });
    }
    
    // Check if user has a subscription (with error handling)
    let hasSubscription = false;
    try {
      const subscription = await c.env.DB.prepare(`
  SELECT * FROM user_subscriptions 
  WHERE user_id = ? 
  AND status IN ('active', 'trialing')
  AND (current_period_end IS NULL OR current_period_end > datetime('now'))
  LIMIT 1
`).bind(user.id).first();
      
      hasSubscription = !!subscription;
      console.log('[Ads Config] Subscription check:', hasSubscription ? 'active' : 'none');
    } catch (subError) {
      console.error('[Ads Config] Subscription check failed:', subError);
      // Continue without subscription check - assume no subscription
    }
    
    // Determine if ads should be enabled
    const adsEnabled = !hasSubscription && // No active subscription
                      !userPrefs?.optOut && // User hasn't opted out
                      parsedConfig?.enabled === true; // Config enables ads
    
    console.log('[Ads Config] Ads enabled decision:', {
      hasSubscription,
      userOptOut: userPrefs?.optOut,
      configEnabled: parsedConfig?.enabled,
      finalDecision: adsEnabled
    });
    
    // Build response
    const response = {
      success: true,
      data: {
        enabled: adsEnabled,
        frequency: parsedConfig?.frequency || 10,
        adUnitIds: {
          native: parsedConfig?.nativeAdUnitId || undefined,
          interstitial: parsedConfig?.interstitialAdUnitId || undefined
        },
        isTestUser: false, // Production mode - no test users
        userSegment: userPrefs ? 'returning' : 'new',
        config: {
          maxAdsPerSession: parsedConfig?.maxAdsPerSession || 10,
          minTimeBetweenAds: parsedConfig?.minTimeBetweenAds || 120,
          newUserGracePeriod: parsedConfig?.newUserGracePeriod || 15
        }
      }
    };
    
    console.log('[Ads Config] Final response:', JSON.stringify(response));
    
    return c.json(response);
  } catch (error) {
    console.error('[Ads Config] Error in /config endpoint:', error);
    console.error('[Ads Config] Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    // Return a safe default response instead of 500
    return c.json({ 
      success: true,
      data: {
        enabled: false,
        frequency: 15,
        adUnitIds: {
          native: undefined,
          interstitial: undefined
        },
        isTestUser: false,
        userSegment: 'new',
        config: {
          maxAdsPerSession: 10,
          minTimeBetweenAds: 120,
          newUserGracePeriod: 15
        }
      }
    });
  }
});

export { adsRouter };