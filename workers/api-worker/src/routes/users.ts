// workers/api-worker/src/routes/users.ts

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, User } from '../types';
import { validateRequest } from '../utils/validation';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Update profile schema
const updateProfileSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  bio: z.string().max(500).optional(),
  profile_image: z.string().url().optional()
});

// Get current user profile
router.get('/me', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // Try cache first
    const cacheKey = `user:${user.id}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');
    if (cached) {
      return c.json({ success: true, data: cached });
    }
    
    // Get from database
    const userData = await c.env.DB.prepare(`
      SELECT 
        id, email, username, profile_image, bio,
        followers_count, following_count, posts_count,
        is_verified, created_at, updated_at
      FROM users 
      WHERE id = ?
    `).bind(user.id).first();
    
    if (!userData) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    
    // Cache for 10 minutes
    await c.env.CACHE.put(cacheKey, JSON.stringify(userData), {
      expirationTtl: 600
    });
    
    return c.json({ success: true, data: userData });
    
  } catch (error) {
    console.error('Get user profile error:', error);
    return c.json({ success: false, error: 'Failed to get profile' }, 500);
  }
});

// Get user by ID
router.get('/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const currentUser = c.get('user');
    
    // Try cache first
    const cacheKey = `user:${userId}`;
    const cached = await c.env.CACHE.get(cacheKey, 'json');
    if (cached) {
      return c.json({ success: true, data: cached });
    }
    
    // Get from database
    const userData = await c.env.DB.prepare(`
      SELECT 
        id, username, profile_image, bio,
        followers_count, following_count, posts_count,
        is_verified, created_at
      FROM users 
      WHERE id = ?
    `).bind(userId).first();
    
    if (!userData) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    
    // Add following status if current user is authenticated
    let isFollowing = false;
    if (currentUser && currentUser.id !== userId) {
      const follow = await c.env.DB.prepare(
        'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?'
      ).bind(currentUser.id, userId).first();
      isFollowing = !!follow;
    }
    
    const result = {
      ...userData,
      isFollowing
    };
    
    // Cache for 10 minutes
    await c.env.CACHE.put(cacheKey, JSON.stringify(userData), {
      expirationTtl: 600
    });
    
    return c.json({ success: true, data: result });
    
  } catch (error) {
    console.error('Get user by ID error:', error);
    return c.json({ success: false, error: 'Failed to get user' }, 500);
  }
});

// Update current user profile
router.put('/me', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    const body = await c.req.json();
    const validated = validateRequest(updateProfileSchema, body);
    
    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid input', 
        details: validated.errors 
      }, 400);
    }
    
    // Check if username is taken
    if (validated.data.username) {
      const existing = await c.env.DB.prepare(
        'SELECT id FROM users WHERE username = ? AND id != ?'
      ).bind(validated.data.username, user.id).first();
      
      if (existing) {
        return c.json({ 
          success: false, 
          error: 'Username already taken' 
        }, 409);
      }
    }
    
    // Build update query
    const updateFields: string[] = [];
    const values: any[] = [];
    
    if (validated.data.username !== undefined) {
      updateFields.push('username = ?');
      values.push(validated.data.username);
    }
    
    if (validated.data.bio !== undefined) {
      updateFields.push('bio = ?');
      values.push(validated.data.bio);
    }
    
    if (validated.data.profile_image !== undefined) {
      updateFields.push('profile_image = ?');
      values.push(validated.data.profile_image);
    }
    
    if (updateFields.length === 0) {
      return c.json({ 
        success: false, 
        error: 'No fields to update' 
      }, 400);
    }
    
    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(user.id);
    
    // Update user
    await c.env.DB.prepare(`
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).bind(...values).run();
    
    // Invalidate cache
    await c.env.CACHE.delete(`user:${user.id}`);
    
    // Get updated user
    const updatedUser = await c.env.DB.prepare(`
      SELECT 
        id, email, username, profile_image, bio,
        followers_count, following_count, posts_count,
        is_verified, created_at, updated_at
      FROM users 
      WHERE id = ?
    `).bind(user.id).first();
    
    return c.json({ success: true, data: updatedUser });
    
  } catch (error) {
    console.error('Update profile error:', error);
    return c.json({ success: false, error: 'Failed to update profile' }, 500);
  }
});

// Get user's followers
router.get('/:userId/followers', async (c) => {
  try {
    const userId = c.req.param('userId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM follows WHERE following_id = ?'
    ).bind(userId).first();
    
    const total = countResult?.total as number || 0;
    
    // Get followers
    const followers = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        u.bio,
        u.followers_count,
        u.is_verified,
        f.created_at as followed_at
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();
    
    return c.json({
      success: true,
      data: followers.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get followers error:', error);
    return c.json({ success: false, error: 'Failed to get followers' }, 500);
  }
});

// Get user's following
router.get('/:userId/following', async (c) => {
  try {
    const userId = c.req.param('userId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    
    // Get total count
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM follows WHERE follower_id = ?'
    ).bind(userId).first();
    
    const total = countResult?.total as number || 0;
    
    // Get following
    const following = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.username,
        u.profile_image,
        u.bio,
        u.followers_count,
        u.is_verified,
        f.created_at as followed_at
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();
    
    return c.json({
      success: true,
      data: following.results,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + limit < total
      }
    });
    
  } catch (error) {
    console.error('Get following error:', error);
    return c.json({ success: false, error: 'Failed to get following' }, 500);
  }
});

// Search users
router.get('/search', async (c) => {
  try {
    const query = c.req.query('q');
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    
    if (!query || query.length < 2) {
      return c.json({ 
        success: false, 
        error: 'Search query must be at least 2 characters' 
      }, 400);
    }
    
    // Search by username (prefix match)
    const users = await c.env.DB.prepare(`
      SELECT 
        id, username, profile_image, bio,
        followers_count, is_verified
      FROM users
      WHERE username LIKE ?
      ORDER BY 
        CASE WHEN username = ? THEN 0 ELSE 1 END,
        followers_count DESC
      LIMIT ? OFFSET ?
    `).bind(`${query}%`, query, limit, offset).all();
    
    return c.json({
      success: true,
      data: users.results,
      pagination: {
        page,
        limit,
        hasMore: users.results.length === limit
      }
    });
    
  } catch (error) {
    console.error('Search users error:', error);
    return c.json({ success: false, error: 'Failed to search users' }, 500);
  }
});

export { router as usersRouter };