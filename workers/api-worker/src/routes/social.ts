// workers/api-worker/src/routes/social.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Like a post
router.post('/posts/:postId/like', async (c) => {
  try {
    const postId = c.req.param('postId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Check if post exists
    const post = await c.env.DB.prepare(
      'SELECT id, user_id FROM posts WHERE id = ?'
    ).bind(postId).first();
    
    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }
    
    // Check if already liked
    const existingLike = await c.env.DB.prepare(
      'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?'
    ).bind(user.id, postId).first();
    
    if (existingLike) {
      return c.json({ success: false, error: 'Already liked' }, 400);
    }
    
    // Add like
    await c.env.DB.prepare(
      'INSERT INTO likes (user_id, post_id) VALUES (?, ?)'
    ).bind(user.id, postId).run();
    
    // Update counter in Durable Object
    const counterId = c.env.POST_COUNTERS.idFromName(postId);
    const counter = c.env.POST_COUNTERS.get(counterId);
    await counter.fetch(new Request('http://counter/increment', {
      method: 'POST',
      body: JSON.stringify({ field: 'likes' })
    }));
    
    // Create notification if not liking own post
    if (post.user_id !== user.id) {
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, user_id, type, title, message, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        post.user_id,
        'like',
        'New Like',
        `${user.username} liked your post`,
        JSON.stringify({ postId, userId: user.id })
      ).run();
    }
    
    // Invalidate post cache
    await c.env.CACHE.delete(`post:${postId}`);
    
    return c.json({ success: true, message: 'Post liked' });
    
  } catch (error) {
    console.error('Like post error:', error);
    return c.json({ success: false, error: 'Failed to like post' }, 500);
  }
});

// Unlike a post
router.delete('/posts/:postId/like', async (c) => {
  try {
    const postId = c.req.param('postId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Remove like
    const result = await c.env.DB.prepare(
      'DELETE FROM likes WHERE user_id = ? AND post_id = ?'
    ).bind(user.id, postId).run();
    
    if (!result.meta.changes) {
      return c.json({ success: false, error: 'Like not found' }, 404);
    }
    
    // Update counter
    const counterId = c.env.POST_COUNTERS.idFromName(postId);
    const counter = c.env.POST_COUNTERS.get(counterId);
    await counter.fetch(new Request('http://counter/decrement', {
      method: 'POST',
      body: JSON.stringify({ field: 'likes' })
    }));
    
    // Invalidate cache
    await c.env.CACHE.delete(`post:${postId}`);
    
    return c.json({ success: true, message: 'Post unliked' });
    
  } catch (error) {
    console.error('Unlike post error:', error);
    return c.json({ success: false, error: 'Failed to unlike post' }, 500);
  }
});

// Follow a user
router.post('/users/:userId/follow', async (c) => {
  try {
    const targetUserId = c.req.param('userId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    if (user.id === targetUserId) {
      return c.json({ success: false, error: 'Cannot follow yourself' }, 400);
    }
    
    // Check if target user exists
    const targetUser = await c.env.DB.prepare(
      'SELECT id, username FROM users WHERE id = ?'
    ).bind(targetUserId).first();
    
    if (!targetUser) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    
    // Check if already following
    const existingFollow = await c.env.DB.prepare(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?'
    ).bind(user.id, targetUserId).first();
    
    if (existingFollow) {
      return c.json({ success: false, error: 'Already following' }, 400);
    }
    
    // Add follow
    await c.env.DB.prepare(
      'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)'
    ).bind(user.id, targetUserId).run();
    
    // Update counters
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET following_count = following_count + 1 WHERE id = ?'
      ).bind(user.id),
      c.env.DB.prepare(
        'UPDATE users SET followers_count = followers_count + 1 WHERE id = ?'
      ).bind(targetUserId)
    ]);
    
    // Create notification
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      targetUserId,
      'follow',
      'New Follower',
      `${user.username} started following you`,
      JSON.stringify({ userId: user.id })
    ).run();
    
    // Invalidate caches
    await c.env.CACHE.delete(`user:${user.id}`);
    await c.env.CACHE.delete(`user:${targetUserId}`);
    await c.env.CACHE.delete(`feed:home:${user.id}`);
    
    return c.json({ success: true, message: 'User followed' });
    
  } catch (error) {
    console.error('Follow user error:', error);
    return c.json({ success: false, error: 'Failed to follow user' }, 500);
  }
});

// Unfollow a user
router.delete('/users/:userId/follow', async (c) => {
  try {
    const targetUserId = c.req.param('userId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Remove follow
    const result = await c.env.DB.prepare(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
    ).bind(user.id, targetUserId).run();
    
    if (!result.meta.changes) {
      return c.json({ success: false, error: 'Follow not found' }, 404);
    }
    
    // Update counters
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET following_count = following_count - 1 WHERE id = ?'
      ).bind(user.id),
      c.env.DB.prepare(
        'UPDATE users SET followers_count = followers_count - 1 WHERE id = ?'
      ).bind(targetUserId)
    ]);
    
    // Invalidate caches
    await c.env.CACHE.delete(`user:${user.id}`);
    await c.env.CACHE.delete(`user:${targetUserId}`);
    await c.env.CACHE.delete(`feed:home:${user.id}`);
    
    return c.json({ success: true, message: 'User unfollowed' });
    
  } catch (error) {
    console.error('Unfollow user error:', error);
    return c.json({ success: false, error: 'Failed to unfollow user' }, 500);
  }
});

// Share a post
router.post('/posts/:postId/share', async (c) => {
  try {
    const postId = c.req.param('postId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json();
    const shareSchema = z.object({
      content: z.string().max(500).optional()
    });
    
    const validated = shareSchema.safeParse(body);
    if (!validated.success) {
      return c.json({ success: false, error: 'Invalid input' }, 400);
    }
    
    // Check if post exists
    const post = await c.env.DB.prepare(
      'SELECT id, user_id FROM posts WHERE id = ?'
    ).bind(postId).first();
    
    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }
    
    // Create share
    const shareId = nanoid();
    await c.env.DB.prepare(`
      INSERT INTO shares (id, post_id, user_id, content)
      VALUES (?, ?, ?, ?)
    `).bind(shareId, postId, user.id, validated.data.content || null).run();
    
    // Update counter
    const counterId = c.env.POST_COUNTERS.idFromName(postId);
    const counter = c.env.POST_COUNTERS.get(counterId);
    await counter.fetch(new Request('http://counter/increment', {
      method: 'POST',
      body: JSON.stringify({ field: 'shares' })
    }));
    
    // Create notification if not sharing own post
    if (post.user_id !== user.id) {
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, user_id, type, title, message, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        post.user_id,
        'share',
        'Post Shared',
        `${user.username} shared your post`,
        JSON.stringify({ postId, userId: user.id, shareId })
      ).run();
    }
    
    // Invalidate cache
    await c.env.CACHE.delete(`post:${postId}`);
    
    return c.json({ 
      success: true, 
      message: 'Post shared',
      data: { shareId }
    });
    
  } catch (error) {
    console.error('Share post error:', error);
    return c.json({ success: false, error: 'Failed to share post' }, 500);
  }
});

// Get post likes
router.get('/posts/:postId/likes', async (c) => {
  try {
    const postId = c.req.param('postId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM likes WHERE post_id = ?'
    ).bind(postId).first();
    
    const total = countResult?.total as number || 0;
    
    // Get likes with user info
    const likes = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        l.created_at
      FROM likes l
      JOIN users u ON l.user_id = u.id
      WHERE l.post_id = ?
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(postId, limit, offset).all();
    
    return c.json({
      success: true,
      data: likes.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get likes error:', error);
    return c.json({ success: false, error: 'Failed to get likes' }, 500);
  }
});

export { router as socialRouter };