// workers/api-worker/src/routes/comments.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';

type Variables = {
  user: {
    id: string;
    email: string;
    username: string;
  };
};

const commentsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const createCommentSchema = z.object({
  flickId: z.string(),
  content: z.string().min(1).max(500),
  parentId: z.string().optional(),
});

const updateCommentSchema = z.object({
  content: z.string().min(1).max(500),
});

// Create comment
commentsRouter.post('/', async (c) => {
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const { flickId, content, parentId } = createCommentSchema.parse(body);

    // Get user info
    const userInfo = await c.env.DB.prepare(
      'SELECT username, profile_image FROM users WHERE id = ?'
    ).bind(user.id).first<{ username: string; profile_image: string | null }>();

    // Create comment
    const commentId = nanoid();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO flick_comments (
        id, flick_id, user_id, username, profile_image, 
        content, parent_id, likes, is_deleted, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      commentId,
      flickId,
      user.id,
      userInfo?.username || 'anonymous',
      userInfo?.profile_image || null,
      content,
      parentId || null,
      0,
      0,
      now,
      now
    ).run();

    // Update flick analytics
    await c.env.DB.prepare(
      'UPDATE flick_analytics SET comments = comments + 1 WHERE flick_id = ?'
    ).bind(flickId).run();

    // Update flick counter via Durable Object
    const id = c.env.FLICK_COUNTERS.idFromName(flickId);
    const obj = c.env.FLICK_COUNTERS.get(id);
    
    await obj.fetch(new Request('http://internal/increment', {
      method: 'POST',
      body: JSON.stringify({ field: 'comments' }),
    }));

    // Get flick owner for notification
    const flick = await c.env.DB.prepare(
      'SELECT user_id, title FROM flicks WHERE id = ?'
    ).bind(flickId).first<{ user_id: string; title: string }>();

    if (flick && flick.user_id !== user.id) {
      // Create notification
      await c.env.DB.prepare(`
        INSERT INTO notifications (
          id, recipient_id, sender_id, type, target_type, target_id,
          message, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        flick.user_id,
        user.id,
        'comment',
        'flick',
        flickId,
        `commented on your flick "${flick.title}"`,
        0,
        now
      ).run();
    }

    return c.json({
      success: true,
      data: {
        id: commentId,
        userId: user.id,
        username: userInfo?.username || 'anonymous',
        profileImage: userInfo?.profile_image || null,
        content,
        parentId: parentId || null,
        likes: 0,
        createdAt: now,
        isLiked: false,
      },
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ 
        success: false, 
        error: 'Invalid comment data',
        details: error.errors 
      }, 400);
    }
    console.error('Error creating comment:', error);
    return c.json({ success: false, error: 'Failed to create comment' }, 500);
  }
});

// Get comments for a flick
commentsRouter.get('/flick/:flickId', async (c) => {
  const user = c.get('user');
  const flickId = c.req.param('flickId');
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = (page - 1) * limit;

  try {
    const commentsData = await c.env.DB.prepare(`
      SELECT 
        c.*,
        CASE WHEN cl.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked,
        (SELECT COUNT(*) FROM flick_comments WHERE parent_id = c.id AND is_deleted = 0) as replyCount
      FROM flick_comments c
      LEFT JOIN flick_comment_likes cl ON c.id = cl.comment_id AND cl.user_id = ?
      WHERE c.flick_id = ? AND c.is_deleted = 0 AND c.parent_id IS NULL
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, flickId, limit + 1, offset).all();

    const hasMore = commentsData.results.length > limit;
    const comments = commentsData.results.slice(0, limit).map((comment: any) => ({
      id: comment.id,
      userId: comment.user_id,
      username: comment.username,
      profileImage: comment.profile_image,
      content: comment.content,
      likes: comment.likes || 0,
      isLiked: !!comment.isLiked,
      replyCount: comment.replyCount || 0,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    }));

    return c.json({
      success: true,
      data: comments,
      pagination: {
        page,
        limit,
        total: comments.length,
        hasMore,
      },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return c.json({ success: false, error: 'Failed to load comments' }, 500);
  }
});

// Get replies to a comment
commentsRouter.get('/:commentId/replies', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    const replies = await c.env.DB.prepare(`
      SELECT 
        c.*,
        CASE WHEN cl.user_id IS NOT NULL THEN 1 ELSE 0 END as isLiked
      FROM flick_comments c
      LEFT JOIN flick_comment_likes cl ON c.id = cl.comment_id AND cl.user_id = ?
      WHERE c.parent_id = ? AND c.is_deleted = 0
      ORDER BY c.created_at ASC
    `).bind(user.id, commentId).all();

    const processedReplies = replies.results.map((reply: any) => ({
      id: reply.id,
      userId: reply.user_id,
      username: reply.username,
      profileImage: reply.profile_image,
      content: reply.content,
      likes: reply.likes || 0,
      isLiked: !!reply.isLiked,
      createdAt: reply.created_at,
      updatedAt: reply.updated_at,
    }));

    return c.json({
      success: true,
      data: processedReplies,
    });
  } catch (error) {
    console.error('Error fetching replies:', error);
    return c.json({ success: false, error: 'Failed to load replies' }, 500);
  }
});

// Like/unlike comment
commentsRouter.post('/:commentId/like', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    // Check if already liked
    const existing = await c.env.DB.prepare(
      'SELECT id FROM flick_comment_likes WHERE comment_id = ? AND user_id = ?'
    ).bind(commentId, user.id).first();

    if (existing) {
      // Unlike
      await c.env.DB.prepare(
        'DELETE FROM flick_comment_likes WHERE comment_id = ? AND user_id = ?'
      ).bind(commentId, user.id).run();

      await c.env.DB.prepare(
        'UPDATE flick_comments SET likes = likes - 1 WHERE id = ?'
      ).bind(commentId).run();

      return c.json({
        success: true,
        data: {
          liked: false,
          message: 'Comment unliked',
        },
      });
    } else {
      // Like
      await c.env.DB.prepare(
        'INSERT INTO flick_comment_likes (id, comment_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(nanoid(), commentId, user.id, new Date().toISOString()).run();

      await c.env.DB.prepare(
        'UPDATE flick_comments SET likes = likes + 1 WHERE id = ?'
      ).bind(commentId).run();

      return c.json({
        success: true,
        data: {
          liked: true,
          message: 'Comment liked',
        },
      });
    }
  } catch (error) {
    console.error('Error liking comment:', error);
    return c.json({ success: false, error: 'Failed to like comment' }, 500);
  }
});

// Update comment
commentsRouter.patch('/:commentId', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    const body = await c.req.json();
    const { content } = updateCommentSchema.parse(body);

    // Verify ownership
    const comment = await c.env.DB.prepare(
      'SELECT user_id FROM flick_comments WHERE id = ? AND is_deleted = 0'
    ).bind(commentId).first<{ user_id: string }>();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    if (comment.user_id !== user.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Update comment
    await c.env.DB.prepare(
      'UPDATE flick_comments SET content = ?, updated_at = ? WHERE id = ?'
    ).bind(content, new Date().toISOString(), commentId).run();

    return c.json({
      success: true,
      data: {
        message: 'Comment updated',
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ 
        success: false, 
        error: 'Invalid comment data',
        details: error.errors 
      }, 400);
    }
    console.error('Error updating comment:', error);
    return c.json({ success: false, error: 'Failed to update comment' }, 500);
  }
});

// Delete comment
commentsRouter.delete('/:commentId', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    // Verify ownership
    const comment = await c.env.DB.prepare(
      'SELECT user_id, flick_id FROM flick_comments WHERE id = ? AND is_deleted = 0'
    ).bind(commentId).first<{ user_id: string; flick_id: string }>();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    if (comment.user_id !== user.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Soft delete comment
    await c.env.DB.prepare(
      'UPDATE flick_comments SET is_deleted = 1, updated_at = ? WHERE id = ?'
    ).bind(new Date().toISOString(), commentId).run();

    // Update flick analytics
    await c.env.DB.prepare(
      'UPDATE flick_analytics SET comments = comments - 1 WHERE flick_id = ?'
    ).bind(comment.flick_id as string).run();

    // Update flick counter via Durable Object
    const id = c.env.FLICK_COUNTERS.idFromName(comment.flick_id as string);
    const obj = c.env.FLICK_COUNTERS.get(id);
    
    await obj.fetch(new Request('http://internal/decrement', {
      method: 'POST',
      body: JSON.stringify({ field: 'comments' }),
    }));

    return c.json({
      success: true,
      data: {
        message: 'Comment deleted',
      },
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    return c.json({ success: false, error: 'Failed to delete comment' }, 500);
  }
});

// Report comment
commentsRouter.post('/:commentId/report', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    const body = await c.req.json();
    const { reason, description } = body;

    if (!reason) {
      return c.json({ success: false, error: 'Reason is required' }, 400);
    }

    // Check if comment exists
    const comment = await c.env.DB.prepare(
      'SELECT id FROM flick_comments WHERE id = ? AND is_deleted = 0'
    ).bind(commentId).first();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    // Create report
    await c.env.DB.prepare(`
      INSERT INTO reports (
        id, type, target_id, reporter_id, reason, 
        description, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nanoid(),
      'comment',
      commentId,
      user.id,
      reason,
      description || null,
      'pending',
      new Date().toISOString()
    ).run();

    return c.json({
      success: true,
      data: {
        message: 'Comment reported successfully',
      },
    });
  } catch (error) {
    console.error('Error reporting comment:', error);
    return c.json({ success: false, error: 'Failed to report comment' }, 500);
  }
});

export { commentsRouter };