import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { signup } from './routes/signup';
import { login } from './routes/login';
import { verify } from './routes/verify';
import type { Env } from './types';

// Fix: Use proper type definition
type Variables = {
  user?: any;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS configuration
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = [
      'https://aniflixx.com',
      'https://www.aniflixx.com',
      'https://app.aniflixx.com',
      'http://localhost:3000',
      'http://localhost:5173'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      return origin || allowedOrigins[0];
    }
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting middleware
app.use('/auth/*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const key = `rate_limit:${ip}`;
  
  const current = await c.env.RATE_LIMIT.get(key);
  const count = current ? parseInt(current) : 0;
  
  if (count > 10) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  
  await c.env.RATE_LIMIT.put(key, (count + 1).toString(), {
    expirationTtl: 60
  });
  
  await next();
});

// Routes
app.post('/auth/signup', signup);
app.post('/auth/login', login);
app.post('/auth/verify', verify);

// Health check
app.get('/', (c) => {
  return c.json({ 
    service: 'aniflixx-auth',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

export default app;