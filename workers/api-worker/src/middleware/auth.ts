// workers/api-worker/src/middleware/auth.ts
// FIXED VERSION - Handles JWT token decoding properly

import type { Context, Next } from 'hono';
import type { Env } from '../types';

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
    
    try {
      // Decode JWT token
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('Auth middleware: Invalid token format - expected 3 parts, got', parts.length);
        return c.json({ 
          success: false, 
          error: 'Invalid token format' 
        }, 401);
      }
      
      // Decode the payload (handle URL-safe base64)
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
      );
      
      console.log('Auth middleware: Decoded payload:', {
        sub: payload.sub,
        email: payload.email,
        username: payload.username,
        exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'no expiry'
      });
      
      // Check token expiration if present
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        console.error('Auth middleware: Token expired at', new Date(payload.exp * 1000));
        return c.json({ 
          success: false, 
          error: 'Token expired' 
        }, 401);
      }
      
      // Verify user exists in database (optional but recommended)
      const userCheck = await c.env.DB.prepare(
        'SELECT id, email, username FROM users WHERE id = ? AND is_active = 1'
      ).bind(payload.sub).first() as { id: string; email: string; username: string | null } | undefined;
      
      if (!userCheck) {
        console.error('Auth middleware: User not found or inactive:', payload.sub);
        return c.json({ 
          success: false, 
          error: 'User not found or inactive' 
        }, 401);
      }
      
      console.log('Auth middleware: User verified:', userCheck.username || userCheck.email);
      
      // Set user in context with verified data
      const userContext = {
        id: userCheck.id,
        email: userCheck.email,
        username: userCheck.username || payload.username || userCheck.email.split('@')[0]
      };
      
      c.set('user' as any, userContext);
      
      console.log('Auth middleware: Authentication successful for user:', userCheck.id);
      await next();
      
    } catch (error: any) {
      console.error('Auth middleware: Token decode error:', error.message);
      console.error('Auth middleware: Error stack:', error.stack);
      
      return c.json({ 
        success: false, 
        error: 'Invalid token: ' + error.message 
      }, 401);
    }
  } catch (error: any) {
    console.error('Auth middleware: Unexpected error:', error);
    console.error('Auth middleware: Error stack:', error.stack);
    
    return c.json({ 
      success: false, 
      error: 'Authentication failed: ' + error.message 
    }, 500);
  }
}