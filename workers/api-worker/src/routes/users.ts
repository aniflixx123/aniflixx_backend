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

// workers/api-worker/src/routes/users.ts
// Fixed /me endpoint with better error handling

// Get current user profile - FIXED VERSION
router.get('/me', async (c) => {
  try {
    console.log('/users/me: Starting request');
    
    const user = c.get('user');
    console.log('/users/me: User from context:', user);
    
    if (!user) {
      console.error('/users/me: No user in context - auth middleware failed?');
      return c.json({ success: false, error: 'Unauthorized - no user in context' }, 401);
    }
    
    // Try cache first
    const cacheKey = `user:${user.id}`;
    try {
      const cached = await c.env.CACHE.get(cacheKey, 'json');
      if (cached) {
        console.log('/users/me: Returning cached data');
        return c.json({ success: true, data: cached });
      }
    } catch (cacheError) {
      console.warn('/users/me: Cache error (non-fatal):', cacheError);
    }
    
    // Get from database
    console.log('/users/me: Fetching from database for user:', user.id);
    
    const userData = await c.env.DB.prepare(`
      SELECT 
        id, email, username, profile_image, bio,
        followers_count, following_count, posts_count, flicks_count,
        is_verified, is_active, created_at, updated_at
      FROM users 
      WHERE id = ?
    `).bind(user.id).first();
    
    console.log('/users/me: Database query result:', userData ? 'Found' : 'Not found');
    
    if (!userData) {
      console.error('/users/me: User not found in database:', user.id);
      return c.json({ success: false, error: 'User not found in database' }, 404);
    }
    
    // Ensure user is active
    if (!userData.is_active) {
      console.error('/users/me: User is inactive:', user.id);
      return c.json({ success: false, error: 'User account is inactive' }, 403);
    }
    
    console.log('/users/me: User data retrieved successfully');
    
    // Format response to match frontend expectations
    const responseData = {
      id: userData.id,
      uid: userData.id, // Add uid for compatibility
      email: userData.email,
      username: userData.username,
      profile_image: userData.profile_image,
      profileImage: userData.profile_image, // Add alternative field name
      bio: userData.bio,
      followers_count: userData.followers_count || 0,
      followersCount: userData.followers_count || 0, // Alternative field name
      following_count: userData.following_count || 0,
      followingCount: userData.following_count || 0, // Alternative field name
      posts_count: userData.posts_count || 0,
      flicks_count: userData.flicks_count || 0,
      is_verified: userData.is_verified || false,
      isVerified: userData.is_verified || false, // Alternative field name
      is_active: userData.is_active,
      created_at: userData.created_at,
      updated_at: userData.updated_at
    };
    
    // Try to cache (non-blocking)
    try {
      await c.env.CACHE.put(cacheKey, JSON.stringify(responseData), {
        expirationTtl: 600 // 10 minutes
      });
      console.log('/users/me: Cached user data');
    } catch (cacheError) {
      console.warn('/users/me: Failed to cache (non-fatal):', cacheError);
    }
    
    console.log('/users/me: Returning success response');
    return c.json({ success: true, data: responseData });
    
  } catch (error: any) {
    console.error('/users/me: Unexpected error:', error);
    console.error('/users/me: Error message:', error.message);
    console.error('/users/me: Error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to get profile';
    
    if (error.message?.includes('D1_ERROR')) {
      errorMessage = 'Database error occurred';
    } else if (error.message?.includes('no such table')) {
      errorMessage = 'Database not properly configured';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return c.json({ 
      success: false, 
      error: errorMessage,
      details: c.env.ENVIRONMENT === 'development' ? {
        message: error.message,
        stack: error.stack
      } : undefined
    }, 500);
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