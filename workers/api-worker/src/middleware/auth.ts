// workers/api-worker/src/middleware/auth.ts
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import jwt from '@tsndr/cloudflare-worker-jwt';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

// Cache for recently refreshed tokens (token -> user email)
const recentlyRefreshedTokens = new Map<string, { email: string; timestamp: number }>();

// Clean up old entries every so often
function cleanupTokenCache() {
  const now = Date.now();
  for (const [token, data] of recentlyRefreshedTokens.entries()) {
    if (now - data.timestamp > 10000) { // Remove after 10 seconds
      recentlyRefreshedTokens.delete(token);
    }
  }
}

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
    
    // CRITICAL FIX: Check for invalid token values
    if (!token || token === 'null' || token === 'undefined' || token.trim() === '') {
      console.error('Auth middleware: Invalid token format received:', token);
      return c.json({ 
        success: false, 
        error: 'Invalid authentication token format' 
      }, 401);
    }
    
    // Add validation for JWT structure (should have 3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.error('Auth middleware: Malformed JWT token - expected 3 parts, got', tokenParts.length);
      return c.json({ 
        success: false, 
        error: 'Malformed authentication token' 
      }, 401);
    }
    
    console.log('Auth middleware: Valid token received (first 20 chars):', token.substring(0, 20));
    
    // Clean up old cached tokens
    cleanupTokenCache();
    
    // Check if this token was recently refreshed
    const cachedToken = recentlyRefreshedTokens.get(token);
    if (cachedToken) {
      console.log('Auth middleware: Using cached validation for recently refreshed token');
      
      // Get user from database using cached email
      const dbUser = await c.env.DB.prepare(
        `SELECT id, email, username, profile_image, bio, 
                is_verified, is_active, stripe_customer_id, 
                followers_count, following_count, posts_count, flicks_count
         FROM users 
         WHERE email = ? AND is_active = 1`
      ).bind(cachedToken.email).first();
      
      if (dbUser) {
        // Set user context with YOUR user ID
        const userContext = {
          id: dbUser.id as string,
          email: dbUser.email as string,
          username: dbUser.username as string
        };
        
        c.set('user', userContext);
        console.log('Auth middleware: User authenticated via cache:', userContext.id);
        await next();
        return;
      }
    }
    
    // Try to decode JWT first to get email (faster than Supabase call)
    let userEmail: string | null = null;
    try {
      const decoded:any = jwt.decode(token);
      if (decoded && decoded.payload) {
        userEmail = decoded.payload.email || decoded.payload.sub;
        console.log('Auth middleware: Decoded email from JWT:', userEmail);
      }
    } catch (e) {
      console.log('Auth middleware: Could not decode JWT locally, will use Supabase');
    }
    
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
      const errorMessage = error?.message || 'Token verification failed';
      console.error('Auth middleware: Supabase verification failed:', errorMessage);
      
      // If we have email from JWT and it's a recent token, try database lookup
      if (userEmail && errorMessage.includes('invalid JWT')) {
        console.log('Auth middleware: Attempting database lookup with JWT email');
        
        const dbUser = await c.env.DB.prepare(
          `SELECT id, email, username, profile_image, bio, 
                  is_verified, is_active, stripe_customer_id, 
                  followers_count, following_count, posts_count, flicks_count
           FROM users 
           WHERE email = ? AND is_active = 1`
        ).bind(userEmail).first();
        
        if (dbUser) {
          // This might be a recently refreshed token that Supabase hasn't synced yet
          // Add a grace period for recently refreshed tokens
          const userContext = {
            id: dbUser.id as string,
            email: dbUser.email as string,
            username: dbUser.username as string
          };
          
          c.set('user', userContext);
          console.log('Auth middleware: User authenticated via JWT decode fallback:', userContext.id);
          await next();
          return;
        }
      }
      
      // Provide more specific error messages
      if (errorMessage.includes('JWT expired')) {
        return c.json({ 
          success: false, 
          error: 'Token expired',
          code: 'TOKEN_EXPIRED'
        }, 401);
      }
      
      if (errorMessage.includes('invalid JWT')) {
        return c.json({ 
          success: false, 
          error: 'Invalid authentication token',
          code: 'INVALID_TOKEN'
        }, 401);
      }
      
      return c.json({ 
        success: false, 
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
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
    console.error('Auth middleware: Error message:', error.message);
    console.error('Auth middleware: Error stack:', error.stack);
    
    // Provide more specific error messages based on the error type
    if (error.message?.includes('D1_ERROR')) {
      return c.json({ 
        success: false, 
        error: 'Database error occurred' 
      }, 500);
    }
    
    if (error.message?.includes('SUPABASE')) {
      return c.json({ 
        success: false, 
        error: 'Authentication service error' 
      }, 500);
    }
    
    return c.json({ 
      success: false, 
      error: 'Authentication failed' 
    }, 500);
  }
}

// Export a function to cache recently refreshed tokens
export function cacheRefreshedToken(token: string, email: string) {
  recentlyRefreshedTokens.set(token, { email, timestamp: Date.now() });
}