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
    
    // TEMPORARY: Just decode the token without calling auth worker
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return c.json({ 
          success: false, 
          error: 'Invalid token format' 
        }, 401);
      }
      
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      
      // Set user in context
      c.set('user', {
        id: payload.sub,
        email: payload.email,
        username: payload.username || payload.email.split('@')[0]
      });
      
      await next();
    } catch (error) {
      return c.json({ 
        success: false, 
        error: 'Invalid token' 
      }, 401);
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ 
      success: false, 
      error: 'Authentication failed' 
    }, 500);
  }
}