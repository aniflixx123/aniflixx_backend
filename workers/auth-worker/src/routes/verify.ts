import type { Context } from 'hono';
import type { Env } from '../types';
import { verifyToken } from '../utils/jwt';

type Variables = {
  user?: any;
};

export async function verify(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401);
    }
    
    const token = authHeader.substring(7);
    
    try {
      // Verify JWT
      const payload = verifyToken(token, c.env.JWT_SECRET);
      
      // Check if session exists in KV (fast lookup)
      const sessions = await c.env.SESSIONS.list({
        prefix: `session:${payload.sub}:`
      });
      
      if (sessions.keys.length === 0) {
        return c.json({ error: 'Invalid session' }, 401);
      }
      
      // Get user data
      const user = await c.env.DB.prepare(
        'SELECT id, email, username, profile_image, bio FROM users WHERE id = ? AND is_active = TRUE'
      ).bind(payload.sub).first();
      
      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }
      
      return c.json({
        valid: true,
        user
      });
      
    } catch (error) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
  } catch (error) {
    console.error('Verify error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}