import type { Context } from 'hono';
import type { Env } from '../types';

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
    
    // Just decode the token without verifying signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return c.json({ error: 'Invalid token format' }, 401);
    }
    
    // Decode payload
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    // Get user data directly
    const user = await c.env.DB.prepare(
      'SELECT id, email, username, profile_image, bio FROM users WHERE id = ? AND is_active = 1'
    ).bind(payload.sub).first();
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    return c.json({
      valid: true,
      user
    });
    
  } catch (error: any) {
    console.error('Verify error:', error);
    return c.json({ error: error.message || 'Invalid token' }, 401);
  }
}