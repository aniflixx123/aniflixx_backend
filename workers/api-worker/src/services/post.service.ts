// workers/api-worker/src/services/post.service.ts

import { nanoid } from 'nanoid';
import type { D1Database } from '@cloudflare/workers-types';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { Post } from '../types';

interface CreatePostData {
  user_id: string;
  content: string;
  media_urls?: string[] | null;
  type: 'text' | 'image' | 'video';
  visibility: 'public' | 'followers' | 'clan';
  clan_id?: string | null;
}

interface UpdatePostData {
  content?: string;
  media_urls?: string[];
  visibility?: 'public' | 'followers' | 'clan';
}

interface FeedResult {
  posts: Post[];
  total: number;
  hasMore: boolean;
}

export class PostService {
  constructor(
    private db: D1Database,
    private cache: KVNamespace,
    private counters: DurableObjectNamespace
  ) {}
  
  async createPost(data: CreatePostData): Promise<Post> {
    const postId = nanoid();
    const now = new Date().toISOString();
    
    // Prepare media URLs for storage
    const mediaUrlsJson = data.media_urls ? JSON.stringify(data.media_urls) : null;
    
    // Insert post
    await this.db.prepare(`
      INSERT INTO posts (
        id, user_id, content, media_urls, type, visibility, clan_id,
        likes_count, comments_count, shares_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `).bind(
      postId,
      data.user_id,
      data.content,
      mediaUrlsJson,
      data.type,
      data.visibility,
      data.clan_id || null,
      now,
      now
    ).run();
    
    // Update user's post count
    await this.db.prepare(
      'UPDATE users SET posts_count = posts_count + 1 WHERE id = ?'
    ).bind(data.user_id).run();
    
    // Initialize counters in Durable Object
    const counterId = this.counters.idFromName(postId);
    const counter = this.counters.get(counterId);
    await counter.fetch(new Request('http://internal/init', {
      method: 'POST',
      body: JSON.stringify({ likes: 0, comments: 0, shares: 0 })
    }));
    
    // Invalidate caches
    await this.invalidatePostCaches(postId, data.user_id);
    
    return {
      id: postId,
      user_id: data.user_id,
      content: data.content,
      media_urls: data.media_urls || null,
      type: data.type,
      visibility: data.visibility,
      clan_id: data.clan_id || null,
      likes_count: 0,
      comments_count: 0,
      shares_count: 0,
      created_at: now,
      updated_at: now
    };
  }
  
  async getPost(postId: string, viewerId?: string): Promise<Post | null> {
    // Try cache first
    const cacheKey = `post:${postId}${viewerId ? `:${viewerId}` : ''}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as Post;
    }
    
    // Get from database
    const result = await this.db.prepare(`
      SELECT * FROM posts WHERE id = ?
    `).bind(postId).first();
    
    if (!result) {
      return null;
    }
    
    // Parse media_urls if stored as JSON
    if (result.media_urls && typeof result.media_urls === 'string') {
      try {
        result.media_urls = JSON.parse(result.media_urls as string);
      } catch {
        result.media_urls = null;
      }
    }
    
    // Check visibility permissions
    if (result.visibility === 'followers' && viewerId && viewerId !== result.user_id) {
      const isFollowing = await this.db.prepare(
        'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?'
      ).bind(viewerId, result.user_id).first();
      
      if (!isFollowing) {
        return null;
      }
    }
    
    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 300
    });
    
    return result as unknown as Post;  // FIX: Use unknown first
  }
  
  async updatePost(postId: string, data: UpdatePostData): Promise<Post> {
    const updateFields: string[] = [];
    const values: any[] = [];
    
    if (data.content !== undefined) {
      updateFields.push('content = ?');
      values.push(data.content);
    }
    
    if (data.media_urls !== undefined) {
      updateFields.push('media_urls = ?');
      values.push(JSON.stringify(data.media_urls));
    }
    
    if (data.visibility !== undefined) {
      updateFields.push('visibility = ?');
      values.push(data.visibility);
    }
    
    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }
    
    // Add updated_at timestamp
    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    // Add postId for WHERE clause
    values.push(postId);
    
    // Execute update
    await this.db.prepare(`
      UPDATE posts 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).bind(...values).run();
    
    // Get the post to find user_id for cache invalidation
    const post = await this.db.prepare(
      'SELECT user_id FROM posts WHERE id = ?'
    ).bind(postId).first();
    
    if (post) {
      // Invalidate caches
      await this.invalidatePostCaches(postId, post.user_id as string);
    }
    
    // Return updated post
    const updatedPost = await this.getPost(postId);
    if (!updatedPost) {
      throw new Error('Failed to retrieve updated post');
    }
    return updatedPost;
  }
  
  async deletePost(postId: string): Promise<void> {
    // Get post details for cache invalidation
    const post = await this.db.prepare(
      'SELECT user_id FROM posts WHERE id = ?'
    ).bind(postId).first();
    
    if (!post) {
      throw new Error('Post not found');
    }
    
    // Delete post and related data
    await this.db.batch([
      this.db.prepare('DELETE FROM posts WHERE id = ?').bind(postId),
      this.db.prepare('DELETE FROM post_likes WHERE post_id = ?').bind(postId),
      this.db.prepare('DELETE FROM post_comments WHERE post_id = ?').bind(postId),
      this.db.prepare('DELETE FROM post_shares WHERE post_id = ?').bind(postId),
      this.db.prepare('DELETE FROM post_bookmarks WHERE post_id = ?').bind(postId),
      this.db.prepare(`
        UPDATE users 
        SET posts_count = GREATEST(0, posts_count - 1)
        WHERE id = ?
      `).bind(post.user_id)
    ]);
    
    // Delete Durable Object counter
    try {
      const counterId = this.counters.idFromName(postId);
      const counter = this.counters.get(counterId);
      await counter.fetch(new Request('http://internal/delete', {
        method: 'DELETE'
      }));
    } catch (error) {
      console.error('Failed to delete counter:', error);
    }
    
    // Invalidate caches
    await this.invalidatePostCaches(postId, post.user_id as string);
  }
  
  async getUserPosts(
    userId: string, 
    viewerId?: string, 
    page: number = 1, 
    limit: number = 20
  ): Promise<FeedResult> {
    const offset = (page - 1) * limit;
    
    // Build query based on viewer
    let whereClause = 'user_id = ?';
    const params: any[] = [userId];
    
    if (viewerId && viewerId !== userId) {
      // If viewing someone else's posts, check visibility
      whereClause += ' AND (visibility = ? OR (visibility = ? AND EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?)))';
      params.push('public', 'followers', viewerId, userId);
    } else if (!viewerId) {
      // Not authenticated, only show public posts
      whereClause += ' AND visibility = ?';
      params.push('public');
    }
    // If viewing own posts (viewerId === userId), show all
    
    // Get total count
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM posts WHERE ${whereClause}`
    ).bind(...params).first();
    
    const total = (countResult?.total as number) || 0;
    
    // Get posts
    params.push(limit, offset);
    const posts = await this.db.prepare(`
      SELECT * FROM posts 
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params).all();
    
    // Parse media_urls for each post
    const parsedPosts = posts.results.map(post => {
      if (post.media_urls && typeof post.media_urls === 'string') {
        try {
          post.media_urls = JSON.parse(post.media_urls as string);
        } catch {
          post.media_urls = null;
        }
      }
      return post as unknown as Post;  // FIX: Use unknown first
    });
    
    return {
      posts: parsedPosts,
      total,
      hasMore: offset + limit < total
    };
  }
  
  async getFeed(
    feedType: 'trending' | 'recent' | 'following',
    userId?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<FeedResult> {
    const offset = (page - 1) * limit;
    let query: string;
    let params: any[] = [];
    
    switch (feedType) {
      case 'trending':
        // Get trending posts (most engagement in last 24 hours)
        query = `
          SELECT * FROM posts 
          WHERE visibility = 'public' 
            AND created_at > datetime('now', '-24 hours')
          ORDER BY (likes_count + comments_count * 2 + shares_count * 3) DESC, 
                   created_at DESC
          LIMIT ? OFFSET ?
        `;
        params = [limit, offset];
        break;
        
      case 'following':
        // Get posts from followed users
        if (!userId) {
          return { posts: [], total: 0, hasMore: false };
        }
        query = `
          SELECT p.* FROM posts p
          INNER JOIN follows f ON p.user_id = f.following_id
          WHERE f.follower_id = ?
            AND (p.visibility = 'public' OR p.visibility = 'followers')
          ORDER BY p.created_at DESC
          LIMIT ? OFFSET ?
        `;
        params = [userId, limit, offset];
        break;
        
      case 'recent':
      default:
        // Get recent public posts
        query = `
          SELECT * FROM posts 
          WHERE visibility = 'public'
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `;
        params = [limit, offset];
        break;
    }
    
    // Get posts
    const posts = await this.db.prepare(query).bind(...params).all();
    
    // Get total count
    const countQuery = query.replace(
      /SELECT \* FROM/,
      'SELECT COUNT(*) as total FROM'
    ).replace(/ORDER BY.*LIMIT.*OFFSET.*/, '');
    
    const countResult = await this.db.prepare(countQuery)
      .bind(...params.slice(0, -2))
      .first();
    
    const total = (countResult?.total as number) || 0;
    
    // Parse media_urls for each post
    const parsedPosts = posts.results.map(post => {
      if (post.media_urls && typeof post.media_urls === 'string') {
        try {
          post.media_urls = JSON.parse(post.media_urls as string);
        } catch {
          post.media_urls = null;
        }
      }
      return post as unknown as Post;  // FIX: Use unknown first
    });
    
    return {
      posts: parsedPosts,
      total,
      hasMore: offset + limit < total
    };
  }
  
  // Helper methods
  private async invalidatePostCaches(postId: string, userId: string): Promise<void> {
    const cacheKeys = [
      `post:${postId}`,
      `post:${postId}:${userId}`,
      `feed:home:${userId}`,
      `feed:following:${userId}`,
      `feed:discover`,
      `feed:trending`,
      `user:posts:${userId}`
    ];
    
    // Delete all cache keys in parallel
    await Promise.all(
      cacheKeys.map(key => this.cache.delete(key))
    );
  }
  
  private async invalidateUserCache(userId: string): Promise<void> {
    await this.cache.delete(`user:${userId}`);
  }
  
  private async invalidateFeedCaches(userId: string): Promise<void> {
    const patterns = [
      `feed:home:${userId}`,
      `feed:following:*`,
      `feed:discover`,
      `feed:trending`
    ];
    
    await Promise.all(
      patterns.map(pattern => this.cache.delete(pattern))
    );
  }
}