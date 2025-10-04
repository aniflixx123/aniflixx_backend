// workers/api-worker/src/routes/postComments.ts

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

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
const createCommentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(500),
  parentId: z.string().optional(),
});

const updateCommentSchema = z.object({
  content: z.string().min(1).max(500),
});

// Create comment on a post
router.post('/', async (c) => {
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const { postId, content, parentId } = createCommentSchema.parse(body);

    // Check if post exists
    const post = await c.env.DB.prepare(
      'SELECT id, user_id FROM posts WHERE id = ?'
    ).bind(postId).first();

    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    // Create comment
    const commentId = nanoid();
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO post_comments (
        id, post_id, user_id, content, parent_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      commentId,
      postId,
      user.id,
      content,
      parentId || null,
      now,
      now
    ).run();

    // Update post comment count
    await c.env.DB.prepare(
      'UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?'
    ).bind(postId).run();

    // Update counter via Durable Object
    const counterId = c.env.POST_COUNTERS.idFromName(postId);
    const counter = c.env.POST_COUNTERS.get(counterId);
    
    await counter.fetch(new Request('http://internal/increment', {
      method: 'POST',
      body: JSON.stringify({ field: 'comments' }),
    }));

    // Get user info for response
    const userInfo = await c.env.DB.prepare(
      'SELECT username, profile_image FROM users WHERE id = ?'
    ).bind(user.id).first();

    // Create notification if not commenting on own post - FIXED
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
        'post_comment',
        'post',
        postId,
        `${userInfo?.username || 'Someone'} commented on your post`,
        0,
        now
      ).run();
    }

    // Invalidate cache
    await c.env.CACHE.delete(`post:${postId}`);
    await c.env.CACHE.delete(`post:comments:${postId}`);

    return c.json({
      success: true,
      data: {
        id: commentId,
        _id: commentId, // For frontend compatibility
        postId,
        uid: user.id,
        userId: user.id,
        username: userInfo?.username || 'Anonymous',
        profileImage: userInfo?.profile_image || null,
        text: content,
        content,
        parentId: parentId || null,
        parentCommentId: parentId || null,
        likes: 0,
        likesCount: 0,
        isLiked: false,
        replies: [],
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
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

// Get comments for a post
router.get('/post/:postId', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('postId');
  
  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = (page - 1) * limit;

  try {
    // Get total count
    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM post_comments WHERE post_id = ? AND parent_id IS NULL'
    ).bind(postId).first();
    
    const total = totalResult?.total as number || 0;

    // Get comments with user info and like status
    const commentsData = await c.env.DB.prepare(`
      SELECT 
        c.*,
        u.username,
        u.profile_image,
        CASE WHEN pcl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked,
        (SELECT COUNT(*) FROM post_comments WHERE parent_id = c.id) as reply_count
      FROM post_comments c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN post_comment_likes pcl ON c.id = pcl.comment_id AND pcl.user_id = ?
      WHERE c.post_id = ? AND c.parent_id IS NULL
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user?.id || '', postId, limit, offset).all();

    const comments = commentsData.results.map((comment: any) => ({
      id: comment.id,
      _id: comment.id,
      postId: comment.post_id,
      uid: comment.user_id,
      userId: comment.user_id,
      username: comment.username,
      profileImage: comment.profile_image,
      text: comment.content,
      content: comment.content,
      parentId: comment.parent_id,
      parentCommentId: comment.parent_id,
      likes: comment.likes_count || 0,
      likesCount: comment.likes_count || 0,
      isLiked: !!comment.is_liked,
      replyCount: comment.reply_count || 0,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    }));

    return c.json({
      success: true,
      data: comments,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return c.json({ success: false, error: 'Failed to load comments' }, 500);
  }
});

// Get replies to a comment
router.get('/:commentId/replies', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  try {
    const replies = await c.env.DB.prepare(`
      SELECT 
        c.*,
        u.username,
        u.profile_image,
        CASE WHEN pcl.user_id IS NOT NULL THEN 1 ELSE 0 END as is_liked
      FROM post_comments c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN post_comment_likes pcl ON c.id = pcl.comment_id AND pcl.user_id = ?
      WHERE c.parent_id = ?
      ORDER BY c.created_at ASC
    `).bind(user?.id || '', commentId).all();

    const processedReplies = replies.results.map((reply: any) => ({
      id: reply.id,
      _id: reply.id,
      postId: reply.post_id,
      uid: reply.user_id,
      userId: reply.user_id,
      username: reply.username,
      profileImage: reply.profile_image,
      text: reply.content,
      content: reply.content,
      parentId: reply.parent_id,
      parentCommentId: reply.parent_id,
      likes: reply.likes_count || 0,
      likesCount: reply.likes_count || 0,
      isLiked: !!reply.is_liked,
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
router.post('/:commentId/like', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    // Check if comment exists
    const comment = await c.env.DB.prepare(
      'SELECT id, post_id, user_id FROM post_comments WHERE id = ?'
    ).bind(commentId).first();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    // Check if already liked
    const existing = await c.env.DB.prepare(
      'SELECT id FROM post_comment_likes WHERE comment_id = ? AND user_id = ?'
    ).bind(commentId, user.id).first();

    if (existing) {
      // Unlike
      await c.env.DB.prepare(
        'DELETE FROM post_comment_likes WHERE comment_id = ? AND user_id = ?'
      ).bind(commentId, user.id).run();

      // Update likes count
      await c.env.DB.prepare(
        'UPDATE post_comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?'
      ).bind(commentId).run();

      // Invalidate cache
      await c.env.CACHE.delete(`post:comments:${comment.post_id}`);

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
        'INSERT INTO post_comment_likes (id, comment_id, user_id, created_at) VALUES (?, ?, ?, ?)'
      ).bind(nanoid(), commentId, user.id, new Date().toISOString()).run();

      // Update likes count
      await c.env.DB.prepare(
        'UPDATE post_comments SET likes_count = likes_count + 1 WHERE id = ?'
      ).bind(commentId).run();

      // Create notification if not liking own comment
      if (comment.user_id !== user.id) {
        const userInfo = await c.env.DB.prepare(
          'SELECT username FROM users WHERE id = ?'
        ).bind(user.id).first();

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
          `${userInfo?.username || 'Someone'} liked your comment`,
          0,
          new Date().toISOString()
        ).run();
      }

      // Invalidate cache
      await c.env.CACHE.delete(`post:comments:${comment.post_id}`);

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
router.patch('/:commentId', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const { content } = updateCommentSchema.parse(body);

    // Verify ownership
    const comment = await c.env.DB.prepare(
      'SELECT user_id, post_id FROM post_comments WHERE id = ?'
    ).bind(commentId).first();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    if (comment.user_id !== user.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Update comment
    await c.env.DB.prepare(
      'UPDATE post_comments SET content = ?, updated_at = ? WHERE id = ?'
    ).bind(content, new Date().toISOString(), commentId).run();

    // Invalidate cache
    await c.env.CACHE.delete(`post:comments:${comment.post_id}`);

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
router.delete('/:commentId', async (c) => {
  const user = c.get('user');
  const commentId = c.req.param('commentId');

  if (!user) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    // Verify ownership
    const comment = await c.env.DB.prepare(
      'SELECT user_id, post_id FROM post_comments WHERE id = ?'
    ).bind(commentId).first();

    if (!comment) {
      return c.json({ success: false, error: 'Comment not found' }, 404);
    }

    if (comment.user_id !== user.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Delete comment and its replies
    await c.env.DB.batch([
      // Delete the comment
      c.env.DB.prepare('DELETE FROM post_comments WHERE id = ?').bind(commentId),
      // Delete replies
      c.env.DB.prepare('DELETE FROM post_comments WHERE parent_id = ?').bind(commentId),
      // Delete likes
      c.env.DB.prepare('DELETE FROM post_comment_likes WHERE comment_id = ?').bind(commentId),
      // Update post comment count
      c.env.DB.prepare(
             'UPDATE posts SET comments_count = CASE WHEN comments_count > 0 THEN comments_count - 1 ELSE 0 END WHERE id = ?'
      ).bind(comment.post_id)
    ]);

    // Update counter via Durable Object
    const counterId = c.env.POST_COUNTERS.idFromName(comment.post_id as string);
    const counter = c.env.POST_COUNTERS.get(counterId);
    
    await counter.fetch(new Request('http://internal/decrement', {
      method: 'POST',
      body: JSON.stringify({ field: 'comments' }),
    }));

    // Invalidate cache
    await c.env.CACHE.delete(`post:${comment.post_id}`);
    await c.env.CACHE.delete(`post:comments:${comment.post_id}`);

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

export { router as postCommentsRouter };