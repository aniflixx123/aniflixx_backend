// workers/api-worker/src/services/post.service.ts

import { nanoid } from 'nanoid';
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
  visibility?: 'public' | 'followers' | 'clan';
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
    
    // Insert post
    await this.db.prepare(`
      INSERT INTO posts (
        id, user_id, content, media_urls, type, 
        visibility, clan_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      postId,
      data.user_id,
      data.content,
      data.media_urls ? JSON.stringify(data.media_urls) : null,
      data.type,
      data.visibility,
      data.clan_id || null,
      now,
      now
    ).run();
    
    // Update user's post count
    await this.db.prepare(`
      UPDATE users 
      SET posts_count = posts_count + 1,
          updated_at = ?
      WHERE id = ?
    `).bind(now, data.user_id).run();
    
    // Invalidate caches
    await this.invalidateUserCache(data.user_id);
    await this.invalidateFeedCaches(data.user_id);
    
    return this.getPost(postId, data.user_id) as Promise<Post>;
  }
  
  async getPost(postId: string, viewerId?: string): Promise<Post | null> {
    // Try cache first
    const cacheKey = `post:${postId}`;
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as Post;
    }
    
    // Get from database
    const result = await this.db.prepare(`
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).bind(postId).first();
    
    if (!result) {
      return null;
    }
    
    // Check visibility
    if (result.visibility === 'followers' && viewerId !== result.user_id) {
      // Check if viewer follows the poster
      const follows = await this.db.prepare(`
        SELECT 1 FROM follows 
        WHERE follower_id = ? AND following_id = ?
      `).bind(viewerId, result.user_id).first();
      
      if (!follows) {
        return null;
      }
    }
    
    // Get counters from Durable Object
    const counterId = this.counters.idFromName(postId);
    const counter = this.counters.get(counterId);
    const countsResponse = await counter.fetch(new Request('http://counter/get'));
    const counts = await countsResponse.json() as Record<string, number>;
    
    const post: Post = {
      id: result.id as string,
      user_id: result.user_id as string,
      content: result.content as string,
      media_urls: result.media_urls ? JSON.parse(result.media_urls as string) : null,
      type: result.type as 'text' | 'image' | 'video',
      visibility: result.visibility as 'public' | 'followers' | 'clan',
      clan_id: result.clan_id as string | null,
      likes_count: counts.likes || 0,
      comments_count: counts.comments || 0,
      shares_count: counts.shares || 0,
      created_at: result.created_at as string,
      updated_at: result.updated_at as string
    };
    
    // Cache for 5 minutes
    await this.cache.put(cacheKey, JSON.stringify(post), {
      expirationTtl: 300
    });
    
    return post;
  }
  
  async updatePost(postId: string, data: UpdatePostData): Promise<Post> {
    const updateFields: string[] = [];
    const values: any[] = [];
    
    if (data.content !== undefined) {
      updateFields.push('content = ?');
      values.push(data.content);
    }
    
    if (data.visibility !== undefined) {
      updateFields.push('visibility = ?');
      values.push(data.visibility);
    }
    
    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }
    
    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(postId);
    
    await this.db.prepare(`
      UPDATE posts 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).bind(...values).run();
    
    // Invalidate cache
    await this.cache.delete(`post:${postId}`);
    
    return this.getPost(postId) as Promise<Post>;
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
      this.db.prepare('DELETE FROM likes WHERE post_id = ?').bind(postId),
      this.db.prepare('DELETE FROM comments WHERE post_id = ?').bind(postId),
      this.db.prepare(`
        UPDATE users 
        SET posts_count = posts_count - 1 
        WHERE id = ?
      `).bind(post.user_id)
    ]);
    
    // Invalidate caches
    await this.cache.delete(`post:${postId}`);
    await this.invalidateUserCache(post.user_id as string);
    await this.invalidateFeedCaches(post.user_id as string);
  }
  
  async getUserPosts(
    userId: string, 
    viewerId?: string, 
    page: number = 1, 
    limit: number = 20
  ): Promise<{ posts: Post[]; total: number; hasMore: boolean }> {
    const offset = (page - 1) * limit;
    
    // Build query based on viewer
    let whereClause = 'user_id = ?';
    const params: any[] = [userId];
    
    if (viewerId && viewerId !== userId) {
      whereClause += ' AND (visibility = ? OR (visibility = ? AND EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?)))';
      params.push('public', 'followers', viewerId, userId);
    } else if (!viewerId) {
      // Not authenticated, only show public posts
      whereClause += ' AND visibility = ?';
      params.push('public');
    }
    
    // Get total count
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM posts WHERE ${whereClause}`
    ).bind(...params).first();
    
    const total = countResult?.total as number || 0;
    
    // Get posts
    const posts = await this.db.prepare(`
      SELECT * FROM posts 
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();
    
    // Enrich with counters
    const enrichedPosts = await Promise.all(
      posts.results.map(post => this.getPost(post.id as string, viewerId))
    );
    
    return {
      posts: enrichedPosts.filter(Boolean) as Post[],
      total,
      hasMore: offset + limit < total
    };
  }
  
  private async invalidateUserCache(userId: string): Promise<void> {
    await this.cache.delete(`user:${userId}`);
    await this.cache.delete(`user:posts:${userId}`);
  }
  
  private async invalidateFeedCaches(userId: string): Promise<void> {
    // Invalidate the user's own feeds
    await this.cache.delete(`feed:home:${userId}`);
    await this.cache.delete(`feed:following:${userId}`);
    
    // In a real implementation, you'd also invalidate followers' home feeds
    // This would require a followers table or fanout approach
  }
}