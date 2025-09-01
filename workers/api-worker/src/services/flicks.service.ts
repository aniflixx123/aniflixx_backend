// workers/api-worker/src/services/flicks.service.ts

import { nanoid } from 'nanoid';
import type { Flick } from '../types';

export class FlicksService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace,
    private accountId: string,
    private apiToken: string,
    private customerCode: string
  ) {}

  async generateUploadUrl(userId: string, data: {
    title: string;
    description?: string;
    hashtags?: string[];
  }) {
    console.log('🎬 Generating upload URL for user:', userId);
    console.log('📊 Request data:', data);
    console.log('🔑 Account ID:', this.accountId);
    console.log('🔐 Has API token:', !!this.apiToken);
    
    const requestBody = {
      maxDurationSeconds: 3600,
      expiry: new Date(Date.now() + 3600000).toISOString(),
      requireSignedURLs: false,
      thumbnailTimestampPct: 0.1,
      meta: {
        userId,
        title: data.title,
        description: data.description,
        uploadedAt: new Date().toISOString(),
      },
    };
    
    console.log('📤 Request URL:', `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/direct_upload`);
    
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/direct_upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('📥 Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Cloudflare Stream API error:', {
        status: response.status,
        error: errorText
      });
      
      throw new Error('Failed to generate upload URL');
    }

    const result = await response.json() as any;
    console.log('✅ Upload URL generated successfully');

    return {
      uploadUrl: result.result.uploadURL,
      videoId: result.result.uid,
      provider: 'cloudflare-stream',
      expiresIn: 3600,
      instructions: {
        method: 'POST',
        formFields: { file: 'your-video-file' },
      },
    };
  }
  
  async registerFlick(userId: string, data: {
  videoId: string;
  title: string;
  description?: string;
  hashtags?: string;
  skipProcessingWait?: boolean;
}): Promise<Flick> {
  let videoDetails;
  
  // Check if we should skip waiting for video processing
  if (data.skipProcessingWait) {
    // Just get current video status without waiting
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${data.videoId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      }
    );
    
    if (response.ok) {
      const result = await response.json() as any;
      videoDetails = result.result;
    }
    
    // Use defaults if video isn't ready yet
    if (!videoDetails || !videoDetails.duration) {
      videoDetails = {
        duration: 0,
        input: { width: 1920, height: 1080 },
        size: 0,
        status: { state: 'processing' }
      };
    }
  } else {
    // Original logic - wait for video to be ready
    videoDetails = await this.waitForVideoReady(data.videoId);
  }

  // Get user info
  const user = await this.db.prepare(
    'SELECT username, profile_image FROM users WHERE id = ?'
  ).bind(userId).first<{ username: string; profile_image: string | null }>();

  // Process hashtags
  const hashtags = this.extractHashtags(data.hashtags || '');

  // Create flick record
  const flickId = nanoid();
  const now = new Date().toISOString();

  await this.db.prepare(`
    INSERT INTO flicks (
      id, user_id, username, profile_image, title, description, hashtags,
      stream_video_id, duration, thumbnail_url, animated_thumbnail_url,
      playback_url, dash_url, status, width, height, size,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    flickId,
    userId,
    user?.username || 'anonymous',
    user?.profile_image || null,
    data.title,
    data.description || null,
    JSON.stringify(hashtags),
    data.videoId,
    videoDetails.duration || 0,
    `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.jpg`,
    `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.gif`,
    `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.m3u8`,
    `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.mpd`,
    'active',
    videoDetails.input?.width || 1920,
    videoDetails.input?.height || 1080,
    videoDetails.size || 0,
    now,
    now
  ).run();

  // Create analytics record
  await this.db.prepare(`
    INSERT INTO flick_analytics (flick_id, views, likes, comments, shares, saves)
    VALUES (?, 0, 0, 0, 0, 0)
  `).bind(flickId).run();

  // Clear user's flicks cache
  await this.cache.delete(`user_flicks:${userId}`);

  return {
    id: flickId,
    user_id: userId,
    username: user?.username || 'anonymous',
    profile_image: user?.profile_image || null,
    title: data.title,
    description: data.description || null,
    hashtags,
    stream_video_id: data.videoId,
    duration: videoDetails.duration || 0,
    thumbnail_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.jpg`,
    animated_thumbnail_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.gif`,
    playback_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.m3u8`,
    dash_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.mpd`,
    status: 'active',
    width: videoDetails.input?.width || 1920,
    height: videoDetails.input?.height || 1080,
    size: videoDetails.size || 0,
    created_at: now,
    updated_at: now,
  };
}

  async getFlickById(flickId: string, userId?: string) {
    const flick = await this.db.prepare(`
      SELECT 
        f.*,
        fa.views, fa.likes as likesCount, fa.comments as commentsCount,
        fa.shares, fa.saves as savesCount,
        CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
        CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END as isSaved,
        u.is_verified, u.followers_count, u.bio
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
      LEFT JOIN flick_saves s ON f.id = s.flick_id AND s.user_id = ?
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.id = ? AND f.status = 'active'
    `).bind(userId || '', userId || '', flickId).first<any>();

    if (!flick) {
      return null;
    }

    return this.formatFlick(flick);
  }

  async getSavedFlicks(userId: string, page: number = 1, limit: number = 20) {
    console.log('🔖 getSavedFlicks called for user:', userId);
    const offset = (page - 1) * limit;

    try {
      const savedFlicks = await this.db.prepare(`
        SELECT 
          f.*,
          fa.views, fa.likes as likesCount, fa.comments as commentsCount,
          1 as isSaved,
          CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
          u.is_verified,
          s.created_at as savedAt
        FROM flick_saves s
        JOIN flicks f ON s.flick_id = f.id
        LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
        LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
        LEFT JOIN users u ON f.user_id = u.id
        WHERE s.user_id = ? AND f.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `).bind(userId, userId, limit + 1, offset).all();

      console.log('📦 Saved flicks query result:', {
        success: savedFlicks.success,
        count: savedFlicks.results?.length || 0
      });

      if (!savedFlicks.results || savedFlicks.results.length === 0) {
        console.log('⚠️ No saved flicks found');
        return {
          flicks: [],
          total: 0,
          hasMore: false,
        };
      }

      const hasMore = savedFlicks.results.length > limit;
      
      const flicks = savedFlicks.results.slice(0, limit).map((flick: any) => {
        console.log('🎬 Processing saved flick:', {
          id: flick.id,
          title: flick.title,
          thumbnail: flick.thumbnail_url?.substring(0, 50)
        });
        
        const formatted = this.formatFlick(flick);
        
        console.log('✅ Formatted saved flick:', {
          _id: formatted._id,
          thumbnailUrl: formatted.thumbnailUrl?.substring(0, 50)
        });
        
        return {
          ...formatted,
          savedAt: flick.savedAt,
        };
      });

      console.log('✅ Returning saved flicks:', {
        count: flicks.length,
        hasMore
      });

      return {
        flicks,
        total: flicks.length,
        hasMore,
      };
    } catch (error) {
      console.error('❌ Error in getSavedFlicks:', error);
      throw error;
    }
  }

  async getUserFlicks(targetUserId: string, currentUserId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    const flicksData = await this.db.prepare(`
      SELECT 
        f.*,
        fa.views, fa.likes as likesCount, fa.comments as commentsCount,
        CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
        CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END as isSaved,
        u.is_verified
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
      LEFT JOIN flick_saves s ON f.id = s.flick_id AND s.user_id = ?
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.user_id = ? AND f.status = 'active'
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(currentUserId, currentUserId, targetUserId, limit + 1, offset).all();

    const hasMore = flicksData.results.length > limit;
    
    const flicks = flicksData.results.slice(0, limit).map((flick: any) => this.formatFlick(flick));

    return {
      flicks,
      total: flicks.length,
      hasMore,
    };
  }
  // SMART FEED ALGORITHM - Enhanced feed with diversity
async getSmartFeed(userId: string, page: number = 1, limit: number = 20): Promise<{
  flicks: any[];
  total: number;
  hasMore: boolean;
}> {
  const offset = (page - 1) * limit;
  
  try {
    // This query creates a smart feed with:
    // 1. Recency boost (newer content scores higher)
    // 2. Engagement metrics (likes, comments, shares matter)
    // 3. Following preference (content from people you follow)
    // 4. Verified creator boost
    // 5. Random mixing to keep it fresh
    // 6. Limits per user to prevent spam
    
    const query = `
      WITH RankedFlicks AS (
        SELECT 
          f.*,
          fa.views, 
          fa.likes as likesCount, 
          fa.comments as commentsCount,
          fa.shares, 
          fa.saves as savesCount,
          CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
          CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END as isSaved,
          CASE WHEN fw.follower_id IS NOT NULL THEN 1 ELSE 0 END as isFollowing,
          u.is_verified,
          u.followers_count,
          u.bio,
          -- Calculate relevance score
          (
            -- Recency score (newer = higher)
            CASE 
              WHEN f.created_at >= datetime('now', '-1 hour') THEN 1000
              WHEN f.created_at >= datetime('now', '-6 hours') THEN 500
              WHEN f.created_at >= datetime('now', '-24 hours') THEN 200
              WHEN f.created_at >= datetime('now', '-3 days') THEN 50
              WHEN f.created_at >= datetime('now', '-7 days') THEN 20
              ELSE 10
            END +
            -- Engagement score
            (
              COALESCE(fa.views, 0) * 0.1 + 
              COALESCE(fa.likes, 0) * 2 + 
              COALESCE(fa.comments, 0) * 3 + 
              COALESCE(fa.shares, 0) * 4 +
              COALESCE(fa.saves, 0) * 2
            ) +
            -- Following boost (show content from people you follow)
            CASE WHEN fw.follower_id IS NOT NULL THEN 200 ELSE 0 END +
            -- Verified user boost
            CASE WHEN u.is_verified = 1 THEN 100 ELSE 0 END +
            -- Popular creator boost (based on follower count)
            CASE 
              WHEN u.followers_count > 10000 THEN 150
              WHEN u.followers_count > 1000 THEN 75
              WHEN u.followers_count > 100 THEN 30
              ELSE 0
            END +
            -- Random factor to mix things up (0-99)
            (ABS(RANDOM()) % 100)
          ) as feedScore,
          -- Track user's post rank to prevent one user dominating feed
          ROW_NUMBER() OVER (PARTITION BY f.user_id ORDER BY f.created_at DESC) as user_post_rank
        FROM flicks f
        LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
        LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
        LEFT JOIN flick_saves s ON f.id = s.flick_id AND s.user_id = ?
        LEFT JOIN follows fw ON f.user_id = fw.following_id AND fw.follower_id = ?
        LEFT JOIN users u ON f.user_id = u.id
        WHERE f.status = 'active'
      )
      SELECT * FROM RankedFlicks
      WHERE user_post_rank <= 3  -- Max 3 posts per user in each batch
      ORDER BY feedScore DESC
      LIMIT ? OFFSET ?
    `;
    
    console.log('🚀 Executing smart feed query for user:', userId);
    
    const flicksData = await this.db.prepare(query)
      .bind(userId, userId, userId, limit * 2, offset) // Fetch extra for diversity
      .all();

    if (!flicksData.success) {
      console.error('Smart feed query failed:', flicksData.error);
      // Fallback to basic feed
      return this.getBasicFeed(userId, page, limit);
    }

    if (!flicksData.results || flicksData.results.length === 0) {
      console.log('No flicks found in smart feed');
      return { flicks: [], total: 0, hasMore: false };
    }

    console.log(`Smart feed found ${flicksData.results.length} flicks`);

    // Diversify the results
    const diversified = this.diversifyFeed(flicksData.results, limit);
    
    // Format the flicks
    const flicks = diversified.map((flick: any) => this.formatFlick(flick));

    return {
      flicks,
      total: flicks.length,
      hasMore: flicksData.results.length >= limit
    };
  } catch (error) {
    console.error('Error in getSmartFeed:', error);
    // Fallback to basic chronological feed
    return this.getBasicFeed(userId, page, limit);
  }
}

// Diversify feed to prevent same-user clustering
private diversifyFeed(flicks: any[], targetLimit: number): any[] {
  if (flicks.length <= 3) return flicks.slice(0, targetLimit);
  
  const result: any[] = [];
  const userQueues = new Map<string, any[]>();
  const userLastShown = new Map<string, number>();
  
  // Group flicks by user
  for (const flick of flicks) {
    const userId = flick.user_id;
    if (!userQueues.has(userId)) {
      userQueues.set(userId, []);
    }
    userQueues.get(userId)!.push(flick);
  }
  
  // Calculate minimum gap between same user's posts
  const minGapBetweenSameUser = Math.max(2, Math.floor(userQueues.size / 2));
  
  let position = 0;
  
  // First pass: Add one flick from each user
  for (const [userId, queue] of userQueues) {
    if (queue.length > 0 && result.length < targetLimit) {
      result.push(queue.shift());
      userLastShown.set(userId, position);
      position++;
    }
  }
  
  // Second pass: Add remaining flicks with spacing
  while (result.length < targetLimit) {
    let added = false;
    
    for (const [userId, queue] of userQueues) {
      if (queue.length === 0) continue;
      
      const lastShown = userLastShown.get(userId) || -999;
      const gap = position - lastShown;
      
      // Only add if we've shown enough other content
      if (gap >= minGapBetweenSameUser && result.length < targetLimit) {
        result.push(queue.shift());
        userLastShown.set(userId, position);
        position++;
        added = true;
      }
    }
    
    // If we couldn't add with spacing rules, relax them
    if (!added) {
      for (const [userId, queue] of userQueues) {
        if (queue.length > 0 && result.length < targetLimit) {
          result.push(queue.shift());
          position++;
          break;
        }
      }
      // If still nothing to add, we're done
      if (result.length === position - 1) break;
    }
  }
  
  return result;
}

// Basic feed fallback (chronological)
async getBasicFeed(userId: string, page: number = 1, limit: number = 20): Promise<{
  flicks: any[];
  total: number;
  hasMore: boolean;
}> {
  const offset = (page - 1) * limit;

  console.log('📱 Using basic chronological feed as fallback');

  const flicksData = await this.db.prepare(`
    SELECT 
      f.*,
      fa.views, fa.likes as likesCount, fa.comments as commentsCount,
      fa.shares, fa.saves as savesCount,
      CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
      CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END as isSaved,
      u.is_verified,
      CASE WHEN fw.follower_id IS NOT NULL THEN 1 ELSE 0 END as isFollowing
    FROM flicks f
    LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
    LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
    LEFT JOIN flick_saves s ON f.id = s.flick_id AND s.user_id = ?
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN follows fw ON f.user_id = fw.following_id AND fw.follower_id = ?
    WHERE f.status = 'active'
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(userId, userId, userId, limit + 1, offset).all();

  const hasMore = flicksData.results.length > limit;
  const flicks = flicksData.results.slice(0, limit).map((flick: any) => this.formatFlick(flick));

  return { flicks, total: flicks.length, hasMore };
}

// Main feed method - uses smart feed
async getFeed(userId: string, page: number = 1, limit: number = 20): Promise<{
  flicks: any[];
  total: number;
  hasMore: boolean;
}> {
  // Always try smart feed first, it has fallback built in
  return this.getSmartFeed(userId, page, limit);
}

  async getTrendingFlicks(page: number = 1, limit: number = 20) {
    console.log('🔥 getTrendingFlicks called with:', { page, limit });
    const offset = (page - 1) * limit;

    const cacheKey = `trending:flicks:${page}:${limit}`;
    console.log('📦 Checking cache with key:', cacheKey);
    
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      console.log('✅ Cache hit! Returning cached data');
      const cachedData = cached as any;
      if (cachedData && cachedData.flicks && cachedData.flicks.length > 0) {
        return cachedData;
      }
      console.log('⚠️ Cache had empty data, fetching fresh...');
      await this.cache.delete(cacheKey);
    }
    console.log('❌ Cache miss, fetching from database');

    try {
      let query = `
        SELECT 
          f.*,
          fa.views, fa.likes as likesCount, fa.comments as commentsCount,
          fa.shares, fa.saves as savesCount,
          u.is_verified,
          (
            fa.views * 0.1 + 
            fa.likes * 1 + 
            fa.comments * 2 + 
            fa.shares * 3 + 
            fa.saves * 2 +
            CASE WHEN f.created_at >= datetime('now', '-24 hours') THEN 100 ELSE 0 END +
            CASE WHEN f.created_at >= datetime('now', '-3 days') THEN 50 ELSE 0 END
          ) as trendingScore
        FROM flicks f
        LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
        LEFT JOIN users u ON f.user_id = u.id
        WHERE f.status = 'active' 
          AND f.created_at >= datetime('now', '-7 days')
        ORDER BY trendingScore DESC, f.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      console.log('🔍 Executing trending query (last 7 days)...');
      let trendingData = await this.db.prepare(query).bind(limit + 1, offset).all();
      
      console.log('📊 Recent flicks found:', trendingData.results?.length || 0);
      
      if (!trendingData.results || trendingData.results.length === 0) {
        console.log('⚠️ No recent flicks found, fetching all active flicks...');
        
        query = `
          SELECT 
            f.*,
            fa.views, fa.likes as likesCount, fa.comments as commentsCount,
            fa.shares, fa.saves as savesCount,
            u.is_verified,
            (
              fa.views * 0.1 + 
              fa.likes * 1 + 
              fa.comments * 2 + 
              fa.shares * 3 + 
              fa.saves * 2
            ) as trendingScore
          FROM flicks f
          LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
          LEFT JOIN users u ON f.user_id = u.id
          WHERE f.status = 'active'
          ORDER BY trendingScore DESC, fa.views DESC, f.created_at DESC
          LIMIT ? OFFSET ?
        `;
        
        trendingData = await this.db.prepare(query).bind(limit + 1, offset).all();
        console.log('📊 All active flicks found:', trendingData.results?.length || 0);
      }

      if (!trendingData.results) {
        console.error('⚠️ No results array in database response');
        return {
          flicks: [],
          total: 0,
          hasMore: false,
        };
      }

      const hasMore = trendingData.results.length > limit;
      const flicks = trendingData.results.slice(0, limit).map((flick: any) => {
        console.log('🎬 Processing flick:', {
          id: flick.id,
          title: flick.title,
          views: flick.views,
          likes: flick.likesCount,
          hasThumb: !!flick.thumbnail_url
        });
        return this.formatFlick(flick);
      });

      const result = {
        flicks,
        total: flicks.length,
        hasMore,
      };

      if (flicks.length > 0) {
        console.log('💾 Caching result for 5 minutes');
        await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
      }

      console.log('✅ Returning trending flicks:', {
        count: flicks.length,
        hasMore
      });

      return result;
    } catch (error) {
      console.error('❌ Database error in getTrendingFlicks:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      
      return {
        flicks: [],
        total: 0,
        hasMore: false,
      };
    }
  }

  async toggleLike(flickId: string, userId: string) {
    const existing = await this.db.prepare(
      'SELECT id FROM flick_likes WHERE flick_id = ? AND user_id = ?'
    ).bind(flickId, userId).first();

    if (existing) {
      await this.db.prepare(
        'DELETE FROM flick_likes WHERE flick_id = ? AND user_id = ?'
      ).bind(flickId, userId).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET likes = likes - 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      return { liked: false };
    } else {
      await this.db.prepare(
        'INSERT INTO flick_likes (id, flick_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(nanoid(), flickId, userId, new Date().toISOString()).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET likes = likes + 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      const flick = await this.db.prepare(
        'SELECT user_id, title FROM flicks WHERE id = ?'
      ).bind(flickId).first();

      if (flick && flick.user_id !== userId) {
        await this.createNotification(
          flick.user_id as string,
          userId,
          'flick_like',
          'flick',
          flickId,
          `liked your flick "${flick.title}"`
        );
      }

      return { liked: true };
    }
  }

  async toggleSave(flickId: string, userId: string) {
    const existing = await this.db.prepare(
      'SELECT id FROM flick_saves WHERE flick_id = ? AND user_id = ?'
    ).bind(flickId, userId).first();

    if (existing) {
      await this.db.prepare(
        'DELETE FROM flick_saves WHERE flick_id = ? AND user_id = ?'
      ).bind(flickId, userId).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET saves = saves - 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      return { saved: false };
    } else {
      await this.db.prepare(
        'INSERT INTO flick_saves (id, flick_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(nanoid(), flickId, userId, new Date().toISOString()).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET saves = saves + 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      return { saved: true };
    }
  }

  async deleteFlick(flickId: string, userId: string) {
    const flick = await this.db.prepare(
      'SELECT user_id, stream_video_id FROM flicks WHERE id = ? AND status = ?'
    ).bind(flickId, 'active').first<{ user_id: string; stream_video_id: string }>();

    if (!flick) {
      throw new Error('Flick not found');
    }

    if (flick.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    await this.db.prepare(
      'UPDATE flicks SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('deleted', new Date().toISOString(), flickId).run();

    await this.cache.delete(`flick:${flickId}`);
    await this.cache.delete(`user_flicks:${userId}`);

    if (flick.stream_video_id) {
      try {
        await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${flick.stream_video_id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
            },
          }
        );
      } catch (error) {
        console.error('Error deleting from Cloudflare Stream:', error);
      }
    }
  }

  async reportFlick(flickId: string, userId: string, reason: string, description?: string) {
    const flick = await this.db.prepare(
      'SELECT id FROM flicks WHERE id = ? AND status = ?'
    ).bind(flickId, 'active').first();

    if (!flick) {
      throw new Error('Flick not found');
    }

    await this.db.prepare(`
      INSERT INTO reports (
        id, type, target_id, reporter_id, reason, 
        description, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      'flick',
      flickId,
      userId,
      reason,
      description || null,
      'pending',
      new Date().toISOString()
    ).run();
  }

  private async waitForVideoReady(videoId: string, maxAttempts: number = 60): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${videoId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json() as any;
        const videoDetails = data.result;
        
        if (videoDetails.status.state === 'ready') {
          return videoDetails;
        } else if (videoDetails.status.state === 'error') {
          throw new Error('Video processing failed');
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Video processing timeout');
  }

  private extractHashtags(hashtagString: string): string[] {
    if (!hashtagString) return [];
    return hashtagString
      .trim()
      .split(/\s+/)
      .filter(tag => tag.startsWith('#') && tag.length > 1)
      .slice(0, 10);
  }

  private formatFlick(flick: any) {
  // Parse the counts properly - SQLite returns strings sometimes
  const likesCount = parseInt(flick.likesCount || flick.likes_count || '0');
  const commentsCount = parseInt(flick.commentsCount || flick.comments_count || '0');
  const savesCount = parseInt(flick.savesCount || flick.saves_count || '0');
  const views = parseInt(flick.views || '0');
  
  return {
    _id: flick.id,
    videoUrl: flick.playback_url,
    title: flick.title || '',
    description: flick.description || '',
    hashtags: JSON.parse(flick.hashtags || '[]'),
    
    // CRITICAL: These must be numbers and booleans
    likesCount: likesCount,
    commentsCount: commentsCount,  // This was missing proper parsing
    savesCount: savesCount,
    views: views,
    
    // SQLite returns 1/0 for booleans, convert properly
    isLiked: flick.isLiked === 1 || flick.isLiked === '1' || flick.isLiked === true,
    isSaved: flick.isSaved === 1 || flick.isSaved === '1' || flick.isSaved === true,
    isFollowing: flick.isFollowing === 1 || flick.isFollowing === '1' || flick.isFollowing === true,
    
    duration: parseFloat(flick.duration || '0'),
    streamVideoId: flick.stream_video_id,
    thumbnailUrl: flick.thumbnail_url,
    animatedThumbnailUrl: flick.animated_thumbnail_url,
    createdAt: flick.created_at,
    
    // User data
    user: {
      uid: flick.user_id,
      username: flick.username || 'anonymous',
      profileImage: flick.profile_image || '',
      isVerified: flick.is_verified === 1 || flick.is_verified === '1' || flick.is_verified === true,
      followersCount: parseInt(flick.followers_count || '0'),
      bio: flick.bio || '',
    },
  };
}

  private async createNotification(
    recipientId: string,
    senderId: string,
    type: string,
    targetType: string,
    targetId: string,
    message: string
  ) {
    await this.db.prepare(`
      INSERT INTO notifications (
        id, recipient_id, sender_id, type, target_type, target_id,
        message, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      recipientId,
      senderId,
      type,
      targetType,
      targetId,
      message,
      0,
      new Date().toISOString()
    ).run();
  }
}