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
    
    // FIX: Include user data in response
    const enrichedPost = {
      ...post,
      username: user.username,
      user_profile_image: null, // Will be fetched if needed
      is_verified: false
    };
    
    return c.json({ 
      success: true, 
      data: enrichedPost  // FIX: Always use 'data' field
    }, 201);
    
  } catch (error) {
    console.error('Create post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create post' 
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
    
    return c.json({ 
      success: true, 
      data: post  // FIX: Always use 'data' field
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
    
    // FIX: Create update data object with correct type
    const updateData: any = {};
    if (validated.data.content !== undefined) {
      updateData.content = validated.data.content;
    }
    if (validated.data.media_urls !== undefined) {
      updateData.media_urls = validated.data.media_urls;
    }
    if (validated.data.visibility !== undefined) {
      updateData.visibility = validated.data.visibility;
    }
    
    const updatedPost = await postService.updatePost(postId, updateData);
    
    // FIX: Include user data
    const enrichedPost = {
      ...updatedPost,
      username: user.username,
      user_profile_image: null,
      is_verified: false
    };
    
    return c.json({ 
      success: true, 
      data: enrichedPost  // FIX: Always use 'data' field
    });
    
  } catch (error) {
    console.error('Update post error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update post' 
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
    // FIX: Correct parameter order - userId, currentUserId, page, limit
    const result = await postService.getUserPosts(userId, currentUser?.id, page, limit);
    
    return c.json({
      success: true,
      data: result.posts,  // FIX: Always use 'data' field
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
      data: []  // FIX: Include empty data array
    }, 500);
  }
});

export { router as postsRouter };