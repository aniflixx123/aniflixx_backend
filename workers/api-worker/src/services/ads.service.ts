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

    return { ...data, id } as AdImpression;
  }

  async updateUserAdStats(userId: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO user_ad_preferences (user_id, total_ads_viewed, last_ad_shown_at)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        total_ads_viewed = total_ads_viewed + 1,
        last_ad_shown_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(userId).run();
  }

  async getUserAdPreferences(userId: string): Promise<UserAdPreferences | null> {
    const cacheKey = `ad_prefs:${userId}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) return cached as UserAdPreferences;

    const prefs = await this.db.prepare(`
      SELECT * FROM user_ad_preferences WHERE user_id = ?
    `).bind(userId).first();

    if (prefs) {
      await this.cache.put(cacheKey, JSON.stringify(prefs), {
        expirationTtl: 3600 // 1 hour cache
      });
    }

    return prefs as UserAdPreferences | null;
  }

  async getAdFrequency(userId: string): Promise<number> {
    const prefs = await this.getUserAdPreferences(userId);
    
    if (!prefs) {
      // New user - gentle introduction
      return 15;
    }

    // Check if user recently saw an ad
    if (prefs.lastAdShownAt) {
      const lastAdTime = new Date(prefs.lastAdShownAt).getTime();
      const timeSinceLastAd = Date.now() - lastAdTime;
      
      // If less than 2 minutes since last ad, increase frequency
      if (timeSinceLastAd < 120000) {
        return 20;
      }
    }

    // Based on preference
    switch (prefs.frequencyPreference) {
      case 'minimal': return 20;
      case 'maximum': return 7;
      default: return 10;
    }
  }

  async getAdConfig(): Promise<any> {
    const config = await this.db.prepare(`
      SELECT config FROM ad_config 
      WHERE is_active = 1 
      ORDER BY created_at DESC 
      LIMIT 1
    `).first();

    return config ? JSON.parse(config.config as string) : null;
  }
}