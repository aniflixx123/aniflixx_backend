import { nanoid } from 'nanoid';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

type Variables = {
  user?: any;
};

export async function login(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const { email, password } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400);
    }
    
    // Find user
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE'
    ).bind(email.toLowerCase()).first<User>();
    
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    // Verify password
    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    // Generate JWT
    const token = generateToken(
      {
        sub: user.id,
        email: user.email,
        username: user.username || undefined
      },
      c.env.JWT_SECRET,
      c.env.JWT_ISSUER,
      c.env.JWT_EXPIRY
    );
    
    // Store session
    const sessionId = nanoid();
    const tokenHash = await hashPassword(token);
    
    await c.env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, datetime('now', '+7 days'))
    `).bind(sessionId, user.id, tokenHash).run();
    
    // Store in KV
    await c.env.SESSIONS.put(
      `session:${user.id}:${sessionId}`,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        username: user.username
      }),
      { expirationTtl: 604800 }
    );
    
    return c.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        profile_image: user.profile_image,
        bio: user.bio
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}