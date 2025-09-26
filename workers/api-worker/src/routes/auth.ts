// workers/api-worker/src/routes/auth.ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

const authRouter = new Hono<{ Bindings: Env }>();

// Helper to create Supabase admin client
function getSupabaseAdmin(env: Env) {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

// Helper to create Supabase client
function getSupabaseClient(env: Env) {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

// POST /api/auth/signup
authRouter.post('/signup', async (c) => {
  try {
    const { email, password, username, fullName } = await c.req.json();

    if (!email || !password || !username) {
      return c.json({ 
        success: false, 
        error: 'Email, password and username are required' 
      }, 400);
    }

    if (password.length < 8) {
      return c.json({ 
        success: false, 
        error: 'Password must be at least 8 characters' 
      }, 400);
    }

    console.log('Creating user account for:', email);

    const existingUsername = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();

    if (existingUsername) {
      return c.json({ 
        success: false, 
        error: 'Username already taken' 
      }, 400);
    }

    const existingEmail = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existingEmail) {
      return c.json({ 
        success: false, 
        error: 'An account with this email already exists' 
      }, 400);
    }

    const supabase = getSupabaseClient(c.env);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.toLowerCase(),
      password,
      options: {
        data: {
          username,
          full_name: fullName || username,
        }
      }
    });

    if (authError) {
      console.error('Supabase signup error:', authError);
      return c.json({ 
        success: false, 
        error: authError.message || 'Failed to create account' 
      }, 400);
    }

    if (!authData.user || !authData.session) {
      return c.json({ 
        success: false, 
        error: 'Failed to create account - no session returned' 
      }, 500);
    }

    const userId = nanoid();
    const passwordHash = await bcrypt.hash(password, 10);

    await c.env.DB.prepare(`
      INSERT INTO users (
        id, 
        email, 
        username, 
        password_hash,
        is_active,
        is_verified,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      userId,
      email.toLowerCase(),
      username,
      passwordHash
    ).run();

    const newUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, followers_count, following_count, 
             posts_count, flicks_count, created_at
      FROM users 
      WHERE id = ?
    `).bind(userId).first();

    // WORKAROUND: Use access token for both fields
    const accessToken = authData.session.access_token;
    
    return c.json({
      success: true,
      token: accessToken,
      refresh_token: accessToken, // Use access token as refresh token
      user: {
        ...newUser,
        displayName: fullName || username,
      }
    });

  } catch (error: any) {
    console.error('Signup error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to create account' 
    }, 500);
  }
});

// POST /api/auth/login  
authRouter.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ 
        success: false, 
        error: 'Email and password are required' 
      }, 400);
    }

    console.log('Logging in user:', email);

    const supabase = getSupabaseClient(c.env);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });

    if (authError) {
      console.error('Supabase login error:', authError);
      return c.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, 401);
    }

    if (!authData.user || !authData.session) {
      return c.json({ 
        success: false, 
        error: 'Login failed' 
      }, 401);
    }

    const dbUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, is_active, followers_count, 
             following_count, posts_count, flicks_count,
             created_at, stripe_customer_id
      FROM users 
      WHERE email = ?
    `).bind(email.toLowerCase()).first();

    if (!dbUser) {
      const userId = nanoid();
      const username = authData.user.user_metadata?.username || 
                     email.split('@')[0] || 
                     'user' + Date.now();
      
      await c.env.DB.prepare(`
        INSERT INTO users (
          id, 
          email, 
          username, 
          password_hash,
          is_active,
          is_verified,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        userId,
        email.toLowerCase(),
        username,
        'supabase_auth'
      ).run();

      const newUser = await c.env.DB.prepare(`
        SELECT id, email, username, profile_image, bio, 
               is_verified, followers_count, following_count, 
               posts_count, flicks_count, created_at
        FROM users 
        WHERE id = ?
      `).bind(userId).first();

      // WORKAROUND: Use access token for both fields
      const accessToken = authData.session.access_token;
      
      return c.json({
        success: true,
        token: accessToken,
        refresh_token: accessToken,
        user: newUser
      });
    }

    if (!(dbUser as any).is_active) {
      return c.json({ 
        success: false, 
        error: 'Account is deactivated' 
      }, 403);
    }

    // WORKAROUND: Use access token for both fields
    const accessToken = authData.session.access_token;
    
    return c.json({
      success: true,
      token: accessToken,
      refresh_token: accessToken, // Use access token as refresh token
      user: dbUser
    });

  } catch (error: any) {
    console.error('Login error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Login failed' 
    }, 500);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ success: true });
    }

    const token = authHeader.substring(7);
    const supabase = getSupabaseClient(c.env);
    
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error('Logout error:', error);
    } catch (e) {
      console.error('Supabase signout error:', e);
    }

    return c.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });

  } catch (error: any) {
    console.error('Logout error:', error);
    return c.json({ success: true });
  }
});

// GET /api/auth/profile
authRouter.get('/profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ 
        success: false, 
        error: 'Missing authorization' 
      }, 401);
    }

    const token = authHeader.substring(7);
    const supabase = getSupabaseClient(c.env);
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }

    const dbUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, is_active, followers_count, 
             following_count, posts_count, flicks_count,
             created_at, updated_at, stripe_customer_id
      FROM users 
      WHERE email = ?
    `).bind(supabaseUser.email!).first();

    if (!dbUser) {
      return c.json({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    return c.json({
      success: true,
      user: dbUser
    });

  } catch (error: any) {
    console.error('Get profile error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to get profile' 
    }, 500);
  }
});

// PUT /api/auth/profile
authRouter.put('/profile', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ 
        success: false, 
        error: 'Missing authorization' 
      }, 401);
    }

    const token = authHeader.substring(7);
    const supabase = getSupabaseClient(c.env);
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }

    const updates = await c.req.json();
    const updateFields = [];
    const updateValues = [];

    if (updates.username !== undefined) {
      updateFields.push('username = ?');
      updateValues.push(updates.username);
    }

    if (updates.bio !== undefined) {
      updateFields.push('bio = ?');
      updateValues.push(updates.bio);
    }

    if (updates.profile_image !== undefined) {
      updateFields.push('profile_image = ?');
      updateValues.push(updates.profile_image);
    }

    if (updateFields.length === 0) {
      return c.json({ 
        success: false, 
        error: 'No valid fields to update' 
      }, 400);
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(supabaseUser.email!);

    await c.env.DB.prepare(`
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE email = ?
    `).bind(...updateValues).run();

    const updatedUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, followers_count, following_count, 
             posts_count, flicks_count, created_at, updated_at
      FROM users 
      WHERE email = ?
    `).bind(supabaseUser.email!).first();

    return c.json({
      success: true,
      user: updatedUser
    });

  } catch (error: any) {
    console.error('Update profile error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to update profile' 
    }, 500);
  }
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ 
        success: false, 
        error: 'Email is required' 
      }, 400);
    }

    const supabase = getSupabaseClient(c.env);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${c.env.FRONTEND_URL}/reset-password`,
    });

    if (error) {
      console.error('Password reset error:', error);
      return c.json({ 
        success: false, 
        error: error.message || 'Failed to send reset email' 
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Password reset email sent'
    });

  } catch (error: any) {
    console.error('Reset password error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to send reset email' 
    }, 500);
  }
});

// POST /api/auth/refresh - WORKAROUND VERSION
authRouter.post('/refresh', async (c) => {
  try {
    const { refresh_token } = await c.req.json();
    
    if (!refresh_token) {
      return c.json({ 
        success: false, 
        error: 'Refresh token required' 
      }, 400);
    }

    // WORKAROUND: If it's a JWT (access token), verify it's still valid
    if (refresh_token && refresh_token.startsWith('eyJ')) {
      const supabase = getSupabaseClient(c.env);
      
      // Try to get user with the token to check if it's still valid
      const { data: { user }, error } = await supabase.auth.getUser(refresh_token);
      
      if (error || !user) {
        console.error('Token expired or invalid:', error);
        return c.json({ 
          success: false, 
          error: 'Token expired, please login again' 
        }, 401);
      }

      // Token is still valid, get user from database
      const dbUser = await c.env.DB.prepare(`
        SELECT id, email, username, profile_image, bio, 
               is_verified, followers_count, following_count, 
               posts_count, flicks_count, created_at
        FROM users 
        WHERE email = ?
      `).bind(user.email).first();

      if (!dbUser) {
        return c.json({ 
          success: false, 
          error: 'User not found' 
        }, 404);
      }

      // Return the same token since it's still valid
      return c.json({
        success: true,
        token: refresh_token,
        refresh_token: refresh_token,
        user: dbUser
      });
    }
    
    // If it's not a JWT, it's invalid
    console.error('Invalid refresh token format received');
    return c.json({ 
      success: false, 
      error: 'Invalid refresh token format' 
    }, 400);

  } catch (error: any) {
    console.error('Refresh token error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to refresh token' 
    }, 500);
  }
});

export { authRouter };