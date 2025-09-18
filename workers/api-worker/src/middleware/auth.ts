import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  try {
    console.log('Auth middleware: Processing request to', c.req.path);
    
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Auth middleware: Missing or invalid authorization header');
      return c.json({ 
        success: false, 
        error: 'Missing or invalid authorization header' 
      }, 401);
    }
    
    const token = authHeader.substring(7);
    console.log('Auth middleware: Token received (first 20 chars):', token.substring(0, 20));
    
    // Create Supabase client with anon key
    const supabase = createClient(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
    
    // Verify token with Supabase
    const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
    
    if (error || !supabaseUser) {
      console.error('Auth middleware: Supabase verification failed:', error);
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }
    
    console.log('Auth middleware: Supabase user verified:', supabaseUser.email);
    
    // Check if user exists in YOUR database
    let dbUser = await c.env.DB.prepare(
      `SELECT id, email, username, profile_image, bio, 
              is_verified, is_active, stripe_customer_id, 
              followers_count, following_count, posts_count, flicks_count
       FROM users 
       WHERE email = ? AND is_active = 1`
    ).bind(supabaseUser.email).first();
    
    if (!dbUser) {
      // New user - create in YOUR database with YOUR ID system
      const newUserId = nanoid();
      const username = supabaseUser.user_metadata?.username || 
                      supabaseUser.email?.split('@')[0] || 
                      'user' + Date.now();
      
      console.log('Creating new user:', newUserId, supabaseUser.email);
      
      // First, check if username already exists
      const existingUsername = await c.env.DB.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();
      
      const finalUsername = existingUsername ? `${username}_${Date.now()}` : username;
      
      // Create user - password_hash can be a placeholder since auth is via Supabase
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
        newUserId,
        supabaseUser.email,
        finalUsername,
        'supabase_auth' // Placeholder since we're using Supabase auth
      ).run();
      
      dbUser = {
        id: newUserId,
        email: supabaseUser.email,
        username: finalUsername,
        profile_image: null,
        bio: null,
        is_verified: false,
        is_active: true,
        stripe_customer_id: null,
        followers_count: 0,
        following_count: 0,
        posts_count: 0,
        flicks_count: 0
      };
      
      console.log('New user created:', dbUser);
    }
    
    // Check if user is active
    if (!dbUser.is_active) {
      console.error('Auth middleware: User is not active');
      return c.json({ 
        success: false, 
        error: 'Account is deactivated' 
      }, 403);
    }
    
    // Set user context with YOUR user ID
    const userContext = {
      id: dbUser.id as string,  // YOUR database ID, not Supabase ID!
      email: dbUser.email as string,
      username: dbUser.username as string
    };
    
    c.set('user', userContext);
    
    console.log('Auth middleware: User authenticated successfully:', userContext.id);
    await next();
    
  } catch (error: any) {
    console.error('Auth middleware: Unexpected error:', error);
    console.error('Auth middleware: Error stack:', error.stack);
    
    return c.json({ 
      success: false, 
      error: 'Authentication failed' 
    }, 500);
  }
}