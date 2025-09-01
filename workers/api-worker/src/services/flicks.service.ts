// workers/api-worker/src/services/flicks.service.ts
// Complete FlicksService with Smart Feed Implementation

import { nanoid } from 'nanoid';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';

interface FlicksFeedResult {
  flicks: any[];
  total: number;
  hasMore: boolean;
}

export class FlicksService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace,
    private accountId: string,
    private customerCode: string,
    private streamApiToken: string
  ) {}

  async generateUploadUrl(title?: string, description?: string) {
    const videoId = nanoid();
    const oneTimeUploadUrl = `https://upload.cloudflarestream.com/${this.customerCode}/${videoId}`;
    
    return {
      uploadUrl: oneTimeUploadUrl,
      videoId: videoId,
      provider: 'cloudflare',
      expiresIn: 3600, // 1 hour
      instructions: {
        maxSizeMB: 200,
        acceptedFormats: ['mp4', 'mov', 'avi', 'webm'],
      },
      metadata: {
        title: title || '',
        description: description || ''
      }
    };
  }

  async registerFlick(userId: string, data: {
    videoId: string;
    title: string;
    description?: string;
    hashtags?: string[];
    showOnProfile?: boolean;
    enableComments?: boolean;
    skipProcessingWait?: boolean;
  }) {
    return this.createFlick(userId, {
      videoId: data.videoId,
      title: data.title,
      description: data.description,
      hashtags: data.hashtags
    });
  }

  async reportFlick(flickId: string, reporterId: string, reason: string, description?: string) {
    const reportId = nanoid();
    await this.db.prepare(`
      INSERT INTO reports (
        id, type, target_id, reporter_id, reason, description, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reportId,
      'flick',
      flickId,
      reporterId,
      reason,
      description || null,
      'pending',
      new Date().toISOString()
    ).run();

    return { success: true, reportId };
  }

  async createFlick(userId: string, data: {
    videoId: string;
    title: string;
    description?: string;
    hashtags?: string[];
  }) {
    const flickId = nanoid();
    const now = new Date().toISOString();
    
    // Get video details from Stream
    const videoResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${data.videoId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.streamApiToken}`,
        },
      }
    );

    if (!videoResponse.ok) {
      throw new Error('Video not found');
    }

    const videoData :any= await videoResponse.json();
    const videoDetails = videoData.result;

    // Get user info
    const user = await this.db.prepare(
      'SELECT username, profile_image FROM users WHERE id = ?'
    ).bind(userId).first();

    // Prepare hashtags
    const hashtags = data.hashtags?.map(tag => 
      tag.startsWith('#') ? tag : `#${tag}`
    ).join(' ') || '';

    // Insert flick
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
      hashtags,
      data.videoId,
      videoDetails.duration,
      `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.jpg`,
      `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.gif`,
      `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.m3u8`,
      `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.mpd`,
      'active',
      videoDetails.input.width,
      videoDetails.input.height,
      videoDetails.size,
      now,
      now
    ).run();

    // Create analytics entry
    await this.db.prepare(`
      INSERT INTO flick_analytics (flick_id, views, likes, comments, shares, saves, created_at)
      VALUES (?, 0, 0, 0, 0, 0, ?)
    `).bind(flickId, now).run();

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
      duration: videoDetails.duration,
      thumbnail_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.jpg`,
      animated_thumbnail_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/thumbnails/thumbnail.gif`,
      playback_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.m3u8`,
      dash_url: `https://customer-${this.customerCode}.cloudflarestream.com/${data.videoId}/manifest/video.mpd`,
      status: 'active',
      width: videoDetails.input.width,
      height: videoDetails.input.height,
      size: videoDetails.size,
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

  async getSmartFeed(userId: string, page: number = 1, limit: number = 20): Promise<FlicksFeedResult> {
    const offset = (page - 1) * limit;
    
    try {
      // First, get a diverse set of flicks with scoring
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
            u.username,
            u.profile_image,
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
                ELSE 10
              END +
              -- Engagement score
              (COALESCE(fa.views, 0) * 0.1 + 
               COALESCE(fa.likes, 0) * 2 + 
               COALESCE(fa.comments, 0) * 3 + 
               COALESCE(fa.shares, 0) * 4) +
              -- Following boost (show content from people you follow)
              CASE WHEN fw.follower_id IS NOT NULL THEN 200 ELSE 0 END +
              -- Verified user boost
              CASE WHEN u.is_verified = 1 THEN 100 ELSE 0 END +
              -- Random factor to mix things up (0-99)
              (ABS(RANDOM()) % 100)
            ) as feedScore,
            -- Track user's post rank to prevent clustering
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
        WHERE user_post_rank <= 3  -- Max 3 posts per user in the feed batch
        ORDER BY feedScore DESC
        LIMIT ? OFFSET ?
      `;
      
      const flicksData = await this.db.prepare(query)
        .bind(userId, userId, userId, limit * 2, offset) // Fetch extra to ensure diversity
        .all();

      if (!flicksData.results || flicksData.results.length === 0) {
        return { flicks: [], total: 0, hasMore: false };
      }

      // Diversify the results to prevent same-user clustering
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
      // Fallback to regular feed
      return this.getFeed(userId, page, limit);
    }
  }

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
    
    // If we have many users, ensure variety
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

  async getFeed(userId: string, page: number = 1, limit: number = 20): Promise<FlicksFeedResult> {
    // Default to smart feed
    return this.getSmartFeed(userId, page, limit);
  }

  async getUserFlicks(targetUserId: string, currentUserId: string, page: number = 1, limit: number = 20): Promise<FlicksFeedResult> {
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

  async getSavedFlicks(userId: string, page: number = 1, limit: number = 20): Promise<FlicksFeedResult> {
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

      if (!savedFlicks.results || savedFlicks.results.length === 0) {
        return {
          flicks: [],
          total: 0,
          hasMore: false,
        };
      }

      const hasMore = savedFlicks.results.length > limit;
      const flicks = savedFlicks.results.slice(0, limit).map((flick: any) => {
        const formatted = this.formatFlick(flick);
        return {
          ...formatted,
          savedAt: flick.savedAt,
        };
      });

      return {
        flicks,
        total: flicks.length,
        hasMore,
      };
    } catch (error) {
      console.error('Error in getSavedFlicks:', error);
      throw error;
    }
  }

  async getTrendingFlicks(page: number = 1, limit: number = 20): Promise<FlicksFeedResult> {
    const offset = (page - 1) * limit;
    const cacheKey = `trending:flicks:${page}:${limit}`;
    
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as any;
    }

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
      
      let trendingData = await this.db.prepare(query).bind(limit + 1, offset).all();
      
      if (!trendingData.results || trendingData.results.length === 0) {
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
      }

      if (!trendingData.results) {
        return {
          flicks: [],
          total: 0,
          hasMore: false,
        };
      }

      const hasMore = trendingData.results.length > limit;
      const flicks = trendingData.results.slice(0, limit).map((flick: any) => this.formatFlick(flick));

      const result = {
        flicks,
        total: flicks.length,
        hasMore,
      };

      if (flicks.length > 0) {
        await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
      }

      return result;
    } catch (error) {
      console.error('Database error in getTrendingFlicks:', error);
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

    return { success: true };
  }

  private formatFlick(flick: any) {
    return {
      _id: flick.id,
      videoUrl: flick.playback_url || flick.video_url,
      title: flick.title || '',
      description: flick.description || '',
      hashtags: flick.hashtags ? flick.hashtags.split(' ').filter(Boolean) : [],
      likesCount: flick.likesCount || 0,
      isLiked: !!flick.isLiked,
      isSaved: !!flick.isSaved,
      isFollowing: !!flick.isFollowing,
      commentsCount: flick.commentsCount || 0,
      views: flick.views || 0,
      duration: flick.duration || 0,
      streamVideoId: flick.stream_video_id,
      thumbnailUrl: flick.thumbnail_url,
      animatedThumbnailUrl: flick.animated_thumbnail_url,
      createdAt: flick.created_at,
      user: {
        uid: flick.user_id,
        username: flick.username || 'anonymous',
        profileImage: flick.profile_image || '',
        isVerified: !!flick.is_verified,
        followersCount: flick.followers_count || 0,
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