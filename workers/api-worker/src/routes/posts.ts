// workers/api-worker/src/routes/posts.ts

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { PostService } from '../services/post.service';
import { validateRequest } from '../utils/validation';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Post creation schema
const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  media_urls: z.array(z.string().url()).optional(),
  type: z.enum(['text', 'image', 'video']).default('text'),
  visibility: z.enum(['public', 'followers', 'clan']).default('public'),
  clan_id: z.string().optional()
});

// Post update schema
const updatePostSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  media_urls: z.array(z.string().url()).optional(),
  visibility: z.enum(['public', 'followers', 'clan']).optional()
});

// Create post
router.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json();
    const validated = await validateRequest(createPostSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: validated.errors ? validated.errors.join(', ') : 'Validation failed'  // FIX: Use 'errors' array
      }, 400);
    }
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    const post = await postService.createPost({
      user_id: user.id,
      content: validated.data.content,
      media_urls: validated.data.media_urls,
      type: validated.data.type as 'text' | 'image' | 'video',
      visibility: validated.data.visibility as 'public' | 'followers' | 'clan',
      clan_id: validated.data.clan_id
    });
    
    // Fetch complete post data with user info
    const enrichedPost = await c.env.DB.prepare(`
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
        EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).bind(user.id, user.id, post.id).first();
    
    return c.json({ 
      success: true, 
      data: enrichedPost
    }, 201);
    
  } catch (error) {
    console.error('Create post error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create post' 
    }, 500);
  }
});

// Get post by ID
router.get('/:id', async (c) => {
  try {
    const postId = c.req.param('id');
    const user = c.get('user');
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    const post = await postService.getPost(postId, user?.id);
    
    if (!post) {
      return c.json({ 
        success: false, 
        error: 'Post not found' 
      }, 404);
    }
    
    // Fetch complete post data with user info
    const enrichedPost = await c.env.DB.prepare(`
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
        EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).bind(user?.id || 'none', user?.id || 'none', postId).first();
    
    return c.json({ 
      success: true, 
      data: enrichedPost
    });
    
  } catch (error) {
    console.error('Get post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get post' 
    }, 500);
  }
});

// Update post
router.put('/:id', async (c) => {
  try {
    const postId = c.req.param('id');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json();
    const validated = await validateRequest(updatePostSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: validated.errors ? validated.errors.join(', ') : 'Validation failed'  // FIX: Use 'errors' array
      }, 400);
    }
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    
    // Check if user owns the post
    const existingPost = await postService.getPost(postId, user.id);
    if (!existingPost) {
      return c.json({ 
        success: false, 
        error: 'Post not found' 
      }, 404);
    }
    
    if (existingPost.user_id !== user.id) {
      return c.json({ 
        success: false, 
        error: 'Unauthorized to edit this post' 
      }, 403);
    }
    
    // Update the post
    const updatedPost = await postService.updatePost(postId, validated.data);
    
    // Fetch complete post data with user info
    const enrichedPost = await c.env.DB.prepare(`
      SELECT 
        p.*,
        u.username,
        u.profile_image as user_profile_image,
        u.is_verified,
        EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
        EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).bind(user.id, user.id, postId).first();
    
    return c.json({ 
      success: true, 
      data: enrichedPost
    });
    
  } catch (error) {
    console.error('Update post error:', error);
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update post' 
    }, 500);
  }
});

// Delete post
router.delete('/:id', async (c) => {
  try {
    const postId = c.req.param('id');
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    
    // Check if user owns the post
    const existingPost = await postService.getPost(postId, user.id);
    if (!existingPost) {
      return c.json({ 
        success: false, 
        error: 'Post not found' 
      }, 404);
    }
    
    if (existingPost.user_id !== user.id) {
      return c.json({ 
        success: false, 
        error: 'Unauthorized to delete this post' 
      }, 403);
    }
    
    await postService.deletePost(postId);
    
    return c.json({ 
      success: true, 
      message: 'Post deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to delete post' 
    }, 500);
  }
});

// Get user posts
router.get('/user/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const currentUser = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    const result = await postService.getUserPosts(userId, currentUser?.id, page, limit);
    
    // Enrich posts with user data
    const enrichedPosts = await Promise.all(
      result.posts.map(async (post) => {
        const enriched = await c.env.DB.prepare(`
          SELECT 
            p.*,
            u.username,
            u.profile_image as user_profile_image,
            u.is_verified,
            EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
            EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked
          FROM posts p
          LEFT JOIN users u ON p.user_id = u.id
          WHERE p.id = ?
        `).bind(currentUser?.id || 'none', currentUser?.id || 'none', post.id).first();
        return enriched;
      })
    );
    
    return c.json({
      success: true,
      data: enrichedPosts,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get user posts error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get user posts',
      data: []
    }, 500);
  }
});

// Get posts by type (trending, recent, etc.)
router.get('/feed/:type', async (c) => {
  try {
    const feedType = c.req.param('type') as 'trending' | 'recent' | 'following';
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    const result = await postService.getFeed(feedType, user?.id, page, limit);
    
    // Enrich posts with user data
    const enrichedPosts = await Promise.all(
      result.posts.map(async (post) => {
        const enriched = await c.env.DB.prepare(`
          SELECT 
            p.*,
            u.username,
            u.profile_image as user_profile_image,
            u.is_verified,
            EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
            EXISTS(SELECT 1 FROM post_bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked
          FROM posts p
          LEFT JOIN users u ON p.user_id = u.id
          WHERE p.id = ?
        `).bind(user?.id || 'none', user?.id || 'none', post.id).first();
        return enriched;
      })
    );
    
    return c.json({
      success: true,
      data: enrichedPosts,
      pagination: {
        page,
        limit,
        total: result.total,
        hasMore: result.hasMore
      }
    });
    
  } catch (error) {
    console.error('Get feed error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get feed',
      data: []
    }, 500);
  }
});

export { router as postsRouter };