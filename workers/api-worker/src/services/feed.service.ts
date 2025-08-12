// workers/api-worker/src/services/feed.service.ts - Fixed Version

import type { Post } from '../types';

interface FeedResult {
  posts: Post[];
  total: number;
  hasMore: boolean;
}

export class FeedService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace
  ) {}
  
  // NEW METHOD: Get all public posts (like X's "For You" tab)
  async getPublicFeed(userId: string | undefined, page: number, limit: number): Promise<FeedResult> {
    const cacheKey = `feed:public:${userId || 'anon'}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Get ALL public posts with engagement metrics
    // Similar to X's "For You" algorithm
    const query = `
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        (
          SELECT COUNT(*) FROM post_likes WHERE post_id = p.id
        ) as actual_likes,
        (
          SELECT COUNT(*) FROM post_comments WHERE post_id = p.id
        ) as actual_comments,
        (
          SELECT COUNT(*) FROM post_shares WHERE post_id = p.id
        ) as actual_shares,
        ${userId ? `
          EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
          EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = p.user_id) as is_following
        ` : `
          0 as is_liked,
          0 as is_bookmarked,
          0 as is_following
        `}
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.visibility IN ('public', 'followers')
        AND p.status = 'active'
        AND u.is_active = 1
      ORDER BY 
        -- Boost recent posts with high engagement
        CASE 
          WHEN p.created_at > datetime('now', '-2 hours') THEN 10000
          WHEN p.created_at > datetime('now', '-6 hours') THEN 5000
          WHEN p.created_at > datetime('now', '-24 hours') THEN 1000
          ELSE 0
        END +
        (
          (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) * 10 +
          (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) * 20 +
          (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) * 30
        ) DESC,
        p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    let posts;
    if (userId) {
      posts = await this.db.prepare(query)
        .bind(userId, userId, userId, limit, offset)
        .all();
    } else {
      // For anonymous users, simpler query without user-specific fields
      const anonQuery = `
        SELECT 
          p.*,
          u.username,
          u.profile_image as user_profile_image,
          u.is_verified,
          (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
          (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
          (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) as actual_shares,
          0 as is_liked,
          0 as is_bookmarked,
          0 as is_following
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.visibility = 'public'
          AND p.status = 'active'
          AND u.is_active = 1
        ORDER BY 
          CASE 
            WHEN p.created_at > datetime('now', '-2 hours') THEN 10000
            WHEN p.created_at > datetime('now', '-6 hours') THEN 5000
            WHEN p.created_at > datetime('now', '-24 hours') THEN 1000
            ELSE 0
          END +
          (
            (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) * 10 +
            (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) * 20 +
            (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) * 30
          ) DESC,
          p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      posts = await this.db.prepare(anonQuery).bind(limit, offset).all();
    }
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.visibility IN ('public', 'followers')
        AND p.status = 'active'
        AND u.is_active = 1
    `;
    const countResult = await this.db.prepare(countQuery).first();
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPostsWithMetrics(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 2 minutes (shorter for fresh content)
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 120
    });
    
    return result;
  }
  
  // UPDATED: Home feed now calls public feed (like X)
  async getHomeFeed(userId: string, page: number, limit: number): Promise<FeedResult> {
    // Home feed is now the same as public feed (like X's "For You")
    return this.getPublicFeed(userId, page, limit);
  }
  
  // Keep getTrendingFeed as is (for dedicated trending section if needed)
  async getTrendingFeed(timeframe: string, page: number, limit: number): Promise<FeedResult> {
    const cacheKey = `feed:trending:${timeframe}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Calculate timeframe
    let timeCondition: string;
    switch (timeframe) {
      case '1h':
        timeCondition = "datetime('now', '-1 hour')";
        break;
      case '24h':
        timeCondition = "datetime('now', '-1 day')";
        break;
      case '7d':
        timeCondition = "datetime('now', '-7 days')";
        break;
      case '30d':
        timeCondition = "datetime('now', '-30 days')";
        break;
      default:
        timeCondition = "datetime('now', '-1 day')";
    }
    
    // Get trending posts based on engagement
    const query = `
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
        (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) as actual_shares,
        (
          (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) * 1.0 + 
          (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) * 2.0 + 
          (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) * 3.0
        ) as engagement_score
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.visibility = 'public'
        AND p.created_at > ${timeCondition}
        AND p.status = 'active'
      ORDER BY engagement_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query).bind(limit, offset).all();
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM posts 
      WHERE visibility = 'public' 
        AND created_at > ${timeCondition}
        AND status = 'active'
    `).first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPostsWithMetrics(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 10 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 600
    });
    
    return result;
  }
  
  // Keep getFollowingFeed for "Following" tab (like X)
  async getFollowingFeed(userId: string, page: number, limit: number): Promise<FeedResult> {
    const cacheKey = `feed:following:${userId}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Get posts only from following users (chronological)
    const query = `
      SELECT 
        p.*, 
        u.username, 
        u.profile_image as user_profile_image,
        u.is_verified,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
        (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) as actual_shares,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
        EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
        1 as is_following
      FROM posts p
      JOIN users u ON p.user_id = u.id
      JOIN follows f ON f.following_id = p.user_id AND f.follower_id = ?
      WHERE p.visibility IN ('public', 'followers')
        AND p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query)
      .bind(userId, userId, userId, limit, offset)
      .all();
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM posts p
      JOIN follows f ON f.following_id = p.user_id AND f.follower_id = ?
      WHERE p.visibility IN ('public', 'followers')
        AND p.status = 'active'
    `).bind(userId).first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPostsWithMetrics(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 300
    });
    
    return result;
  }
  
  async getClanFeed(clanId: string, page: number, limit: number): Promise<FeedResult> {
    const cacheKey = `feed:clan:${clanId}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Get posts for specific clan
    const query = `
      SELECT 
        p.*, 
        u.username, 
        u.profile_image as user_profile_image,
        u.is_verified,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
        (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) as actual_shares
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.clan_id = ? 
        AND p.visibility = 'clan'
        AND p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query).bind(clanId, limit, offset).all();
    
    // Get total count
    const countResult = await this.db.prepare(
      'SELECT COUNT(*) as total FROM posts WHERE clan_id = ? AND visibility = ? AND status = ?'
    ).bind(clanId, 'clan', 'active').first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPostsWithMetrics(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 300
    });
    
    return result;
  }
  
  async getDiscoverFeed(userId: string | undefined, page: number, limit: number): Promise<FeedResult> {
    // Discover is similar to public but with more personalization if logged in
    if (!userId) {
      // For anonymous, just show trending
      return this.getTrendingFeed('7d', page, limit);
    }
    
    const offset = (page - 1) * limit;
    
    // Personalized discover based on interests
    const query = `
      WITH user_interactions AS (
        SELECT DISTINCT p.user_id as author_id
        FROM post_likes l
        JOIN posts p ON l.post_id = p.id
        WHERE l.user_id = ?
        UNION
        SELECT following_id as author_id
        FROM follows
        WHERE follower_id = ?
      )
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as actual_likes,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as actual_comments,
        (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) as actual_shares,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
        EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = p.user_id) as is_following,
        CASE 
          WHEN p.user_id IN (SELECT author_id FROM user_interactions) THEN 100
          ELSE 0
        END as relevance_score
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.visibility = 'public'
        AND p.status = 'active'
        AND p.created_at > datetime('now', '-30 days')
      ORDER BY 
        relevance_score DESC,
        (
          (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) * 10 +
          (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) * 20 +
          (SELECT COUNT(*) FROM post_shares WHERE post_id = p.id) * 30
        ) DESC,
        p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query)
      .bind(userId, userId, userId, userId, userId, limit, offset)
      .all();
    
    const total = limit * 10; // Estimate for discover
    
    return {
      posts: this.enrichPostsWithMetrics(posts.results),
      total,
      hasMore: offset + limit < total
    };
  }
  
  // Updated enrichPosts to handle actual counts
  private enrichPostsWithMetrics(rawPosts: any[]): Post[] {
    return rawPosts.map(post => ({
      id: post.id,
      user_id: post.user_id,
      content: post.content,
      media_urls: post.media_urls ? 
        (typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : post.media_urls) 
        : null,
      type: post.type,
      visibility: post.visibility,
      clan_id: post.clan_id,
      status: post.status || 'active',
      // Use actual counts from queries
      likes_count: post.actual_likes || post.likes_count || 0,
      comments_count: post.actual_comments || post.comments_count || 0,
      shares_count: post.actual_shares || post.shares_count || 0,
      created_at: post.created_at,
      updated_at: post.updated_at,
      // User-specific fields
      is_liked: Boolean(post.is_liked),
      is_bookmarked: Boolean(post.is_bookmarked),
      // Additional fields from join
      username: post.username,
      user_profile_image: post.user_profile_image,
      is_verified: Boolean(post.is_verified || post.user?.is_verified),
      is_following: Boolean(post.is_following),
      user: {
        id: post.user_id,
        username: post.username,
        profile_image: post.user_profile_image,
        is_verified: Boolean(post.is_verified)
      }
    }));
  }
  
  private enrichPosts(rawPosts: any[]): Post[] {
    // Fallback for old method calls
    return this.enrichPostsWithMetrics(rawPosts);
  }
}