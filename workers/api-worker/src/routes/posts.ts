// workers/api-worker/src/routes/posts.ts

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env, Post } from '../types';
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

// Validation schemas
const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  media_urls: z.array(z.string().url()).optional().nullable(),
  type: z.enum(['text', 'image', 'video']).default('text'),
  visibility: z.enum(['public', 'followers', 'clan']).default('public'),
  clan_id: z.string().optional().nullable()
});

type CreatePostInput = z.infer<typeof createPostSchema>;

const updatePostSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
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
    
    // Manually validate and apply defaults
    const postInput = {
      content: body.content,
      media_urls: body.media_urls || null,
      type: body.type || 'text',
      visibility: body.visibility || 'public',
      clan_id: body.clan_id || null
    };
    
    // Validate the modified input
    const validated = validateRequest(createPostSchema, postInput);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
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
    
    return c.json({ 
      success: true, 
      data: post 
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
      data: post 
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
    const validated = validateRequest(updatePostSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
      }, 400);
    }
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    
    // Check ownership
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
        error: 'Unauthorized to update this post' 
      }, 403);
    }
    
    const updatedPost = await postService.updatePost(postId, validated.data);
    
    return c.json({ 
      success: true, 
      data: updatedPost 
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
    
    // Check ownership
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

// Get user's posts
router.get('/user/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const currentUser = c.get('user');
    
    const postService = new PostService(c.env.DB, c.env.CACHE, c.env.POST_COUNTERS);
    const result = await postService.getUserPosts(userId, currentUser?.id, page, limit);
    
    return c.json({ 
      success: true, 
      data: result.posts,
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
      error: 'Failed to get user posts' 
    }, 500);
  }
});

export { router as postsRouter };