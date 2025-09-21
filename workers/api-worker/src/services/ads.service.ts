// workers/api-worker/src/services/ads.service.ts
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';

export interface AdImpression {
  id: string;
  userId: string;
  adId: string;
  adUnitId: string;
  placement: 'reel' | 'feed' | 'interstitial';
  position?: number;
  sessionId: string;
  deviceType?: string;
  region?: string;
  viewedDuration?: number;
  skipped?: boolean;
  clicked?: boolean;
  createdAt: string;
}

export interface UserAdPreferences {
  userId: string;
  frequencyPreference: 'minimal' | 'normal' | 'maximum';
  categoriesBlocked?: string[];
  lastAdShownAt?: string;
  totalAdsViewed: number;
  totalAdsClicked: number;
  optOut: boolean;
}

export interface AdConfig {
  enabled: boolean;
  nativeAdUnitId?: string;
  interstitialAdUnitId?: string;
  frequency: number;
  newUserGracePeriod: number;
  maxAdsPerSession: number;
  minTimeBetweenAds: number;
}

export interface UserAdStats {
  totalImpressions: number;
  totalClicks: number;
  totalSkips: number;
  averageViewDuration: number;
  lastAdShownAt?: string;
  clickThroughRate: number;
}

export class AdsService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace
  ) {}

  async trackImpression(data: Partial<AdImpression>): Promise<AdImpression> {
    const id = nanoid();
    
    await this.db.prepare(`
      INSERT INTO ad_impressions (
        id, user_id, ad_id, ad_unit_id, placement, position,
        session_id, device_type, region, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      id,
      data.userId,
      data.adId,
      data.adUnitId,
      data.placement,
      data.position || 0,
      data.sessionId,
      data.deviceType || 'unknown',
      data.region || 'unknown'
    ).run();

    // Update user stats
    await this.updateUserAdStats(data.userId!);

    return { 
      ...data, 
      id,
      createdAt: new Date().toISOString()
    } as AdImpression;
  }

  async updateUserAdStats(userId: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO user_ad_preferences (
        user_id, total_ads_viewed, last_ad_shown_at, created_at, updated_at
      )
      VALUES (?, 1, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        total_ads_viewed = total_ads_viewed + 1,
        last_ad_shown_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(userId).run();
    
    // Clear cache to reflect new stats
    await this.cache.delete(`ad_prefs:${userId}`);
  }

  async getUserAdPreferences(userId: string): Promise<UserAdPreferences | null> {
    const cacheKey = `ad_prefs:${userId}`;
    
    // Check cache first
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as UserAdPreferences;
    }

    // Get from database
    const prefs = await this.db.prepare(`
      SELECT 
        user_id,
        frequency_preference,
        categories_blocked,
        last_ad_shown_at,
        total_ads_viewed,
        total_ads_clicked,
        opt_out
      FROM user_ad_preferences 
      WHERE user_id = ?
    `).bind(userId).first();

    if (prefs) {
      const formatted: UserAdPreferences = {
        userId: prefs.user_id as string,
        frequencyPreference: (prefs.frequency_preference as 'minimal' | 'normal' | 'maximum') || 'normal',
        categoriesBlocked: prefs.categories_blocked ? JSON.parse(prefs.categories_blocked as string) : [],
        lastAdShownAt: prefs.last_ad_shown_at as string,
        totalAdsViewed: (prefs.total_ads_viewed as number) || 0,
        totalAdsClicked: (prefs.total_ads_clicked as number) || 0,
        optOut: prefs.opt_out === 1
      };
      
      // Cache for 5 minutes
      await this.cache.put(cacheKey, JSON.stringify(formatted), {
        expirationTtl: 300
      });
      
      return formatted;
    }

    return null;
  }

  async getUserAdStats(userId: string): Promise<UserAdStats> {
    // Get impression stats
    const stats = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_impressions,
        SUM(CASE WHEN clicked = 1 THEN 1 ELSE 0 END) as total_clicks,
        SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) as total_skips,
        AVG(viewed_duration) as avg_view_duration,
        MAX(created_at) as last_ad_shown
      FROM ad_impressions
      WHERE user_id = ?
    `).bind(userId).first();

    const totalImpressions = (stats?.total_impressions as number) || 0;
    const totalClicks = (stats?.total_clicks as number) || 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    return {
      totalImpressions,
      totalClicks,
      totalSkips: (stats?.total_skips as number) || 0,
      averageViewDuration: (stats?.avg_view_duration as number) || 0,
      lastAdShownAt: stats?.last_ad_shown as string,
      clickThroughRate: Math.round(ctr * 100) / 100
    };
  }

  async getAdFrequency(userId: string): Promise<number> {
    // Get user preferences
    const prefs = await this.getUserAdPreferences(userId);
    
    // Get base configuration
    const config = await this.getAdConfig();
    const baseFrequency = config?.frequency || 10;
    
    if (!prefs) {
      // New user - use grace period frequency
      return config?.newUserGracePeriod || 15;
    }

    // Check if user recently saw an ad (within 2 minutes)
    if (prefs.lastAdShownAt) {
      const lastAdTime = new Date(prefs.lastAdShownAt).getTime();
      const timeSinceLastAd = Date.now() - lastAdTime;
      
      // If less than minimum time between ads, increase frequency temporarily
      const minTime = (config?.minTimeBetweenAds || 120) * 1000;
      if (timeSinceLastAd < minTime) {
        return Math.min(baseFrequency * 2, 30);
      }
    }

    // Adjust based on user preference
    switch (prefs.frequencyPreference) {
      case 'minimal':
        return Math.floor(baseFrequency * 1.5); // Show less frequently
      case 'maximum':
        return Math.max(Math.floor(baseFrequency * 0.7), 5); // Show more frequently, but not too often
      case 'normal':
      default:
        return baseFrequency;
    }
  }

  async getAdConfig(): Promise<AdConfig | null> {
    // Check cache first
    const cacheKey = 'ad_config:active';
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as AdConfig;
    }

    // Get from database
    const result = await this.db.prepare(`
      SELECT config 
      FROM ad_config 
      WHERE is_active = 1 
      ORDER BY created_at DESC 
      LIMIT 1
    `).first();

    if (result && result.config) {
      const config = JSON.parse(result.config as string);
      
      // Cache for 1 hour
      await this.cache.put(cacheKey, JSON.stringify(config), {
        expirationTtl: 3600
      });
      
      return config;
    }

    // Return default configuration if none exists
    return {
      enabled: false,
      frequency: 10,
      newUserGracePeriod: 15,
      maxAdsPerSession: 10,
      minTimeBetweenAds: 120,
      nativeAdUnitId: undefined,
      interstitialAdUnitId: undefined
    };
  }

  async updateAdConfig(config: Partial<AdConfig>): Promise<void> {
    const id = nanoid();
    const configJson = JSON.stringify(config);
    
    // Deactivate all existing configs
    await this.db.prepare(`
      UPDATE ad_config 
      SET is_active = 0 
      WHERE is_active = 1
    `).run();
    
    // Insert new config
    await this.db.prepare(`
      INSERT INTO ad_config (
        id, name, config, is_active, target_percentage, created_at
      ) VALUES (?, ?, ?, 1, 100, datetime('now'))
    `).bind(
      id,
      'Config Update ' + new Date().toISOString(),
      configJson
    ).run();
    
    // Clear cache
    await this.cache.delete('ad_config:active');
  }
}