// File: workers/api-worker/src/routes/payments.ts
// COMPLETE FULL FILE - NO SHORTCUTS, NO ELLIPSIS

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { validateRequest } from '../utils/validation';
import type { D1Database } from '@cloudflare/workers-types';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================
// VALIDATION SCHEMAS
// ============================
const createCheckoutSchema = z.object({
  priceId: z.string(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const createPortalSchema = z.object({
  returnUrl: z.string().url().optional(),
});

const updateSubscriptionSchema = z.object({
  newPriceId: z.string(),
});

const cancelSubscriptionSchema = z.object({
  reason: z.string().optional(),
});

// NEW: Mobile-specific schemas
const registerDeviceSchema = z.object({
  device_id: z.string().min(1),
  device_model: z.string().optional(),
  platform: z.enum(['ios', 'android']),
  app_version: z.string().optional()
});

const createMobileSessionSchema = z.object({
  device_token: z.string().min(1),
  price_id: z.string().optional()
});

const createStripeSessionSchema = z.object({
  session_token: z.string().min(1),
  price_id: z.string().min(1)
});

// ============================
// HELPER FUNCTIONS
// ============================
async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const elements = signature.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.substring(2);
    const signatures = elements
      .filter(e => e.startsWith('v1='))
      .map(e => e.substring(3));

    if (!timestamp || signatures.length === 0) {
      console.error('Invalid signature format');
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - parseInt(timestamp) > 300) {
      console.error('Webhook timestamp too old');
      return false;
    }

    const encoder = new TextEncoder();
    const signedPayload = `${timestamp}.${body}`;
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    );

    const expectedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return signatures.some(sig => sig === expectedSig);
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

// ============================
// PUBLIC ENDPOINTS
// ============================

// MODIFIED: Get config with platform detection
router.get('/config', async (c) => {
  const platform = c.req.header('X-Platform');
  
  // Hide prices for iOS
  if (platform === 'ios') {
    return c.json({
      success: true,
      publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S88J1AoYPwNm8bkqDSXmLdoC2DcL6mG6NWth2VyCSWxjcR5SIuuHjGvN3vMszD1ujBaE9Yl7UXtKc4wfKohBLrw00aIBZoEwr',
      message: 'Visit our website to view pricing',
      webUrl: c.env.FRONTEND_URL,
      features: {
        pro: [
          'HD streaming up to 1080p',
          'No ads',
          'Access to seasonal anime',
          'Create up to 5 watchlists',
          'Basic community features'
        ],
        max: [
          '4K streaming',
          'No ads',
          'Offline downloads (25 episodes)',
          'Simulcast access',
          'Early access to new episodes',
          'Unlimited watchlists'
        ],
        creator_pro: [
          'All Max features',
          'Creator dashboard',
          'Upload and monetize content',
          'Verified creator badge',
          'Revenue sharing program'
        ]
      }
    });
  }

  // Return full config for Android/Web
  return c.json({
    success: true,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S88J1AoYPwNm8bkqDSXmLdoC2DcL6mG6NWth2VyCSWxjcR5SIuuHjGvN3vMszD1ujBaE9Yl7UXtKc4wfKohBLrw00aIBZoEwr',
    prices: {
      // PRO Monthly prices - Corrected from Stripe Dashboard
      pro: {
        usd: { priceId: 'price_1S8FTDAoYPwNm8bkKDjYQWiL', amount: '4.99', currency: 'usd' },
        cad: { priceId: 'price_1S8ua7AoYPwNm8bk3eOiRbJF', amount: '6.49', currency: 'cad' },
        mxn: { priceId: 'price_1S8uaJAoYPwNm8bk6ar0bcHJ', amount: '59', currency: 'mxn' },
        brl: { priceId: 'price_1S8FTsAoYPwNm8bkwRNXZkUh', amount: '9.90', currency: 'brl' },
        eur: { priceId: 'price_1S8uZfAoYPwNm8bkYLSlQJU1', amount: '3.99', currency: 'eur' },
        gbp: { priceId: 'price_1S8uZmAoYPwNm8bktzRXuI99', amount: '3.49', currency: 'gbp' },
        inr: { priceId: 'price_1S8FTXAoYPwNm8bkDEEWT73z', amount: '99', currency: 'inr' },
        idr: { priceId: 'price_1S8uXtAoYPwNm8bk2TGHigc4', amount: '75000', currency: 'idr' },
        php: { priceId: 'price_1S8uY3AoYPwNm8bkcJ506kPe', amount: '99', currency: 'php' },
        thb: { priceId: 'price_1S8uY9AoYPwNm8bkiC8C3NhK', amount: '69', currency: 'thb' },
        vnd: { priceId: 'price_1S8uaWAoYPwNm8bkrt73rGwd', amount: '120000', currency: 'vnd' },
        myr: { priceId: 'price_1S8uadAoYPwNm8bk7wts6fkT', amount: '9', currency: 'myr' },
        sgd: { priceId: 'price_1S8uawAoYPwNm8bkPPOORMcW', amount: '5.99', currency: 'sgd' },
        jpy: { priceId: 'price_1S8uZuAoYPwNm8bkZkaZo7pZ', amount: '500', currency: 'jpy' },
        aud: { priceId: 'price_1S8ua0AoYPwNm8bkwvw7Gosp', amount: '6.99', currency: 'aud' },
      },
      // MAX Monthly prices - Corrected from Stripe Dashboard
      max: {
        usd: { priceId: 'price_1S8FTKAoYPwNm8bkxHN5YvKh', amount: '7.99', currency: 'usd' },
        cad: { priceId: 'price_1SApXjAoYPwNm8bkie4fct2z', amount: '10.39', currency: 'cad' },
        mxn: { priceId: 'price_1SApXpAoYPwNm8bkhQzx2MlC', amount: '95', currency: 'mxn' },
        brl: { priceId: 'price_1S8FTxAoYPwNm8bkjFbi1B82', amount: '14.90', currency: 'brl' },
        eur: { priceId: 'price_1SApXuAoYPwNm8bkVlfZ8GrM', amount: '6.39', currency: 'eur' },
        gbp: { priceId: 'price_1SApY2AoYPwNm8bkHg1fJQOx', amount: '5.59', currency: 'gbp' },
        inr: { priceId: 'price_1S8FTcAoYPwNm8bk3Wn5Qz7l', amount: '149', currency: 'inr' },
        idr: { priceId: 'price_1S8uYHAoYPwNm8bk3hI0ZtnZ', amount: '120000', currency: 'idr' },
        php: { priceId: 'price_1S8uZPAoYPwNm8bkXmhOTEIi', amount: '149', currency: 'php' },
        thb: { priceId: 'price_1S8uZZAoYPwNm8bkT2QisCnR', amount: '99', currency: 'thb' },
        vnd: { priceId: 'price_1SApY6AoYPwNm8bkVCWF1RZX', amount: '195000', currency: 'vnd' },
        myr: { priceId: 'price_1SApYBAoYPwNm8bkImk7w8hF', amount: '15', currency: 'myr' },
        sgd: { priceId: 'price_1SApYGAoYPwNm8bkQVYtVmy8', amount: '9.59', currency: 'sgd' },
        jpy: { priceId: 'price_1SApYNAoYPwNm8bkJt3PzwkU', amount: '800', currency: 'jpy' },
        aud: { priceId: 'price_1SApYSAoYPwNm8bkC2GpzSLZ', amount: '11.19', currency: 'aud' },
      },
      // CREATOR PRO Monthly prices - Corrected from Stripe Dashboard
      creator_pro: {
        usd: { priceId: 'price_1S8FTQAoYPwNm8bkZjbYb42N', amount: '12.99', currency: 'usd' },
        cad: { priceId: 'price_1SApYYAoYPwNm8bkHpMqIe2C', amount: '16.89', currency: 'cad' },
        mxn: { priceId: 'price_1SApYfAoYPwNm8bkT89ZVjgz', amount: '154', currency: 'mxn' },
        brl: { priceId: 'price_1S8FU4AoYPwNm8bkODhjMn0a', amount: '24.90', currency: 'brl' },
        eur: { priceId: 'price_1SApYlAoYPwNm8bkn7ondUFI', amount: '10.39', currency: 'eur' },
        gbp: { priceId: 'price_1SApYrAoYPwNm8bkuCK9OXyi', amount: '9.09', currency: 'gbp' },
        inr: { priceId: 'price_1S8FTiAoYPwNm8bkcsChLQHx', amount: '249', currency: 'inr' },
        idr: { priceId: 'price_1SApYzAoYPwNm8bkcY0M5tA0', amount: '195000', currency: 'idr' },
        php: { priceId: 'price_1SApZ9AoYPwNm8bkv56LhPBk', amount: '259', currency: 'php' },
        thb: { priceId: 'price_1SApZKAoYPwNm8bkly3rLDEn', amount: '179', currency: 'thb' },
        vnd: { priceId: 'price_1SApZRAoYPwNm8bkmIaxiz0z', amount: '320000', currency: 'vnd' },
        myr: { priceId: 'price_1SApZbAoYPwNm8bk6X2nrHKp', amount: '24', currency: 'myr' },
        sgd: { priceId: 'price_1SApZiAoYPwNm8bkfdQzOOvT', amount: '15.59', currency: 'sgd' },
        jpy: { priceId: 'price_1SApZvAoYPwNm8bkszGx6AIL', amount: '1300', currency: 'jpy' },
        aud: { priceId: 'price_1SApa2AoYPwNm8bkvZCKSBOv', amount: '18.19', currency: 'aud' },
      },
      // PRO Yearly prices
      pro_yearly: {
        usd: { priceId: 'price_1S97lcAoYPwNm8bk8KqmQJDB', amount: '49.90', currency: 'usd' },
        cad: { priceId: 'price_1SApaKAoYPwNm8bkUbHXXDrq', amount: '64.68', currency: 'cad' },
        mxn: { priceId: 'price_1SApaTAoYPwNm8bk6ObaYjKJ', amount: '588.36', currency: 'mxn' },
        brl: { priceId: 'price_1SApaiAoYPwNm8bkVcfMHjPr', amount: '98.70', currency: 'brl' },
        eur: { priceId: 'price_1SApaxAoYPwNm8bkO8922DQs', amount: '39.78', currency: 'eur' },
        gbp: { priceId: 'price_1SApbBAoYPwNm8bkVeVPV7h8', amount: '34.81', currency: 'gbp' },
        inr: { priceId: 'price_1SApbPAoYPwNm8bkplxL8pWk', amount: '987.012', currency: 'inr' },
        idr: { priceId: 'price_1SApbhAoYPwNm8bkrDRI7rHT', amount: '189480', currency: 'idr' },
        php: { priceId: 'price_1SApc1AoYPwNm8bk4whd7CbS', amount: '987.012', currency: 'php' },
        thb: { priceId: 'price_1SApcEAoYPwNm8bkgUchdii0', amount: '687.948', currency: 'thb' },
        vnd: { priceId: 'price_1SApcbAoYPwNm8bk4qZrqk1I', amount: '488556', currency: 'vnd' },
        myr: { priceId: 'price_1SApcpAoYPwNm8bkwq4n37Ji', amount: '89.748', currency: 'myr' },
        sgd: { priceId: 'price_1SApdGAoYPwNm8bkdHfg2sKo', amount: '59.70', currency: 'sgd' },
        jpy: { priceId: 'price_1SApdXAoYPwNm8bkRvZ1EcRy', amount: '4980', currency: 'jpy' },
        aud: { priceId: 'price_1SApdzAoYPwNm8bkHhtJH3Ph', amount: '69.70', currency: 'aud' },
      },
      // MAX Yearly prices
      max_yearly: {
        usd: { priceId: 'price_1SApeLAoYPwNm8bk1aqSYdis', amount: '79.58', currency: 'usd' },
        cad: { priceId: 'price_1SAph2AoYPwNm8bkaDOVa1ic', amount: '103.49', currency: 'cad' },
        mxn: { priceId: 'price_1SAph8AoYPwNm8bke9VZ0qcj', amount: '946.80', currency: 'mxn' },
        brl: { priceId: 'price_1SAphEAoYPwNm8bk0Q47VIve', amount: '148.57', currency: 'brl' },
        eur: { priceId: 'price_1SAphKAoYPwNm8bkZ14p7FdF', amount: '63.69', currency: 'eur' },
        gbp: { priceId: 'price_1SAphWAoYPwNm8bkjlDOd07g', amount: '55.74', currency: 'gbp' },
        inr: { priceId: 'price_1SAphhAoYPwNm8bk1WzBu6Kx', amount: '1485.57', currency: 'inr' },
        idr: { priceId: 'price_1SAphrAoYPwNm8bkImUYQ3g2', amount: '289170', currency: 'idr' },
        php: { priceId: 'price_1SApi2AoYPwNm8bkYH8aLgFO', amount: '1485.57', currency: 'php' },
        thb: { priceId: 'price_1SApiEAoYPwNm8bkig8FUe0s', amount: '987.012', currency: 'thb' },
        vnd: { priceId: 'price_1SApiSAoYPwNm8bkBwTalb5y', amount: '787230', currency: 'vnd' },
        myr: { priceId: 'price_1SApiiAoYPwNm8bkWRS50Yzd', amount: '149.55', currency: 'myr' },
        sgd: { priceId: 'price_1SApj0AoYPwNm8bkI5FVpl1q', amount: '95.56', currency: 'sgd' },
        jpy: { priceId: 'price_1SApk8AoYPwNm8bkierV3tQe', amount: '7968', currency: 'jpy' },
        aud: { priceId: 'price_1SApkaAoYPwNm8bkAPD57Kto', amount: '111.54', currency: 'aud' },
      },
      // CREATOR PRO Yearly prices
      creator_pro_yearly: {
        usd: { priceId: 'price_1SAplBAoYPwNm8bkhyA708f2', amount: '129.38', currency: 'usd' },
        cad: { priceId: 'price_1SApljAoYPwNm8bkITo2nHIb', amount: '168.31', currency: 'cad' },
        mxn: { priceId: 'price_1SApmLAoYPwNm8bkQlLbKMuD', amount: '1536.48', currency: 'mxn' },
        brl: { priceId: 'price_1SApn3AoYPwNm8bkRP9MC8XX', amount: '248.25', currency: 'brl' },
        eur: { priceId: 'price_1SApnsAoYPwNm8bkB043Qt9L', amount: '103.59', currency: 'eur' },
        gbp: { priceId: 'price_1SApoiAoYPwNm8bkboVKWv6U', amount: '90.63', currency: 'gbp' },
        inr: { priceId: 'price_1SAppfAoYPwNm8bkIIyJEi9S', amount: '2482.47', currency: 'inr' },
        idr: { priceId: 'price_1SApqnAoYPwNm8bkF4CWbOzz', amount: '493605', currency: 'idr' },
        php: { priceId: 'price_1SApryAoYPwNm8bkiOWQ5smW', amount: '2582.19', currency: 'php' },
        thb: { priceId: 'price_1SAptIAoYPwNm8bkGURhZvPc', amount: '1784.77', currency: 'thb' },
        vnd: { priceId: 'price_1SApx5AoYPwNm8bkvdFGay0T', amount: '3200000', currency: 'vnd' },
        myr: { priceId: 'price_1SApxCAoYPwNm8bkZI1N4TMs', amount: '239.28', currency: 'myr' },
        sgd: { priceId: 'price_1SApxKAoYPwNm8bkiP6SCdmV', amount: '155.43', currency: 'sgd' },
        jpy: { priceId: 'price_1SApxPAoYPwNm8bkRmRKg8Sh', amount: '12963', currency: 'jpy' },
        aud: { priceId: 'price_1SApxVAoYPwNm8bk2GCL4wxy', amount: '181.35', currency: 'aud' },
      }
    }
  });
});

// ============================
// NEW: MOBILE DEVICE ENDPOINTS
// ============================

// NEW: Register device
router.post('/device/register', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated = registerDeviceSchema.parse(body);

    // Check if device already registered
    const existingDevice = await c.env.DB.prepare(`
      SELECT id, token FROM device_tokens 
      WHERE user_id = ? AND device_id = ?
    `).bind(user.id, validated.device_id).first();

    if (existingDevice) {
      // Update last used
      await c.env.DB.prepare(`
        UPDATE device_tokens 
        SET last_used_at = CURRENT_TIMESTAMP,
            app_version = ?
        WHERE id = ?
      `).bind(validated.app_version || '', existingDevice.id).run();

      return c.json({
        success: true,
        device_token: existingDevice.token
      });
    }

    // Generate new device token
    const deviceToken = `dev_${nanoid(24)}`;
    const deviceId = nanoid();

    await c.env.DB.prepare(`
      INSERT INTO device_tokens (
        id, user_id, token, device_id, device_model, 
        platform, app_version, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      deviceId,
      user.id,
      deviceToken,
      validated.device_id,
      validated.device_model || '',
      validated.platform,
      validated.app_version || ''
    ).run();

    console.log(`Device registered for user ${user.id}: ${deviceToken}`);

    return c.json({
      success: true,
      device_token: deviceToken
    });

  } catch (error: any) {
    console.error('Device registration error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to register device' 
    }, 500);
  }
});

// NEW: Create mobile checkout session
router.post('/checkout/mobile-session', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated = createMobileSessionSchema.parse(body);

    // Verify device token
    const device = await c.env.DB.prepare(`
      SELECT id, platform FROM device_tokens 
      WHERE token = ? AND user_id = ? AND is_active = 1
    `).bind(validated.device_token, user.id).first() as any;

    if (!device) {
      return c.json({ 
        success: false, 
        error: 'Invalid or expired device token' 
      }, 401);
    }

    // Update device last used
    await c.env.DB.prepare(`
      UPDATE device_tokens 
      SET last_used_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(device.id).run();

    // Expire old sessions
    await c.env.DB.prepare(`
      UPDATE checkout_sessions 
      SET status = 'expired' 
      WHERE user_id = ? 
        AND status = 'pending' 
        AND expires_at < CURRENT_TIMESTAMP
    `).bind(user.id).run();

    // Create new checkout session
    const sessionToken = `sess_${nanoid(32)}`;
    const sessionId = nanoid();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await c.env.DB.prepare(`
      INSERT INTO checkout_sessions (
        id, session_token, user_id, device_token_id, 
        status, expires_at, price_id, metadata
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(
      sessionId,
      sessionToken,
      user.id,
      device.id,
      expiresAt.toISOString(),
      validated.price_id || null,
      JSON.stringify({ platform: device.platform })
    ).run();

    const checkoutUrl = `${c.env.FRONTEND_URL}/subscribe?session=${sessionToken}`;

    console.log(`Checkout session created for user ${user.id}: ${sessionToken}`);

    return c.json({
      success: true,
      session_token: sessionToken,
      checkout_url: checkoutUrl,
      expires_at: expiresAt.toISOString()
    });

  } catch (error: any) {
    console.error('Create mobile session error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to create session' 
    }, 500);
  }
});

// NEW: Validate session (for website)
router.get('/checkout/validate-session', async (c) => {
  try {
    const sessionToken = c.req.query('session');
    
    if (!sessionToken) {
      return c.json({ 
        success: false, 
        error: 'Session token required' 
      }, 400);
    }

    // Get session with user info
    const session = await c.env.DB.prepare(`
      SELECT 
        cs.*,
        u.id as user_id,
        u.email,
        u.username,
        u.stripe_customer_id
      FROM checkout_sessions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.session_token = ?
        AND cs.status = 'pending'
        AND cs.expires_at > CURRENT_TIMESTAMP
    `).bind(sessionToken).first() as any;

    if (!session) {
      return c.json({ 
        success: false, 
        error: 'Invalid or expired session' 
      }, 401);
    }

    const metadata = session.metadata ? JSON.parse(session.metadata) : {};

    return c.json({
      success: true,
      session: {
        id: session.id,
        token: session.session_token,
        expires_at: session.expires_at,
        price_id: session.price_id
      },
      user: {
        id: session.user_id,
        email: session.email,
        username: session.username,
        stripe_customer_id: session.stripe_customer_id
      },
      platform: metadata.platform || 'unknown'
    });

  } catch (error: any) {
    console.error('Validate session error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to validate session' 
    }, 500);
  }
});

// NEW: Create Stripe checkout from website session
router.post('/checkout/create-stripe-session', async (c) => {
  try {
    const body = await c.req.json();
    const validated = createStripeSessionSchema.parse(body);

    // Validate session
    const session = await c.env.DB.prepare(`
      SELECT 
        cs.*,
        u.email,
        u.stripe_customer_id,
        u.id as user_id
      FROM checkout_sessions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.session_token = ?
        AND cs.status = 'pending'
        AND cs.expires_at > CURRENT_TIMESTAMP
    `).bind(validated.session_token).first() as any;

    if (!session) {
      return c.json({ 
        success: false, 
        error: 'Invalid session' 
      }, 401);
    }

    // Get or create Stripe customer
    let customerId = session.stripe_customer_id;
    
    if (!customerId) {
      const customerData = new URLSearchParams();
      customerData.append('email', session.email);
      customerData.append('metadata[user_id]', session.user_id);

      const customerResponse = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: customerData.toString()
      });

      const customer = await customerResponse.json() as any;
      customerId = customer.id;

      // Update user with Stripe customer ID
      await c.env.DB.prepare(`
        UPDATE users SET stripe_customer_id = ? WHERE id = ?
      `).bind(customerId, session.user_id).run();
    }

    // Parse metadata for platform
    const metadata = session.metadata ? JSON.parse(session.metadata) : {};
    const isIOS = metadata.platform === 'ios';

    // Create Stripe checkout session
    const checkoutData = new URLSearchParams();
    checkoutData.append('customer', customerId);
    checkoutData.append('payment_method_types[0]', 'card');
    checkoutData.append('mode', 'subscription');
    checkoutData.append('line_items[0][price]', validated.price_id);
    checkoutData.append('line_items[0][quantity]', '1');
    checkoutData.append('metadata[user_id]', session.user_id);
    checkoutData.append('metadata[checkout_session_id]', session.id);
    checkoutData.append('allow_promotion_codes', 'true');
    checkoutData.append('billing_address_collection', 'required');
    
    // iOS uses deep links, others use web URLs
    if (isIOS) {
      checkoutData.append('success_url', 
        `${c.env.FRONTEND_URL}/payment-success?session=${validated.session_token}&redirect=aniflixx://payment-success`
      );
      checkoutData.append('cancel_url', 
        `${c.env.FRONTEND_URL}/payment-cancel?redirect=aniflixx://payment-cancel`
      );
    } else {
      checkoutData.append('success_url', 
        `${c.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`
      );
      checkoutData.append('cancel_url', 
        `${c.env.FRONTEND_URL}/subscription/plans`
      );
    }

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: checkoutData.toString()
    });

    if (!stripeResponse.ok) {
      throw new Error('Failed to create Stripe session');
    }

    const stripeSession = await stripeResponse.json() as any;

    // Update our session with Stripe session ID
    await c.env.DB.prepare(`
      UPDATE checkout_sessions 
      SET stripe_session_id = ?, price_id = ?
      WHERE id = ?
    `).bind(stripeSession.id, validated.price_id, session.id).run();

    return c.json({
      success: true,
      stripe_url: stripeSession.url,
      stripe_session_id: stripeSession.id
    });

  } catch (error: any) {
    console.error('Create Stripe session error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create payment session' 
    }, 500);
  }
});

// NEW: Revoke device token
router.post('/device/revoke', async (c) => {
  try {
    const user:any = c.get('user');
    const { device_token } = await c.req.json();

    await c.env.DB.prepare(`
      UPDATE device_tokens 
      SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
      WHERE token = ? AND user_id = ?
    `).bind(device_token, user.id).run();

    return c.json({ success: true });

  } catch (error) {
    return c.json({ success: false, error: 'Failed to revoke token' }, 500);
  }
});

// ============================
// EXISTING ENDPOINTS (MODIFIED)
// ============================

// MODIFIED: Create checkout session - Now with platform detection
router.post('/create-checkout', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated = validateRequest(createCheckoutSchema, body);

    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid request',
        details: validated.errors 
      }, 400);
    }

    // NEW: Platform detection
    const platform = c.req.header('X-Platform');
    const isIOS = platform === 'ios';

    // Check for existing subscription
    const existingSub = await c.env.DB.prepare(`
      SELECT id FROM user_subscriptions 
      WHERE user_id = ? AND status IN ('active', 'trialing')
    `).bind(user.id).first();

    if (existingSub) {
      return c.json({ 
        success: false, 
        error: 'User already has an active subscription' 
      }, 409);
    }

    // Get or create Stripe customer
    let userData:any = await c.env.DB.prepare(`
      SELECT stripe_customer_id FROM users WHERE id = ?
    `).bind(user.id).first() as { stripe_customer_id?: string } | null;

    if (!userData?.stripe_customer_id) {
      // Create Stripe customer
      const formData = new URLSearchParams();
      formData.append('email', user.email);
      formData.append('metadata[user_id]', user.id);
      formData.append('metadata[username]', user.username);

      const customerResponse = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });

      if (!customerResponse.ok) {
        const error = await customerResponse.text();
        console.error('Stripe customer creation failed:', error);
        throw new Error('Failed to create customer');
      }

      const customer = await customerResponse.json() as { id: string };
      
      // Save customer ID
      await c.env.DB.prepare(`
        UPDATE users SET stripe_customer_id = ? WHERE id = ?
      `).bind(customer.id, user.id).run();

      userData = { stripe_customer_id: customer.id };
    }

    // Create checkout session with platform-specific URLs
    const sessionData = new URLSearchParams();
    
    // NEW: Platform-specific success/cancel URLs
    if (isIOS) {
      sessionData.append('success_url', 'aniflixx://payment-success');
      sessionData.append('cancel_url', 'aniflixx://payment-cancelled');
    } else {
      sessionData.append('success_url', validated.data.successUrl || `${c.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`);
      sessionData.append('cancel_url', validated.data.cancelUrl || `${c.env.FRONTEND_URL}/subscription/plans`);
    }
    
    sessionData.append('payment_method_types[0]', 'card');
    sessionData.append('mode', 'subscription');
    sessionData.append('customer', userData.stripe_customer_id);
    sessionData.append('line_items[0][price]', validated.data.priceId);
    sessionData.append('line_items[0][quantity]', '1');
    sessionData.append('metadata[user_id]', user.id);
    sessionData.append('metadata[platform]', platform || 'web'); // NEW: Track platform
    sessionData.append('allow_promotion_codes', 'true');
    sessionData.append('billing_address_collection', 'required');

    const sessionResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: sessionData.toString()
    });

    if (!sessionResponse.ok) {
      const error = await sessionResponse.text();
      console.error('Stripe session creation failed:', error);
      throw new Error('Failed to create checkout session');
    }

    const session = await sessionResponse.json() as { id: string; url: string };

    return c.json({
      success: true,
      data: {
        sessionId: session.id,
        checkoutUrl: session.url
      }
    });

  } catch (error: any) {
    console.error('Create checkout error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to create checkout session' 
    }, 500);
  }
});

// UPDATE SUBSCRIPTION (Change Plan) - COMPLETE CODE
router.post('/subscription/update', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated = validateRequest(updateSubscriptionSchema, body);

    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid request',
        details: validated.errors
      }, 400);
    }

    // Get current subscription with item ID
    const currentSub = await c.env.DB.prepare(`
      SELECT 
        us.*,
        u.stripe_customer_id
      FROM user_subscriptions us
      JOIN users u ON us.user_id = u.id
      WHERE us.user_id = ? 
        AND us.status IN ('active', 'trialing')
      ORDER BY us.created_at DESC
      LIMIT 1
    `).bind(user.id).first() as any;

    if (!currentSub) {
      return c.json({ 
        success: false, 
        error: 'No active subscription found' 
      }, 404);
    }

    // Update subscription via Stripe API
    const updateData = new URLSearchParams();
    updateData.append('items[0][id]', currentSub.stripe_subscription_item_id);
    updateData.append('items[0][price]', validated.data.newPriceId);
    updateData.append('proration_behavior', 'create_prorations');

    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/${currentSub.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: updateData.toString()
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Stripe subscription update failed:', error);
      throw new Error('Failed to update subscription');
    }

    const updatedSubscription = await response.json();

    return c.json({
      success: true,
      data: {
        subscription: updatedSubscription,
        message: 'Subscription updated successfully. Changes will be reflected shortly.'
      }
    });

  } catch (error: any) {
    console.error('Update subscription error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to update subscription' 
    }, 500);
  }
});

// CANCEL SUBSCRIPTION - COMPLETE CODE
router.post('/subscription/cancel', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated :any= validateRequest(cancelSubscriptionSchema, body);

    // Get current subscription
    const currentSub = await c.env.DB.prepare(`
      SELECT stripe_subscription_id
      FROM user_subscriptions
      WHERE user_id = ? 
        AND status IN ('active', 'trialing')
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(user.id).first() as any;

    if (!currentSub) {
      return c.json({ 
        success: false, 
        error: 'No active subscription found' 
      }, 404);
    }

    // Cancel at period end via Stripe API
    const cancelData = new URLSearchParams();
    cancelData.append('cancel_at_period_end', 'true');
    
    if (validated.data?.reason) {
      cancelData.append('cancellation_details[comment]', validated.data.reason);
    }

    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/${currentSub.stripe_subscription_id}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: cancelData.toString()
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Stripe cancellation failed:', error);
      throw new Error('Failed to cancel subscription');
    }

    const canceledSubscription:any = await response.json();

    // Update local database
    await c.env.DB.prepare(`
      UPDATE user_subscriptions
      SET cancel_at_period_end = 1,
          updated_at = ?
      WHERE stripe_subscription_id = ?
    `).bind(
      new Date().toISOString(),
      currentSub.stripe_subscription_id
    ).run();

    return c.json({
      success: true,
      data: {
        subscription: canceledSubscription,
        message: 'Subscription will be canceled at the end of the current billing period.'
      }
    });

  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to cancel subscription' 
    }, 500);
  }
});

// MODIFIED: Get subscription status - Platform aware
router.get('/subscription-status', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    
    // NEW: Platform detection
    const platform = c.req.header('X-Platform');

    const subscription = await c.env.DB.prepare(`
      SELECT 
        us.*,
        sp.name as plan_name,
        sp.features,
        sp.price,
        sp.currency,
        sp.billing_interval
      FROM user_subscriptions us
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.user_id = ? 
        AND us.status IN ('active', 'trialing')
      ORDER BY us.created_at DESC
      LIMIT 1
    `).bind(user.id).first() as any;

    if (!subscription) {
      return c.json({
        success: true,
        data: {
          hasSubscription: false,
          tier: 'free',
          canUpgrade: platform !== 'ios' // NEW: Hide upgrade for iOS
        }
      });
    }

    // Extract base tier (remove _yearly suffix)
    const baseTier = subscription.plan_id?.replace('_yearly', '') || 'free';
    
    // NEW: Different response for iOS
    if (platform === 'ios') {
      return c.json({
        success: true,
        data: {
          hasSubscription: true,
          tier: baseTier,
          features: subscription.features ? JSON.parse(subscription.features) : [],
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === 1
          // NO price, NO currency for iOS
        }
      });
    }

    // Full response for other platforms
    return c.json({
      success: true,
      data: {
        hasSubscription: true,
        tier: baseTier,
        plan: {
          id: subscription.plan_id,
          name: subscription.plan_name,
          features: subscription.features ? JSON.parse(subscription.features as string) : [],
          status: subscription.status,
          billingInterval: subscription.billing_interval,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end === 1,
          price: subscription.price,
          currency: subscription.currency
        }
      }
    });

  } catch (error: any) {
    console.error('Get subscription status error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to get subscription status' 
    }, 500);
  }
});

// Customer portal session - COMPLETE CODE
router.post('/create-portal', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const validated = validateRequest(createPortalSchema, body);

    if (!validated.success) {
      return c.json({ 
        success: false, 
        error: 'Invalid request' 
      }, 400);
    }

    const returnUrl = validated.data.returnUrl || `${c.env.FRONTEND_URL}/account`;

    // Get user's Stripe customer ID
    const userData = await c.env.DB.prepare(`
      SELECT stripe_customer_id FROM users WHERE id = ?
    `).bind(user.id).first() as { stripe_customer_id?: string } | null;

    if (!userData?.stripe_customer_id) {
      return c.json({ 
        success: false, 
        error: 'No subscription found' 
      }, 404);
    }

    // Create portal session
    const portalData = new URLSearchParams();
    portalData.append('customer', userData.stripe_customer_id);
    portalData.append('return_url', returnUrl);

    const portalResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: portalData.toString()
    });

    if (!portalResponse.ok) {
      throw new Error('Failed to create portal session');
    }

    const portal = await portalResponse.json() as { url: string };

    return c.json({
      success: true,
      data: {
        portalUrl: portal.url
      }
    });

  } catch (error: any) {
    console.error('Create portal error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create portal session' 
    }, 500);
  }
});

// MODIFIED: Stripe webhook handler - COMPLETE CODE
router.post('/stripe-webhook', async (c) => {
  try {
    const signature = c.req.header('stripe-signature');
    const body = await c.req.text();

    if (!signature) {
      console.error('Webhook: No signature provided');
      return c.json({ error: 'No signature' }, 400);
    }

    // Verify webhook signature
    if (!c.env.STRIPE_WEBHOOK_SECRET) {
      console.error('Webhook: STRIPE_WEBHOOK_SECRET not configured');
      return c.json({ error: 'Webhook secret not configured' }, 500);
    }

    const isValid = await verifyStripeSignature(
      body,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    );

    if (!isValid) {
      console.error('Webhook: Invalid signature');
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Parse the verified event
    const event = JSON.parse(body);
    console.log(`Webhook: Processing ${event.type} event`);

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('Checkout completed for:', session.metadata?.user_id);
        
        // NEW: Mark our checkout session as completed if it exists
        if (session.metadata?.checkout_session_id) {
          await c.env.DB.prepare(`
            UPDATE checkout_sessions 
            SET status = 'completed', 
                completed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `).bind(session.metadata.checkout_session_id).run();
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(c.env.DB, subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(c.env.DB, subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('Payment succeeded for:', invoice.customer);
        await recordPayment(c.env.DB, invoice, 'succeeded');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('Payment failed for:', invoice.customer);
        await recordPayment(c.env.DB, invoice, 'failed');
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return c.json({ received: true });

  } catch (error: any) {
    console.error('Webhook error:', error);
    return c.json({ 
      error: 'Webhook processing failed' 
    }, 500);
  }
});

// Helper function: Update subscription - COMPLETE MAPPING OF ALL STRIPE PRICE IDs
async function handleSubscriptionUpdate(db: D1Database, subscription: any) {
  try {
    // Get user by Stripe customer ID
    const user = await db.prepare(`
      SELECT id FROM users WHERE stripe_customer_id = ?
    `).bind(subscription.customer).first() as { id: string } | null;

    if (!user) {
      console.error(`User not found for customer: ${subscription.customer}`);
      return;
    }

    // Get price ID and subscription item ID
    const priceId = subscription.items.data[0]?.price.id;
    const subscriptionItemId = subscription.items.data[0]?.id;
    
    // COMPLETE price to plan mapping with ALL Stripe price IDs
    const priceToPlaneMap: Record<string, string> = {
      // === PRO MONTHLY PRICES ===
      'price_1S8FTDAoYPwNm8bkKDjYQWiL': 'pro',  // USD $4.99
      'price_1S8ua7AoYPwNm8bk3eOiRbJF': 'pro',  // CAD $6.49
      'price_1S8uaJAoYPwNm8bk6ar0bcHJ': 'pro',  // MXN $59
      'price_1S8FTsAoYPwNm8bkwRNXZkUh': 'pro',  // BRL R$9.90
      'price_1S8uZfAoYPwNm8bkYLSlQJU1': 'pro',  // EUR €3.99
      'price_1S8uZmAoYPwNm8bktzRXuI99': 'pro',  // GBP £3.49
      'price_1S8FTXAoYPwNm8bkDEEWT73z': 'pro',  // INR ₹99
      'price_1S8uXtAoYPwNm8bk2TGHigc4': 'pro',  // IDR Rp75,000
      'price_1S8uY3AoYPwNm8bkcJ506kPe': 'pro',  // PHP ₱99
      'price_1S8uY9AoYPwNm8bkiC8C3NhK': 'pro',  // THB ฿69
      'price_1S8uaWAoYPwNm8bkrt73rGwd': 'pro',  // VND ₫120,000
      'price_1S8uadAoYPwNm8bk7wts6fkT': 'pro',  // MYR RM9
      'price_1S8uawAoYPwNm8bkPPOORMcW': 'pro',  // SGD S$5.99
      'price_1S8uZuAoYPwNm8bkZkaZo7pZ': 'pro',  // JPY ¥500
      'price_1S8ua0AoYPwNm8bkwvw7Gosp': 'pro',  // AUD A$6.99

      // === PRO YEARLY PRICES ===
      'price_1S97lcAoYPwNm8bk8KqmQJDB': 'pro_yearly',  // USD $49.90
      'price_1SApaKAoYPwNm8bkUbHXXDrq': 'pro_yearly',  // CAD $64.68
      'price_1SApaTAoYPwNm8bk6ObaYjKJ': 'pro_yearly',  // MXN $588.36
      'price_1SApaiAoYPwNm8bkVcfMHjPr': 'pro_yearly',  // BRL R$98.70
      'price_1SApaxAoYPwNm8bkO8922DQs': 'pro_yearly',  // EUR €39.78
      'price_1SApbBAoYPwNm8bkVeVPV7h8': 'pro_yearly',  // GBP £34.81
      'price_1SApbPAoYPwNm8bkplxL8pWk': 'pro_yearly',  // INR ₹987.012
      'price_1SApbhAoYPwNm8bkrDRI7rHT': 'pro_yearly',  // IDR Rp189,480
      'price_1SApc1AoYPwNm8bk4whd7CbS': 'pro_yearly',  // PHP ₱987.012
      'price_1SApcEAoYPwNm8bkgUchdii0': 'pro_yearly',  // THB ฿687.948
      'price_1SApcbAoYPwNm8bk4qZrqk1I': 'pro_yearly',  // VND ₫488,556
      'price_1SApcpAoYPwNm8bkwq4n37Ji': 'pro_yearly',  // MYR RM89.748
      'price_1SApdGAoYPwNm8bkdHfg2sKo': 'pro_yearly',  // SGD S$59.70
      'price_1SApdXAoYPwNm8bkRvZ1EcRy': 'pro_yearly',  // JPY ¥4,980
      'price_1SApdzAoYPwNm8bkHhtJH3Ph': 'pro_yearly',  // AUD A$69.70
      
      // === MAX MONTHLY PRICES ===
      'price_1S8FTKAoYPwNm8bkxHN5YvKh': 'max',  // USD $7.99
      'price_1SApXjAoYPwNm8bkie4fct2z': 'max',  // CAD $10.39
      'price_1SApXpAoYPwNm8bkhQzx2MlC': 'max',  // MXN $95
      'price_1S8FTxAoYPwNm8bkjFbi1B82': 'max',  // BRL R$14.90
      'price_1SApXuAoYPwNm8bkVlfZ8GrM': 'max',  // EUR €6.39
      'price_1SApY2AoYPwNm8bkHg1fJQOx': 'max',  // GBP £5.59
      'price_1S8FTcAoYPwNm8bk3Wn5Qz7l': 'max',  // INR ₹149
      'price_1S8uYHAoYPwNm8bk3hI0ZtnZ': 'max',  // IDR Rp120,000
      'price_1S8uZPAoYPwNm8bkXmhOTEIi': 'max',  // PHP ₱149
      'price_1S8uZZAoYPwNm8bkT2QisCnR': 'max',  // THB ฿99
      'price_1SApY6AoYPwNm8bkVCWF1RZX': 'max',  // VND ₫195,000
      'price_1SApYBAoYPwNm8bkImk7w8hF': 'max',  // MYR RM15
      'price_1SApYGAoYPwNm8bkQVYtVmy8': 'max',  // SGD S$9.59
      'price_1SApYNAoYPwNm8bkJt3PzwkU': 'max',  // JPY ¥800
      'price_1SApYSAoYPwNm8bkC2GpzSLZ': 'max',  // AUD A$11.19
      
      // === MAX YEARLY PRICES ===
      'price_1SApeLAoYPwNm8bk1aqSYdis': 'max_yearly',  // USD $79.58
      'price_1SAph2AoYPwNm8bkaDOVa1ic': 'max_yearly',  // CAD $103.49
      'price_1SAph8AoYPwNm8bke9VZ0qcj': 'max_yearly',  // MXN $946.80
      'price_1SAphEAoYPwNm8bk0Q47VIve': 'max_yearly',  // BRL R$148.
      'price_1SAphKAoYPwNm8bkZ14p7FdF': 'max_yearly',  // EUR €63.69
      'price_1SAphWAoYPwNm8bkjlDOd07g': 'max_yearly',  // GBP £55.74
      'price_1SAphhAoYPwNm8bk1WzBu6Kx': 'max_yearly',  // INR ₹1485.57
      'price_1SAphrAoYPwNm8bkImUYQ3g2': 'max_yearly',  // IDR Rp289,170
      'price_1SApi2AoYPwNm8bkYH8aLgFO': 'max_yearly',  // PHP ₱1485.57
      'price_1SApiEAoYPwNm8bkig8FUe0s': 'max_yearly',  // THB ฿987.012
      'price_1SApiSAoYPwNm8bkBwTalb5y': 'max_yearly',  // VND ₫787,230
      'price_1SApiiAoYPwNm8bkWRS50Yzd': 'max_yearly',  // MYR RM149.55
      'price_1SApj0AoYPwNm8bkI5FVpl1q': 'max_yearly',  // SGD S$95.56
      'price_1SApk8AoYPwNm8bkierV3tQe': 'max_yearly',  // JPY ¥7,968
      'price_1SApkaAoYPwNm8bkAPD57Kto': 'max_yearly',  // AUD A$111.54
      
      // === CREATOR PRO MONTHLY PRICES ===
      'price_1S8FTQAoYPwNm8bkZjbYb42N': 'creator_pro',  // USD $12.99
      'price_1SApYYAoYPwNm8bkHpMqIe2C': 'creator_pro',  // CAD $16.89
      'price_1SApYfAoYPwNm8bkT89ZVjgz': 'creator_pro',  // MXN $154
      'price_1S8FU4AoYPwNm8bkODhjMn0a': 'creator_pro',  // BRL R$24.90
      'price_1SApYlAoYPwNm8bkn7ondUFI': 'creator_pro',  // EUR €10.39
      'price_1SApYrAoYPwNm8bkuCK9OXyi': 'creator_pro',  // GBP £9.09
      'price_1S8FTiAoYPwNm8bkcsChLQHx': 'creator_pro',  // INR ₹249
      'price_1SApYzAoYPwNm8bkcY0M5tA0': 'creator_pro',  // IDR Rp195,000
      'price_1SApZ9AoYPwNm8bkv56LhPBk': 'creator_pro',  // PHP ₱259
      'price_1SApZKAoYPwNm8bkly3rLDEn': 'creator_pro',  // THB ฿179
      'price_1SApZRAoYPwNm8bkmIaxiz0z': 'creator_pro',  // VND ₫320,000
      'price_1SApZbAoYPwNm8bk6X2nrHKp': 'creator_pro',  // MYR RM24
      'price_1SApZiAoYPwNm8bkfdQzOOvT': 'creator_pro',  // SGD S$15.59
      'price_1SApZvAoYPwNm8bkszGx6AIL': 'creator_pro',  // JPY ¥1,300
      'price_1SApa2AoYPwNm8bkvZCKSBOv': 'creator_pro',  // AUD A$18.19
      
      // === CREATOR PRO YEARLY PRICES ===
      'price_1SAplBAoYPwNm8bkhyA708f2': 'creator_pro_yearly',  // USD $129.38
      'price_1SApljAoYPwNm8bkITo2nHIb': 'creator_pro_yearly',  // CAD $168.31
      'price_1SApmLAoYPwNm8bkQlLbKMuD': 'creator_pro_yearly',  // MXN $1536.48
      'price_1SApn3AoYPwNm8bkRP9MC8XX': 'creator_pro_yearly',  // BRL R$248.25
      'price_1SApnsAoYPwNm8bkB043Qt9L': 'creator_pro_yearly',  // EUR €103.59
      'price_1SApoiAoYPwNm8bkboVKWv6U': 'creator_pro_yearly',  // GBP £90.63
      'price_1SAppfAoYPwNm8bkIIyJEi9S': 'creator_pro_yearly',  // INR ₹2482.47
      'price_1SApqnAoYPwNm8bkF4CWbOzz': 'creator_pro_yearly',  // IDR Rp493,605
      'price_1SApryAoYPwNm8bkiOWQ5smW': 'creator_pro_yearly',  // PHP ₱2582.19
      'price_1SAptIAoYPwNm8bkGURhZvPc': 'creator_pro_yearly',  // THB ฿1784.77
      'price_1SApx5AoYPwNm8bkvdFGay0T': 'creator_pro_yearly',  // VND ₫3,200,000
      'price_1SApxCAoYPwNm8bkZI1N4TMs': 'creator_pro_yearly',  // MYR RM239.28
      'price_1SApxKAoYPwNm8bkiP6SCdmV': 'creator_pro_yearly',  // SGD S$155.43
      'price_1SApxPAoYPwNm8bkRmRKg8Sh': 'creator_pro_yearly',  // JPY ¥12,963
      'price_1SApxVAoYPwNm8bk2GCL4wxy': 'creator_pro_yearly',  // AUD A$181.35
    };
    
    let planId = priceToPlaneMap[priceId];
    
    if (!planId) {
      console.error(`Unknown price ID: ${priceId}`);
      // Fallback to product-based mapping
      const productId = subscription.items.data[0]?.price.product;
      const productMap: Record<string, string> = {
        'prod_T4OFhO7IfIigBV': 'pro',
        'prod_T4OFO4IYwaumrZ': 'max',
        'prod_T4OFmnsdMa34lf': 'creator_pro'
      };
      planId = productMap[productId] || 'pro';
      console.log(`Using fallback plan ID based on product: ${planId}`);
    }

    // Check if subscription exists
    const existing = await db.prepare(`
      SELECT id FROM user_subscriptions WHERE stripe_subscription_id = ?
    `).bind(subscription.id).first();

    if (existing) {
      // Update existing subscription
      await db.prepare(`
        UPDATE user_subscriptions 
        SET 
          plan_id = ?,
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          cancel_at_period_end = ?,
          stripe_subscription_item_id = ?,
          updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(
        planId,
        subscription.status,
        new Date(subscription.current_period_start * 1000).toISOString(),
        new Date(subscription.current_period_end * 1000).toISOString(),
        subscription.cancel_at_period_end ? 1 : 0,
        subscriptionItemId,
        new Date().toISOString(),
        subscription.id
      ).run();
    } else {
      // Create new subscription
      await db.prepare(`
        INSERT INTO user_subscriptions (
          id, user_id, stripe_subscription_id, stripe_customer_id, 
          stripe_subscription_item_id, plan_id, status, 
          current_period_start, current_period_end, 
          cancel_at_period_end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        user.id,
        subscription.id,
        subscription.customer,
        subscriptionItemId,
        planId,
        subscription.status,
        new Date(subscription.current_period_start * 1000).toISOString(),
        new Date(subscription.current_period_end * 1000).toISOString(),
        subscription.cancel_at_period_end ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString()
      ).run();
    }

    // Update user premium status
    const isActive = ['active', 'trialing'].includes(subscription.status);
    const tier = isActive ? planId.replace('_yearly', '') : 'free';
    
    await db.prepare(`
      UPDATE users SET 
        subscription_tier = ?,
        is_premium = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      tier,
      isActive ? 1 : 0,
      new Date().toISOString(),
      user.id
    ).run();
    
    console.log(`Subscription updated for user: ${user.id}, plan: ${planId}`);
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

// Helper function: Handle subscription deletion - COMPLETE CODE
async function handleSubscriptionDeleted(db: D1Database, subscription: any) {
  try {
    // Update subscription status to canceled
    await db.prepare(`
      UPDATE user_subscriptions 
      SET 
        status = 'canceled',
        canceled_at = ?,
        updated_at = ?
      WHERE stripe_subscription_id = ?
    `).bind(
      new Date().toISOString(),
      new Date().toISOString(),
      subscription.id
    ).run();

    // Update user to free tier
    const user = await db.prepare(`
      SELECT id FROM users WHERE stripe_customer_id = ?
    `).bind(subscription.customer).first() as { id: string } | null;

    if (user) {
      await db.prepare(`
        UPDATE users SET 
          subscription_tier = 'free',
          is_premium = 0,
          updated_at = ?
        WHERE id = ?
      `).bind(
        new Date().toISOString(),
        user.id
      ).run();
      
      console.log(`Subscription canceled for user: ${user.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
  }
}

// Helper function: Record payment - COMPLETE CODE
async function recordPayment(db: D1Database, invoice: any, status: string) {
  try {
    const user = await db.prepare(`
      SELECT id FROM users WHERE stripe_customer_id = ?
    `).bind(invoice.customer).first() as { id: string } | null;

    if (!user) {
      console.error(`User not found for payment recording: ${invoice.customer}`);
      return;
    }

    // Check if payment record exists
    const existing = await db.prepare(`
      SELECT id FROM payment_history WHERE stripe_invoice_id = ?
    `).bind(invoice.id).first();

    if (!existing) {
      await db.prepare(`
        INSERT INTO payment_history (
          id, user_id, stripe_invoice_id, stripe_payment_intent_id,
          amount, currency, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        user.id,
        invoice.id,
        invoice.payment_intent || null,
        invoice.amount_paid || invoice.amount_due,
        invoice.currency,
        status,
        new Date().toISOString()
      ).run();
      
      console.log(`Payment recorded for user ${user.id}: ${status}`);
    }
  } catch (error) {
    console.error('Error recording payment:', error);
  }
}

export { router as paymentsRouter };