// workers/api-worker/src/middleware/auth.ts

import type { Context, Next } from 'hono';
import type { Env } from '../types';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

interface AuthResponse {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    username: string;
  };
  error?: string;
}

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ 
        success: false, 
        error: 'Missing or invalid authorization header' 
      }, 401);
    }
    
    const token = authHeader.substring(7);
    
    // Verify token with auth worker
    const verifyResponse = await fetch(`${c.env.AUTH_WORKER_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!verifyResponse.ok) {
      const error = await verifyResponse.json() as { error?: string };
      return c.json({ 
        success: false, 
        error: error.error || 'Invalid token' 
      }, 401);
    }
    
    const authData = await verifyResponse.json() as AuthResponse;
    
    if (!authData.valid || !authData.user) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }
    
    // Set user in context
    c.set('user', {
      id: authData.user.id,
      email: authData.user.email,
      username: authData.user.username
    });
    
    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ 
      success: false, 
      error: 'Authentication failed' 
    }, 500);
  }
}