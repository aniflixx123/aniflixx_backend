// workers/api-worker/src/services/feed.service.ts

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
  
  async getHomeFeed(userId: string, page: number, limit: number): Promise<FeedResult> {
    // Try cache first
    const cacheKey = `feed:home:${userId}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Get posts from following users + some trending posts
    const query = `
      WITH following_posts AS (
        SELECT p.*, u.username, u.profile_image as user_profile_image
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.user_id IN (
          SELECT following_id FROM follows WHERE follower_id = ?
        )
        AND p.visibility IN ('public', 'followers')
        ORDER BY p.created_at DESC
        LIMIT ?
      ),
      trending_posts AS (
        SELECT p.*, u.username, u.profile_image as user_profile_image
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.visibility = 'public'
        AND p.created_at > datetime('now', '-7 days')
        AND (p.likes_count + p.comments_count + p.shares_count) > 10
        ORDER BY (p.likes_count + p.comments_count + p.shares_count) DESC
        LIMIT ?
      )
      SELECT * FROM (
        SELECT * FROM following_posts
        UNION
        SELECT * FROM trending_posts
      )
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query)
      .bind(userId, limit * 2, Math.floor(limit / 2), limit, offset)
      .all();
    
    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT id) as total FROM (
        SELECT id FROM posts WHERE user_id IN (
          SELECT following_id FROM follows WHERE follower_id = ?
        ) AND visibility IN ('public', 'followers')
        UNION
        SELECT id FROM posts WHERE visibility = 'public'
        AND created_at > datetime('now', '-7 days')
        AND (likes_count + comments_count + shares_count) > 10
      )
    `;
    
    const countResult = await this.db.prepare(countQuery).bind(userId).first();
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPosts(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 300
    });
    
    return result;
  }
  
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
        (p.likes_count * 1.0 + p.comments_count * 2.0 + p.shares_count * 3.0) as engagement_score
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.visibility = 'public'
      AND p.created_at > ${timeCondition}
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
    `).first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPosts(posts.results),
      total,
      hasMore: offset + limit < total
    };
    
    // Cache for 10 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 600
    });
    
    return result;
  }
  
  async getFollowingFeed(userId: string, page: number, limit: number): Promise<FeedResult> {
    const cacheKey = `feed:following:${userId}:${page}:${limit}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as FeedResult;
    }
    
    const offset = (page - 1) * limit;
    
    // Get posts only from following users
    const query = `
      SELECT p.*, u.username, u.profile_image as user_profile_image
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = ?
      )
      AND p.visibility IN ('public', 'followers')
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query).bind(userId, limit, offset).all();
    
    // Get total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM posts 
      WHERE user_id IN (
        SELECT following_id FROM follows WHERE follower_id = ?
      )
      AND visibility IN ('public', 'followers')
    `).bind(userId).first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPosts(posts.results),
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
      SELECT p.*, u.username, u.profile_image as user_profile_image
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.clan_id = ? AND p.visibility = 'clan'
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const posts = await this.db.prepare(query).bind(clanId, limit, offset).all();
    
    // Get total count
    const countResult = await this.db.prepare(
      'SELECT COUNT(*) as total FROM posts WHERE clan_id = ? AND visibility = ?'
    ).bind(clanId, 'clan').first();
    
    const total = countResult?.total as number || 0;
    
    const result = {
      posts: this.enrichPosts(posts.results),
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
    const offset = (page - 1) * limit;
    
    let query: string;
    let params: any[];
    
    if (userId) {
      // Personalized discover feed based on user's interests
      query = `
        WITH user_interests AS (
          -- Get posts user has liked
          SELECT DISTINCT p.user_id as interested_in
          FROM likes l
          JOIN posts p ON l.post_id = p.id
          WHERE l.user_id = ?
          LIMIT 50
        ),
        excluded_users AS (
          -- Exclude users already following
          SELECT following_id FROM follows WHERE follower_id = ?
          UNION
          SELECT ?
        )
        SELECT p.*, u.username, u.profile_image as user_profile_image
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.visibility = 'public'
        AND p.user_id NOT IN (SELECT * FROM excluded_users)
        AND (
          -- Posts from users with similar interests
          p.user_id IN (
            SELECT DISTINCT l2.user_id
            FROM likes l1
            JOIN likes l2 ON l1.post_id = l2.post_id
            WHERE l1.user_id = ? AND l2.user_id != ?
          )
          OR
          -- High engagement posts
          (p.likes_count + p.comments_count + p.shares_count) > 20
        )
        ORDER BY 
          CASE WHEN p.user_id IN (SELECT interested_in FROM user_interests) THEN 0 ELSE 1 END,
          (p.likes_count + p.comments_count + p.shares_count) DESC,
          p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, userId, userId, userId, userId, limit, offset];
    } else {
      // Non-personalized discover feed
      query = `
        SELECT p.*, u.username, u.profile_image as user_profile_image
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.visibility = 'public'
        AND p.created_at > datetime('now', '-30 days')
        AND (p.likes_count + p.comments_count + p.shares_count) > 5
        ORDER BY 
          (p.likes_count + p.comments_count + p.shares_count) DESC,
          p.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }
    
    const posts = await this.db.prepare(query).bind(...params).all();
    
    // For simplicity, we'll estimate total as limit * 10
    const total = limit * 10;
    
    return {
      posts: this.enrichPosts(posts.results),
      total,
      hasMore: offset + limit < total
    };
  }
  
  private enrichPosts(rawPosts: any[]): Post[] {
    return rawPosts.map(post => ({
      id: post.id,
      user_id: post.user_id,
      content: post.content,
      media_urls: post.media_urls ? JSON.parse(post.media_urls) : null,
      type: post.type,
      visibility: post.visibility,
      clan_id: post.clan_id,
      likes_count: post.likes_count || 0,
      comments_count: post.comments_count || 0,
      shares_count: post.shares_count || 0,
      created_at: post.created_at,
      updated_at: post.updated_at,
      // Additional fields from join
      user: {
        id: post.user_id,
        username: post.username,
        profile_image: post.user_profile_image
      }
    }));
  }
}