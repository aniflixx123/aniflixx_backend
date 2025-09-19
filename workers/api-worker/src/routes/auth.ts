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
    env.SUPABASE_SERVICE_KEY, // Use service key for admin operations
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

    // Validate input
    if (!email || !password || !username) {
      return c.json({ 
        success: false, 
        error: 'Email, password and username are required' 
      }, 400);
    }

    // Validate password strength
    if (password.length < 8) {
      return c.json({ 
        success: false, 
        error: 'Password must be at least 8 characters' 
      }, 400);
    }

    console.log('Creating user account for:', email);

    // Check if username already exists in YOUR database
    const existingUsername = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();

    if (existingUsername) {
      return c.json({ 
        success: false, 
        error: 'Username already taken' 
      }, 400);
    }

    // Check if email already exists in YOUR database
    const existingEmail = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existingEmail) {
      return c.json({ 
        success: false, 
        error: 'Email already registered' 
      }, 400);
    }

    // Create Supabase auth user
    const supabase = getSupabaseClient(c.env);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.toLowerCase(),
      password,
      options: {
        data: {
          username,
          full_name: fullName || username,
        },
      },
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
        error: 'Failed to create account' 
      }, 400);
    }

    // Create user in YOUR database with YOUR ID system
    const userId = nanoid();
    const passwordHash = await bcrypt.hash(password, 10); // Store hash as backup
    
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
      passwordHash // Store password hash as backup
    ).run();

    // Fetch the created user
    const newUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, followers_count, following_count, 
             posts_count, flicks_count, created_at
      FROM users 
      WHERE id = ?
    `).bind(userId).first();

    return c.json({
      success: true,
      token: authData.session.access_token,
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

    // Sign in with Supabase
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

    // Fetch user from YOUR database
    const dbUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, is_active, followers_count, 
             following_count, posts_count, flicks_count,
             created_at, stripe_customer_id
      FROM users 
      WHERE email = ?
    `).bind(email.toLowerCase()).first();

    if (!dbUser) {
      // User exists in Supabase but not in your DB - create them
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

      return c.json({
        success: true,
        token: authData.session.access_token,
        user: newUser
      });
    }

    // Check if user is active
    if (!(dbUser as any).is_active) {
      return c.json({ 
        success: false, 
        error: 'Account is deactivated' 
      }, 403);
    }

    return c.json({
      success: true,
      token: authData.session.access_token,
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
      return c.json({ success: true }); // Already logged out
    }

    const token = authHeader.substring(7);
    
    // Sign out from Supabase
    const supabase = getSupabaseClient(c.env);
    await supabase.auth.admin.signOut(token);

    return c.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });

  } catch (error: any) {
    console.error('Logout error:', error);
    // Return success anyway - user wants to log out
    return c.json({ success: true });
  }
});

// GET /api/auth/profile - Get current user profile
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
    
    // Verify token with Supabase
    const supabase = getSupabaseClient(c.env);
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }

    // Fetch user from YOUR database
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

// PUT /api/auth/profile - Update profile
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
    const updates = await c.req.json();
    
    // Verify token with Supabase
    const supabase = getSupabaseClient(c.env);
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }

    // Build update query dynamically
    const allowedFields = ['username', 'bio', 'profile_image', 'display_name'];
    const updateFields = [];
    const updateValues = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(updates[field]);
      }
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

    // Fetch updated user
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

// POST /api/auth/refresh - Refresh token
authRouter.post('/refresh', async (c) => {
  try {
    const { refresh_token } = await c.req.json();
    
    if (!refresh_token) {
      return c.json({ 
        success: false, 
        error: 'Refresh token required' 
      }, 401);
    }
    
    // Refresh session with Supabase using the refresh token
    const supabase = getSupabaseClient(c.env);
    const { data, error }:any = await supabase.auth.refreshSession({
      refresh_token: refresh_token
    });

    if (error || !data.session) {
      console.error('Refresh error:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to refresh token' 
      }, 401);
    }

    // Get user from database
    const dbUser = await c.env.DB.prepare(`
      SELECT id, email, username, profile_image, bio, 
             is_verified, followers_count, following_count, 
             posts_count, flicks_count, created_at, updated_at,
             stripe_customer_id
      FROM users 
      WHERE email = ?
    `).bind(data.user.email!).first();

    return c.json({
      success: true,
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: dbUser
    });

  } catch (error: any) {
    console.error('Refresh token error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to refresh token' 
    }, 500);
  }
});

// GET /api/test-auth - Verify token is valid
authRouter.get('/test-auth', async (c:any) => {
  try {
    //authMiddleware sets c.set('user', user) if token is valid
    const user = c.get('user');
    
    if (!user) {
      return c.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, 401);
    }
    
    // Token is valid, return success
    return c.json({ 
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      }
    });
    
  } catch (error) {
    console.error('Test auth error:', error);
    return c.json({ 
      success: false, 
      error: 'Invalid token' 
    }, 401);
  }
});

export { authRouter };