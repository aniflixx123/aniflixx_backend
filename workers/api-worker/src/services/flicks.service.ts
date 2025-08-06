// workers/api-worker/src/services/flicks.service.ts

import { nanoid
} from 'nanoid';
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
  }): Promise<Flick> {
    // Wait for video to be ready
    const videoDetails = await this.waitForVideoReady(data.videoId);

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

    // Create analytics record
    await this.db.prepare(`
      INSERT INTO flick_analytics (flick_id, views, likes, comments, shares, saves)
      VALUES (?, 0, 0, 0, 0, 0)
    `).bind(flickId).run();

    // Update user's flicks count
    // await this.db.prepare(
    //   'UPDATE users SET flicks_count = flicks_count + 1 WHERE id = ?'
    // ).bind(userId).run();

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

  async getFeed(userId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    // Try cache first
    const cacheKey = `feed:${userId}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as any;
    }

    // Get flicks with user info and analytics
    const flicksData = await this.db.prepare(`
      SELECT 
        f.*,
        fa.views, fa.likes as likesCount, fa.comments as commentsCount,
        fa.shares, fa.saves as savesCount,
        CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
        CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END as isSaved,
        u.is_verified
      FROM flicks f
      LEFT JOIN flick_analytics fa ON f.id = fa.flick_id
      LEFT JOIN flick_likes l ON f.id = l.flick_id AND l.user_id = ?
      LEFT JOIN flick_saves s ON f.id = s.flick_id AND s.user_id = ?
      LEFT JOIN users u ON f.user_id = u.id
      WHERE f.status = 'active'
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, userId, limit + 1, offset).all();

    const hasMore = flicksData.results.length > limit;
    const flicks = flicksData.results.slice(0, limit).map(this.formatFlick);

    const result = {
      flicks,
      total: flicks.length,
      hasMore,
    };

    // Cache for 1 minute
    await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 });

    return result;
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
    const flicks = flicksData.results.slice(0, limit).map(this.formatFlick);

    return {
      flicks,
      total: flicks.length,
      hasMore,
    };
  }

  async getSavedFlicks(userId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

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

    const hasMore = savedFlicks.results.length > limit;
    const flicks = savedFlicks.results.slice(0, limit).map((flick: any) => ({
      ...this.formatFlick(flick),
      savedAt: flick.savedAt,
    }));

    return {
      flicks,
      total: flicks.length,
      hasMore,
    };
  }

  async toggleLike(flickId: string, userId: string) {
    // Check if already liked
    const existing = await this.db.prepare(
      'SELECT id FROM flick_likes WHERE flick_id = ? AND user_id = ?'
    ).bind(flickId, userId).first();

    if (existing) {
      // Unlike
      await this.db.prepare(
        'DELETE FROM flick_likes WHERE flick_id = ? AND user_id = ?'
      ).bind(flickId, userId).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET likes = likes - 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      return { liked: false };
    } else {
      // Like
      await this.db.prepare(
        'INSERT INTO flick_likes (id, flick_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(nanoid(), flickId, userId, new Date().toISOString()).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET likes = likes + 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      // Create notification
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
    // Check if already saved
    const existing = await this.db.prepare(
      'SELECT id FROM flick_saves WHERE flick_id = ? AND user_id = ?'
    ).bind(flickId, userId).first();

    if (existing) {
      // Unsave
      await this.db.prepare(
        'DELETE FROM flick_saves WHERE flick_id = ? AND user_id = ?'
      ).bind(flickId, userId).run();

      await this.db.prepare(
        'UPDATE flick_analytics SET saves = saves - 1 WHERE flick_id = ?'
      ).bind(flickId).run();

      return { saved: false };
    } else {
      // Save
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
    // Verify ownership
    const flick = await this.db.prepare(
      'SELECT user_id, stream_video_id FROM flicks WHERE id = ? AND status = ?'
    ).bind(flickId, 'active').first<{ user_id: string; stream_video_id: string }>();

    if (!flick) {
      throw new Error('Flick not found');
    }

    if (flick.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    // Soft delete flick
    await this.db.prepare(
      'UPDATE flicks SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('deleted', new Date().toISOString(), flickId).run();

    // Update user's flicks count
    // await this.db.prepare(
    //   'UPDATE users SET flicks_count = flicks_count - 1 WHERE id = ? AND flicks_count > 0'
    // ).bind(userId).run();

    // Clear caches
    await this.cache.delete(`flick:${flickId}`);
    await this.cache.delete(`user_flicks:${userId}`);

    // Optional: Delete from Cloudflare Stream
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
    // Check if flick exists
    const flick = await this.db.prepare(
      'SELECT id FROM flicks WHERE id = ? AND status = ?'
    ).bind(flickId, 'active').first();

    if (!flick) {
      throw new Error('Flick not found');
    }

    // Create report
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

      // Wait 2 seconds before next attempt
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
    return {
      _id: flick.id,
      videoUrl: flick.playback_url,
      title: flick.title || '',
      description: flick.description || '',
      hashtags: JSON.parse(flick.hashtags || '[]'),
      likesCount: flick.likesCount || 0,
      isLiked: !!flick.isLiked,
      isSaved: !!flick.isSaved,
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
   async getTrendingFlicks(page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    // Try cache first
    const cacheKey = `trending:flicks:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as any;
    }

    // Get trending flicks from last 7 days with engagement score
    const trendingData = await this.db.prepare(`
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
      ORDER BY trendingScore DESC
      LIMIT ? OFFSET ?
    `).bind(limit + 1, offset).all();

    const hasMore = trendingData.results.length > limit;
    const flicks = trendingData.results.slice(0, limit).map(this.formatFlick);

    const result = {
      flicks,
      total: flicks.length,
      hasMore,
    };

    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });

    return result;
  }
}