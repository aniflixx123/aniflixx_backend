import { nanoid } from 'nanoid';
import type { Context } from 'hono';
import type { Env } from '../types';
import { hashPassword } from '../utils/password';
import { validateEmail, validatePassword, validateUsername } from '../utils/validation';
import { generateToken } from '../utils/jwt';

type Variables = {
  user?: any;
};

export async function signup(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const { email, password, username } = await c.req.json();
    
    // Validate input
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400);
    }
    
    if (!validateEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }
    
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return c.json({ 
        error: 'Invalid password', 
        details: passwordValidation.errors 
      }, 400);
    }
    
    if (username) {
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return c.json({ error: usernameValidation.error }, 400);
      }
    }
    
    // Check if user exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? OR (username = ? AND username IS NOT NULL)'
    ).bind(email.toLowerCase(), username?.toLowerCase()).first();
    
    if (existingUser) {
      return c.json({ error: 'User already exists' }, 409);
    }
    
    // Create user
    const userId = nanoid();
    const hashedPassword = await hashPassword(password);
    
    await c.env.DB.prepare(`
      INSERT INTO users (id, email, username, password_hash)
      VALUES (?, ?, ?, ?)
    `).bind(
      userId,
      email.toLowerCase(),
      username?.toLowerCase() || null,
      hashedPassword
    ).run();
    
    // Generate JWT
    const token = generateToken(
      {
        sub: userId,
        email: email.toLowerCase(),
        username: username?.toLowerCase()
      },
      c.env.JWT_SECRET,
      c.env.JWT_ISSUER,
      c.env.JWT_EXPIRY
    );
    
    // Store session
    const sessionId = nanoid();
    const tokenHash = await hashPassword(token); // Hash token for storage
    
    await c.env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, datetime('now', '+7 days'))
    `).bind(sessionId, userId, tokenHash).run();
    
    // Also store in KV for fast lookups
    await c.env.SESSIONS.put(
      `session:${userId}:${sessionId}`,
      JSON.stringify({
        userId,
        email: email.toLowerCase(),
        username: username?.toLowerCase()
      }),
      { expirationTtl: 604800 } // 7 days
    );
    
    return c.json({
      success: true,
      token,
      user: {
        id: userId,
        email: email.toLowerCase(),
        username: username?.toLowerCase() || null
      }
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}