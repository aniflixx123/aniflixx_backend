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

// ============================================
// POST INTERACTIONS
// ============================================

// Like/unlike a post - FIXED FOR YOUR SCHEMA (no id column in post_likes)
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
    
    // Check if already liked - FIXED: no id column in post_likes
    const existingLike = await c.env.DB.prepare(
      'SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?'
    ).bind(postId, user.id).first();
    
    if (existingLike) {
      // Unlike - remove the like
      await c.env.DB.prepare(
        'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?'
      ).bind(postId, user.id).run();
      
      // Update count
      await c.env.DB.prepare(
        'UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?'
      ).bind(postId).run();
      
      // Update counter via Durable Object if available
      try {
        const counterId = c.env.POST_COUNTERS.idFromName(postId);
        const counter = c.env.POST_COUNTERS.get(counterId);
        await counter.fetch(new Request('http://internal/decrement', {
          method: 'POST',
          body: JSON.stringify({ field: 'likes' })
        }));
      } catch (e) {
        // Durable Object might not be available, continue
      }
      
      // Invalidate caches
      await c.env.CACHE.delete(`post:${postId}`);
      await c.env.CACHE.delete(`post:${postId}:${user.id}`);
      
      return c.json({ 
        success: true, 
        data: { liked: false },
        message: 'Post unliked'
      });
    } else {
      // Like - add the like (FIXED: no id column)
      await c.env.DB.prepare(`
        INSERT INTO post_likes (post_id, user_id, created_at)
        VALUES (?, ?, ?)
      `).bind(postId, user.id, new Date().toISOString()).run();
      
      // Update count
      await c.env.DB.prepare(
        'UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?'
      ).bind(postId).run();
      
      // Update counter via Durable Object if available
      try {
        const counterId = c.env.POST_COUNTERS.idFromName(postId);
        const counter = c.env.POST_COUNTERS.get(counterId);
        await counter.fetch(new Request('http://internal/increment', {
          method: 'POST',
          body: JSON.stringify({ field: 'likes' })
        }));
      } catch (e) {
        // Durable Object might not be available, continue
      }
      
      // Create notification if not liking own post
      if (post.user_id !== user.id) {
        await c.env.DB.prepare(`
          INSERT INTO notifications (
            id, recipient_id, sender_id, type, target_type, target_id,
            message, is_read, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          nanoid(),
          post.user_id,
          user.id,
          'post_like',
          'post',
          postId,
          `${user.username} liked your post`,
          0,
          new Date().toISOString()
        ).run();
      }
      
      // Invalidate caches
      await c.env.CACHE.delete(`post:${postId}`);
      await c.env.CACHE.delete(`post:${postId}:${user.id}`);
      
      return c.json({ 
        success: true, 
        data: { liked: true },
        message: 'Post liked'
      });
    }
    
  } catch (error) {
    console.error('Like/unlike post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update like' 
    }, 500);
  }
});

// Unlike post (DELETE method for compatibility)
router.delete('/posts/:postId/like', async (c) => {
  const postId = c.req.param('postId');
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  
  try {
    const result = await c.env.DB.prepare(
      'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?'
    ).bind(postId, user.id).run();
    
    if (result.meta.changes) {
      // Update count
      await c.env.DB.prepare(
        'UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?'
      ).bind(postId).run();
      
      // Update counter via Durable Object if available
      try {
        const counterId = c.env.POST_COUNTERS.idFromName(postId);
        const counter = c.env.POST_COUNTERS.get(counterId);
        await counter.fetch(new Request('http://internal/decrement', {
          method: 'POST',
          body: JSON.stringify({ field: 'likes' })
        }));
      } catch (e) {
        // Durable Object might not be available
      }
      
      // Invalidate caches
      await c.env.CACHE.delete(`post:${postId}`);
      await c.env.CACHE.delete(`post:${postId}:${user.id}`);
    }
    
    return c.json({ 
      success: true, 
      data: { liked: false },
      message: 'Post unliked'
    });
    
  } catch (error) {
    console.error('Unlike post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to unlike post' 
    }, 500);
  }
});

// Bookmark/unbookmark a post - FIXED FOR YOUR SCHEMA (no id column in post_bookmarks)
router.post('/posts/:postId/bookmark', async (c) => {
  try {
    const postId = c.req.param('postId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Check if post exists
    const post = await c.env.DB.prepare(
      'SELECT id FROM posts WHERE id = ?'
    ).bind(postId).first();
    
    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }
    
    // Check if already bookmarked - FIXED: no id column
    const existingBookmark = await c.env.DB.prepare(
      'SELECT 1 FROM post_bookmarks WHERE post_id = ? AND user_id = ?'
    ).bind(postId, user.id).first();
    
    if (existingBookmark) {
      // Remove bookmark
      await c.env.DB.prepare(
        'DELETE FROM post_bookmarks WHERE post_id = ? AND user_id = ?'
      ).bind(postId, user.id).run();
      
      return c.json({ 
        success: true, 
        data: { bookmarked: false },
        message: 'Bookmark removed' 
      });
    } else {
      // Add bookmark - FIXED: no id column
      await c.env.DB.prepare(`
        INSERT INTO post_bookmarks (user_id, post_id, created_at)
        VALUES (?, ?, ?)
      `).bind(user.id, postId, new Date().toISOString()).run();
      
      return c.json({ 
        success: true, 
        data: { bookmarked: true },
        message: 'Post bookmarked' 
      });
    }
    
  } catch (error) {
    console.error('Bookmark/unbookmark post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update bookmark' 
    }, 500);
  }
});

// Share a post (HAS id column in post_shares)
router.post('/posts/:postId/share', async (c) => {
  try {
    const postId = c.req.param('postId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json().catch(() => ({}));
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
    
    // Create share record (post_shares HAS an id column)
    const shareId = nanoid();
    await c.env.DB.prepare(`
      INSERT INTO post_shares (id, post_id, user_id, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      shareId, 
      postId, 
      user.id, 
      validated.data.content || null,
      new Date().toISOString()
    ).run();
    
    // Update shares count
    await c.env.DB.prepare(
      'UPDATE posts SET shares_count = shares_count + 1 WHERE id = ?'
    ).bind(postId).run();
    
    // Update counter via Durable Object if available
    try {
      const counterId = c.env.POST_COUNTERS.idFromName(postId);
      const counter = c.env.POST_COUNTERS.get(counterId);
      await counter.fetch(new Request('http://internal/increment', {
        method: 'POST',
        body: JSON.stringify({ field: 'shares' })
      }));
    } catch (e) {
      // Durable Object might not be available
    }
    
    // Create notification if not sharing own post
    if (post.user_id !== user.id) {
      await c.env.DB.prepare(`
        INSERT INTO notifications (
          id, recipient_id, sender_id, type, target_type, target_id,
          message, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        post.user_id,
        user.id,
        'share',
        'post',
        postId,
        `${user.username} shared your post`,
        0,
        new Date().toISOString()
      ).run();
    }
    
    // Invalidate cache
    await c.env.CACHE.delete(`post:${postId}`);
    
    return c.json({ 
      success: true, 
      data: { shareId },
      message: 'Post shared successfully' 
    });
    
  } catch (error) {
    console.error('Share post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to share post' 
    }, 500);
  }
});

// ============================================
// COMMENT INTERACTIONS
// ============================================

// Like/unlike a comment (post_comment_likes HAS an id column)
router.post('/comments/:commentId/like', async (c) => {
  try {
    const commentId = c.req.param('commentId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Check if comment exists
    const comment = await c.env.DB.prepare(
      'SELECT id, user_id, post_id FROM post_comments WHERE id = ?'
    ).bind(commentId).first();
    
    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }
    
    // Check if already liked
    const existingLike = await c.env.DB.prepare(
      'SELECT id FROM post_comment_likes WHERE comment_id = ? AND user_id = ?'
    ).bind(commentId, user.id).first();
    
    if (existingLike) {
      // Unlike
      await c.env.DB.prepare(
        'DELETE FROM post_comment_likes WHERE comment_id = ? AND user_id = ?'
      ).bind(commentId, user.id).run();
      
      // Update count
      await c.env.DB.prepare(
        'UPDATE post_comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?'
      ).bind(commentId).run();
      
      return c.json({ 
        success: true, 
        data: { liked: false },
        message: 'Comment unliked'
      });
    } else {
      // Like (post_comment_likes HAS an id column)
      const likeId = nanoid();
      await c.env.DB.prepare(`
        INSERT INTO post_comment_likes (id, comment_id, user_id, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(likeId, commentId, user.id, new Date().toISOString()).run();
      
      // Update count
      await c.env.DB.prepare(
        'UPDATE post_comments SET likes_count = likes_count + 1 WHERE id = ?'
      ).bind(commentId).run();
      
      // Create notification if not liking own comment
      if (comment.user_id !== user.id) {
        await c.env.DB.prepare(`
          INSERT INTO notifications (
            id, recipient_id, sender_id, type, target_type, target_id,
            message, is_read, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          nanoid(),
          comment.user_id,
          user.id,
          'comment_like',
          'comment',
          commentId,
          `${user.username} liked your comment`,
          0,
          new Date().toISOString()
        ).run();
      }
      
      // Invalidate cache
      await c.env.CACHE.delete(`post:comments:${comment.post_id}`);
      
      return c.json({ 
        success: true, 
        data: { liked: true },
        message: 'Comment liked'
      });
    }
    
  } catch (error) {
    console.error('Like/unlike comment error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update like' 
    }, 500);
  }
});

// ============================================
// USER INTERACTIONS (follows table - no id column)
// ============================================

// Follow a user
router.post('/users/:targetUserId/follow', async (c) => {
  try {
    const targetUserId = c.req.param('targetUserId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Can't follow yourself
    if (targetUserId === user.id) {
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
      return c.json({ 
        success: false, 
        error: 'Already following this user' 
      }, 400);
    }
    
    // Create follow relationship (follows has no id column)
    await c.env.DB.prepare(`
      INSERT INTO follows (follower_id, following_id, created_at)
      VALUES (?, ?, ?)
    `).bind(user.id, targetUserId, new Date().toISOString()).run();
    
    // Update user counts
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
      INSERT INTO notifications (
        id, recipient_id, sender_id, type, target_type, target_id,
        message, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      targetUserId,
      user.id,
      'follow',
      'user',
      user.id,
      `${user.username} started following you`,
      0,
      new Date().toISOString()
    ).run();
    
    // Invalidate caches
    await c.env.CACHE.delete(`user:${user.id}`);
    await c.env.CACHE.delete(`user:${targetUserId}`);
    await c.env.CACHE.delete(`feed:home:${user.id}`);
    await c.env.CACHE.delete(`feed:following:${user.id}`);
    
    return c.json({ 
      success: true, 
      data: { following: true },
      message: 'User followed successfully' 
    });
    
  } catch (error) {
    console.error('Follow user error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to follow user' 
    }, 500);
  }
});

// Unfollow a user
router.delete('/users/:targetUserId/follow', async (c) => {
  try {
    const targetUserId = c.req.param('targetUserId');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Delete follow relationship
    const result = await c.env.DB.prepare(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
    ).bind(user.id, targetUserId).run();
    
    if (!result.meta.changes) {
      return c.json({ success: false, error: 'Follow not found' }, 404);
    }
    
    // Update user counts
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET following_count = CASE WHEN following_count > 0 THEN following_count - 1 ELSE 0 END WHERE id = ?'
      ).bind(user.id),
      c.env.DB.prepare(
        'UPDATE users SET followers_count = CASE WHEN followers_count > 0 THEN followers_count - 1 ELSE 0 END WHERE id = ?'
      ).bind(targetUserId)
    ]);
    
    // Invalidate caches
    await c.env.CACHE.delete(`user:${user.id}`);
    await c.env.CACHE.delete(`user:${targetUserId}`);
    await c.env.CACHE.delete(`feed:home:${user.id}`);
    await c.env.CACHE.delete(`feed:following:${user.id}`);
    
    return c.json({ 
      success: true, 
      data: { following: false },
      message: 'User unfollowed successfully' 
    });
    
  } catch (error) {
    console.error('Unfollow user error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to unfollow user' 
    }, 500);
  }
});

// Get user's followers
router.get('/users/:userId/followers', async (c) => {
  try {
    const userId = c.req.param('userId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const currentUser = c.get('user');
    
    const offset = (page - 1) * limit;
    
    // Get followers with user info
    const result = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        u.bio,
        u.is_verified,
        u.followers_count,
        u.following_count,
        f.created_at as followed_at,
        EXISTS(
          SELECT 1 FROM follows 
          WHERE follower_id = ? AND following_id = u.id
        ) as is_following
      FROM follows f
      INNER JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(
      currentUser?.id || 'none',
      userId,
      limit,
      offset
    ).all();
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM follows WHERE following_id = ?'
    ).bind(userId).first();
    
    const total = (countResult?.total as number) || 0;
    
    return c.json({
      success: true,
      data: result.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get followers error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get followers',
      data: []
    }, 500);
  }
});

// Get user's following
router.get('/users/:userId/following', async (c) => {
  try {
    const userId = c.req.param('userId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const currentUser = c.get('user');
    
    const offset = (page - 1) * limit;
    
    // Get following with user info
    const result = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        u.bio,
        u.is_verified,
        u.followers_count,
        u.following_count,
        f.created_at as followed_at,
        EXISTS(
          SELECT 1 FROM follows 
          WHERE follower_id = ? AND following_id = u.id
        ) as is_following
      FROM follows f
      INNER JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(
      currentUser?.id || 'none',
      userId,
      limit,
      offset
    ).all();
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM follows WHERE follower_id = ?'
    ).bind(userId).first();
    
    const total = (countResult?.total as number) || 0;
    
    return c.json({
      success: true,
      data: result.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get following error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get following',
      data: []
    }, 500);
  }
});

// Check if following a user
router.get('/users/:targetUserId/is-following', async (c) => {
  try {
    const targetUserId = c.req.param('targetUserId');
    const user = c.get('user');
    
    if (!user) {
      return c.json({ 
        success: true, 
        data: { isFollowing: false }
      });
    }
    
    const follow = await c.env.DB.prepare(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?'
    ).bind(user.id, targetUserId).first();
    
    return c.json({ 
      success: true, 
      data: { isFollowing: !!follow }
    });
    
  } catch (error) {
    console.error('Check following error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to check following status' 
    }, 500);
  }
});

// Get post likes
router.get('/posts/:postId/likes', async (c) => {
  try {
    const postId = c.req.param('postId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const currentUser = c.get('user');
    
    const offset = (page - 1) * limit;
    
    // Get users who liked the post
    const result = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        u.is_verified,
        pl.created_at as liked_at,
        EXISTS(
          SELECT 1 FROM follows 
          WHERE follower_id = ? AND following_id = u.id
        ) as is_following
      FROM post_likes pl
      INNER JOIN users u ON pl.user_id = u.id
      WHERE pl.post_id = ?
      ORDER BY pl.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(
      currentUser?.id || 'none',
      postId,
      limit,
      offset
    ).all();
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM post_likes WHERE post_id = ?'
    ).bind(postId).first();
    
    const total = (countResult?.total as number) || 0;
    
    return c.json({
      success: true,
      data: result.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get post likes error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get post likes',
      data: []
    }, 500);
  }
});

export { router as socialRouter };