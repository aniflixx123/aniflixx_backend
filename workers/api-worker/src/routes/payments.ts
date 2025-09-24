// workers/api-worker/src/routes/payments.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Env } from '../types';
import { validateRequest } from '../utils/validation';

type Variables = {
  user?: {
    id: string;
    email: string;
    username: string;
  };
};

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validation schemas
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

// Helper function: Verify Stripe webhook signature
async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse the signature header
    const elements = signature.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.substring(2);
    const signatures = elements
      .filter(e => e.startsWith('v1='))
      .map(e => e.substring(3));

    if (!timestamp || signatures.length === 0) {
      console.error('Invalid signature format');
      return false;
    }

    // Check timestamp to prevent replay attacks (5 minute tolerance)
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime - parseInt(timestamp) > 300) {
      console.error('Webhook timestamp too old');
      return false;
    }

    // Compute expected signature using Web Crypto API
    const encoder = new TextEncoder();
    const signedPayload = `${timestamp}.${body}`;
    
    // Import the secret as a key
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign the payload
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload)
    );

    // Convert to hex
    const expectedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Verify at least one signature matches
    return signatures.some(sig => sig === expectedSig);
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

// Public endpoint - Get Stripe config with AMOUNTS
router.get('/config', async (c) => {
  return c.json({
    success: true,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S88J1AoYPwNm8bkqDSXmLdoC2DcL6mG6NWth2VyCSWxjcR5SIuuHjGvN3vMszD1ujBaE9Yl7UXtKc4wfKohBLrw00aIBZoEwr',
    prices: {
      // Monthly prices with amounts
      pro: {
        usd: { priceId: 'price_1S97lcAoYPwNm8bk8KqmQJDB', amount: '4.90', currency: 'usd' },
        cad: { priceId: 'price_1SApaKAoYPwNm8bkUbHXXDrq', amount: '6.47', currency: 'cad' },
        mxn: { priceId: 'price_1SApaTAoYPwNm8bk6ObaYjKJ', amount: '98.84', currency: 'mxn' },
        brl: { priceId: 'price_1SApaiAoYPwNm8bkVcfMHjPr', amount: '28.70', currency: 'brl' },
        eur: { priceId: 'price_1SApaxAoYPwNm8bkO8922DQs', amount: '4.48', currency: 'eur' },
        gbp: { priceId: 'price_1SApbBAoYPwNm8bkVeVPV7h8', amount: '3.88', currency: 'gbp' },
        inr: { priceId: 'price_1SApbPAoYPwNm8bkplxL8pWk', amount: '410', currency: 'inr' },
        idr: { priceId: 'price_1SApbhAoYPwNm8bkrDRI7rHT', amount: '77000', currency: 'idr' },
        php: { priceId: 'price_1SApc1AoYPwNm8bk4whd7CbS', amount: '280', currency: 'php' },
        thb: { priceId: 'price_1SApcEAoYPwNm8bkgUchdii0', amount: '169', currency: 'thb' },
        vnd: { priceId: 'price_1SApcbAoYPwNm8bk4qZrqk1I', amount: '124000', currency: 'vnd' },
        myr: { priceId: 'price_1SApcpAoYPwNm8bkwq4n37Ji', amount: '21.90', currency: 'myr' },
        sgd: { priceId: 'price_1SApdGAoYPwNm8bkdHfg2sKo', amount: '6.60', currency: 'sgd' },
        jpy: { priceId: 'price_1SApdXAoYPwNm8bkRvZ1EcRy', amount: '750', currency: 'jpy' },
        aud: { priceId: 'price_1SApdzAoYPwNm8bkHhtJH3Ph', amount: '7.60', currency: 'aud' },
      },
      max: {
        // MAX Monthly prices
        usd: { priceId: 'price_MAX_MONTHLY_USD', amount: '7.90', currency: 'usd' },
        cad: { priceId: 'price_MAX_MONTHLY_CAD', amount: '10.35', currency: 'cad' },
        mxn: { priceId: 'price_MAX_MONTHLY_MXN', amount: '158', currency: 'mxn' },
        brl: { priceId: 'price_MAX_MONTHLY_BRL', amount: '45.90', currency: 'brl' },
        eur: { priceId: 'price_MAX_MONTHLY_EUR', amount: '7.17', currency: 'eur' },
        gbp: { priceId: 'price_MAX_MONTHLY_GBP', amount: '6.21', currency: 'gbp' },
        inr: { priceId: 'price_MAX_MONTHLY_INR', amount: '656', currency: 'inr' },
        idr: { priceId: 'price_MAX_MONTHLY_IDR', amount: '123000', currency: 'idr' },
        php: { priceId: 'price_MAX_MONTHLY_PHP', amount: '448', currency: 'php' },
        thb: { priceId: 'price_MAX_MONTHLY_THB', amount: '270', currency: 'thb' },
        vnd: { priceId: 'price_MAX_MONTHLY_VND', amount: '198000', currency: 'vnd' },
        myr: { priceId: 'price_MAX_MONTHLY_MYR', amount: '35', currency: 'myr' },
        sgd: { priceId: 'price_MAX_MONTHLY_SGD', amount: '10.56', currency: 'sgd' },
        jpy: { priceId: 'price_MAX_MONTHLY_JPY', amount: '1200', currency: 'jpy' },
        aud: { priceId: 'price_MAX_MONTHLY_AUD', amount: '12.16', currency: 'aud' },
      },
      creator_pro: {
        // Creator Pro Monthly prices
        usd: { priceId: 'price_CREATOR_MONTHLY_USD', amount: '19.90', currency: 'usd' },
        cad: { priceId: 'price_CREATOR_MONTHLY_CAD', amount: '26.07', currency: 'cad' },
        mxn: { priceId: 'price_CREATOR_MONTHLY_MXN', amount: '398', currency: 'mxn' },
        brl: { priceId: 'price_CREATOR_MONTHLY_BRL', amount: '115.62', currency: 'brl' },
        eur: { priceId: 'price_CREATOR_MONTHLY_EUR', amount: '18.05', currency: 'eur' },
        gbp: { priceId: 'price_CREATOR_MONTHLY_GBP', amount: '15.64', currency: 'gbp' },
        inr: { priceId: 'price_CREATOR_MONTHLY_INR', amount: '1651', currency: 'inr' },
        idr: { priceId: 'price_CREATOR_MONTHLY_IDR', amount: '310000', currency: 'idr' },
        php: { priceId: 'price_CREATOR_MONTHLY_PHP', amount: '1127', currency: 'php' },
        thb: { priceId: 'price_CREATOR_MONTHLY_THB', amount: '680', currency: 'thb' },
        vnd: { priceId: 'price_CREATOR_MONTHLY_VND', amount: '499000', currency: 'vnd' },
        myr: { priceId: 'price_CREATOR_MONTHLY_MYR', amount: '88.20', currency: 'myr' },
        sgd: { priceId: 'price_CREATOR_MONTHLY_SGD', amount: '26.59', currency: 'sgd' },
        jpy: { priceId: 'price_CREATOR_MONTHLY_JPY', amount: '3022', currency: 'jpy' },
        aud: { priceId: 'price_CREATOR_MONTHLY_AUD', amount: '30.63', currency: 'aud' },
      },
      // Yearly prices with amounts
      pro_yearly: {
        usd: { priceId: 'price_1S97lgAoYPwNm8bkAGhzKkbY', amount: '49', currency: 'usd' },
        cad: { priceId: 'price_PRO_YEARLY_CAD', amount: '64.68', currency: 'cad' },
        mxn: { priceId: 'price_PRO_YEARLY_MXN', amount: '988', currency: 'mxn' },
        brl: { priceId: 'price_PRO_YEARLY_BRL', amount: '287', currency: 'brl' },
        eur: { priceId: 'price_PRO_YEARLY_EUR', amount: '44.80', currency: 'eur' },
        gbp: { priceId: 'price_PRO_YEARLY_GBP', amount: '38.80', currency: 'gbp' },
        inr: { priceId: 'price_PRO_YEARLY_INR', amount: '4100', currency: 'inr' },
        idr: { priceId: 'price_PRO_YEARLY_IDR', amount: '770000', currency: 'idr' },
        php: { priceId: 'price_PRO_YEARLY_PHP', amount: '2800', currency: 'php' },
        thb: { priceId: 'price_PRO_YEARLY_THB', amount: '1690', currency: 'thb' },
        vnd: { priceId: 'price_PRO_YEARLY_VND', amount: '1240000', currency: 'vnd' },
        myr: { priceId: 'price_PRO_YEARLY_MYR', amount: '219', currency: 'myr' },
        sgd: { priceId: 'price_PRO_YEARLY_SGD', amount: '66', currency: 'sgd' },
        jpy: { priceId: 'price_PRO_YEARLY_JPY', amount: '7500', currency: 'jpy' },
        aud: { priceId: 'price_PRO_YEARLY_AUD', amount: '76', currency: 'aud' },
      },
      max_yearly: {
        usd: { priceId: 'price_1S97loAoYPwNm8bkKUF5doij', amount: '79', currency: 'usd' },
        cad: { priceId: 'price_1SApjPAoYPwNm8bkJpnDEJOT', amount: '103.50', currency: 'cad' },
        mxn: { priceId: 'price_1SApjCAoYPwNm8bkcw8K9lF5', amount: '1580', currency: 'mxn' },
        brl: { priceId: 'price_1SApj5AoYPwNm8bkgA0yaBY8', amount: '459', currency: 'brl' },
        eur: { priceId: 'price_1SApioAoYPwNm8bkE2xNJJCk', amount: '71.70', currency: 'eur' },
        gbp: { priceId: 'price_1SApieAoYPwNm8bkJdVaWvJL', amount: '62.10', currency: 'gbp' },
        inr: { priceId: 'price_1SApiTAoYPwNm8bkyRbtKVz6', amount: '6560', currency: 'inr' },
        idr: { priceId: 'price_1SApiIAoYPwNm8bkXz1gGzgV', amount: '1230000', currency: 'idr' },
        php: { priceId: 'price_1SAphyAoYPwNm8bkNc8JYN6s', amount: '4480', currency: 'php' },
        thb: { priceId: 'price_1SAphoAoYPwNm8bkqBQxG5Tr', amount: '2700', currency: 'thb' },
        vnd: { priceId: 'price_1SApiSAoYPwNm8bkBwTalb5y', amount: '1980000', currency: 'vnd' },
        myr: { priceId: 'price_1SApiiAoYPwNm8bkWRS50Yzd', amount: '350', currency: 'myr' },
        sgd: { priceId: 'price_1SApj0AoYPwNm8bkI5FVpl1q', amount: '105.60', currency: 'sgd' },
        jpy: { priceId: 'price_1SApk8AoYPwNm8bkierV3tQe', amount: '12000', currency: 'jpy' },
        aud: { priceId: 'price_1SApkaAoYPwNm8bkAPD57Kto', amount: '121.60', currency: 'aud' },
      },
      creator_pro_yearly: {
        usd: { priceId: 'price_1S97lvAoYPwNm8bkLsFBsvHL', amount: '199', currency: 'usd' },
        cad: { priceId: 'price_1SApljAoYPwNm8bkITo2nHIb', amount: '260.70', currency: 'cad' },
        mxn: { priceId: 'price_1SApmLAoYPwNm8bkQlLbKMuD', amount: '3980', currency: 'mxn' },
        brl: { priceId: 'price_1SApn3AoYPwNm8bkRP9MC8XX', amount: '1156.20', currency: 'brl' },
        eur: { priceId: 'price_1SApnsAoYPwNm8bkB043Qt9L', amount: '180.50', currency: 'eur' },
        gbp: { priceId: 'price_1SApoiAoYPwNm8bkboVKWv6U', amount: '156.40', currency: 'gbp' },
        inr: { priceId: 'price_1SAppfAoYPwNm8bkIIyJEi9S', amount: '16510', currency: 'inr' },
        idr: { priceId: 'price_1SApqnAoYPwNm8bkF4CWbOzz', amount: '3100000', currency: 'idr' },
        php: { priceId: 'price_1SApryAoYPwNm8bkiOWQ5smW', amount: '11270', currency: 'php' },
        thb: { priceId: 'price_1SAptIAoYPwNm8bkGURhZvPc', amount: '6800', currency: 'thb' },
        vnd: { priceId: 'price_1SApx5AoYPwNm8bkvdFGay0T', amount: '4990000', currency: 'vnd' },
        myr: { priceId: 'price_1SApxCAoYPwNm8bkZI1N4TMs', amount: '882', currency: 'myr' },
        sgd: { priceId: 'price_1SApxKAoYPwNm8bkiP6SCdmV', amount: '265.90', currency: 'sgd' },
        jpy: { priceId: 'price_1SApxPAoYPwNm8bkRmRKg8Sh', amount: '30220', currency: 'jpy' },
        aud: { priceId: 'price_1SApxVAoYPwNm8bk2GCL4wxy', amount: '306.30', currency: 'aud' },
      }
    }
  });
});

// Create checkout session - Protected route
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

    // Create checkout session
    const sessionData = new URLSearchParams();
    sessionData.append('success_url', validated.data.successUrl || `${c.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`);
    sessionData.append('cancel_url', validated.data.cancelUrl || `${c.env.FRONTEND_URL}/subscription/plans`);
    sessionData.append('payment_method_types[0]', 'card');
    sessionData.append('mode', 'subscription');
    sessionData.append('customer', userData.stripe_customer_id);
    sessionData.append('line_items[0][price]', validated.data.priceId);
    sessionData.append('line_items[0][quantity]', '1');
    sessionData.append('metadata[user_id]', user.id);
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

// UPDATE SUBSCRIPTION (Change Plan)
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

// CANCEL SUBSCRIPTION
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

// Get subscription status
router.get('/subscription-status', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

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
          tier: 'free'
        }
      });
    }

    // Extract base tier (remove _yearly suffix)
    const baseTier = subscription.plan_id.replace('_yearly', '');

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

// Customer portal session
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

// Stripe webhook handler
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

// Helper function: Update subscription with UPDATED PRICE MAPPINGS
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
    
    // UPDATED: Complete price to plan mapping with all your price IDs
    const priceToPlaneMap: Record<string, string> = {
      // PRO Monthly prices
      'price_1S97lcAoYPwNm8bk8KqmQJDB': 'pro',  // USD monthly
      'price_1SApaKAoYPwNm8bkUbHXXDrq': 'pro',  // CAD monthly
      'price_1SApaTAoYPwNm8bk6ObaYjKJ': 'pro',  // MXN monthly
      'price_1SApaiAoYPwNm8bkVcfMHjPr': 'pro',  // BRL monthly
      'price_1SApaxAoYPwNm8bkO8922DQs': 'pro',  // EUR monthly
      'price_1SApbBAoYPwNm8bkVeVPV7h8': 'pro',  // GBP monthly
      'price_1SApbPAoYPwNm8bkplxL8pWk': 'pro',  // INR monthly
      'price_1SApbhAoYPwNm8bkrDRI7rHT': 'pro',  // IDR monthly
      'price_1SApc1AoYPwNm8bk4whd7CbS': 'pro',  // PHP monthly
      'price_1SApcEAoYPwNm8bkgUchdii0': 'pro',  // THB monthly
      'price_1SApcbAoYPwNm8bk4qZrqk1I': 'pro',  // VND monthly
      'price_1SApcpAoYPwNm8bkwq4n37Ji': 'pro',  // MYR monthly
      'price_1SApdGAoYPwNm8bkdHfg2sKo': 'pro',  // SGD monthly
      'price_1SApdXAoYPwNm8bkRvZ1EcRy': 'pro',  // JPY monthly
      'price_1SApdzAoYPwNm8bkHhtJH3Ph': 'pro',  // AUD monthly
      
      // MAX Yearly prices (these are marked as yearly)
      'price_1S97loAoYPwNm8bkKUF5doij': 'max_yearly',  // USD yearly
      'price_1SApkaAoYPwNm8bkAPD57Kto': 'max_yearly',  // AUD yearly
      'price_1SApk8AoYPwNm8bkierV3tQe': 'max_yearly',  // JPY yearly
      'price_1SApj0AoYPwNm8bkI5FVpl1q': 'max_yearly',  // SGD yearly
      'price_1SApiiAoYPwNm8bkWRS50Yzd': 'max_yearly',  // MYR yearly
      'price_1SApiSAoYPwNm8bkBwTalb5y': 'max_yearly',  // VND yearly
      'price_1SApjPAoYPwNm8bkJpnDEJOT': 'max_yearly',  // CAD yearly
      'price_1SApjCAoYPwNm8bkcw8K9lF5': 'max_yearly',  // MXN yearly
      'price_1SApj5AoYPwNm8bkgA0yaBY8': 'max_yearly',  // BRL yearly
      'price_1SApioAoYPwNm8bkE2xNJJCk': 'max_yearly',  // EUR yearly
      'price_1SApieAoYPwNm8bkJdVaWvJL': 'max_yearly',  // GBP yearly
      'price_1SApiTAoYPwNm8bkyRbtKVz6': 'max_yearly',  // INR yearly
      'price_1SApiIAoYPwNm8bkXz1gGzgV': 'max_yearly',  // IDR yearly
      'price_1SAphyAoYPwNm8bkNc8JYN6s': 'max_yearly',  // PHP yearly
      'price_1SAphoAoYPwNm8bkqBQxG5Tr': 'max_yearly',  // THB yearly
      
      // CREATOR PRO Yearly prices
      'price_1S97lvAoYPwNm8bkLsFBsvHL': 'creator_pro_yearly',  // USD yearly
      'price_1SAplBAoYPwNm8bkhyA708f2': 'creator_pro_yearly',  // CAD yearly as USD
      'price_1SApljAoYPwNm8bkITo2nHIb': 'creator_pro_yearly',  // CAD yearly
      'price_1SApmLAoYPwNm8bkQlLbKMuD': 'creator_pro_yearly',  // MXN yearly
      'price_1SApn3AoYPwNm8bkRP9MC8XX': 'creator_pro_yearly',  // BRL yearly
      'price_1SApnsAoYPwNm8bkB043Qt9L': 'creator_pro_yearly',  // EUR yearly
      'price_1SApoiAoYPwNm8bkboVKWv6U': 'creator_pro_yearly',  // GBP yearly
      'price_1SAppfAoYPwNm8bkIIyJEi9S': 'creator_pro_yearly',  // INR yearly
      'price_1SApqnAoYPwNm8bkF4CWbOzz': 'creator_pro_yearly',  // IDR yearly
      'price_1SApryAoYPwNm8bkiOWQ5smW': 'creator_pro_yearly',  // PHP yearly
      'price_1SAptIAoYPwNm8bkGURhZvPc': 'creator_pro_yearly',  // THB yearly
      'price_1SApx5AoYPwNm8bkvdFGay0T': 'creator_pro_yearly',  // VND yearly
      'price_1SApxCAoYPwNm8bkZI1N4TMs': 'creator_pro_yearly',  // MYR yearly
      'price_1SApxKAoYPwNm8bkiP6SCdmV': 'creator_pro_yearly',  // SGD yearly
      'price_1SApxPAoYPwNm8bkRmRKg8Sh': 'creator_pro_yearly',  // JPY yearly
      'price_1SApxVAoYPwNm8bk2GCL4wxy': 'creator_pro_yearly',  // AUD yearly
      
      // Pro Yearly prices
      'price_1S97lgAoYPwNm8bkAGhzKkbY': 'pro_yearly',  // USD yearly
      
      // Placeholder MAX and Creator Pro monthly price IDs (update when you have them)
      'price_MAX_MONTHLY_USD': 'max',
      'price_MAX_MONTHLY_CAD': 'max',
      'price_MAX_MONTHLY_MXN': 'max',
      'price_CREATOR_MONTHLY_USD': 'creator_pro',
      'price_CREATOR_MONTHLY_CAD': 'creator_pro',
      'price_CREATOR_MONTHLY_MXN': 'creator_pro',
      
      // Legacy price IDs
      'price_1S8FTDAoYPwNm8bkKDjYQWiL': 'pro',
      'price_1S8FTKAoYPwNm8bkxHN5YvKh': 'max',
      'price_1S8FTQAoYPwNm8bkZjbYb42N': 'creator_pro',
    };
    
    const planId = priceToPlaneMap[priceId];
    
    if (!planId) {
      console.error(`Unknown price ID: ${priceId}`);
      // Fallback to product-based mapping
      const productId = subscription.items.data[0]?.price.product;
      const productMap: Record<string, string> = {
        'prod_T4OFhO7IfIigBV': 'pro',
        'prod_T4OFO4IYwaumrZ': 'max',
        'prod_T4OFmnsdMa34lf': 'creator_pro'
      };
      const fallbackPlanId = productMap[productId] || 'pro';
      console.log(`Using fallback plan ID: ${fallbackPlanId}`);
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
        planId || 'pro',
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
        planId || 'pro',
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
    const tier = isActive ? (planId || 'pro').replace('_yearly', '') : 'free';
    
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

// Helper function: Handle subscription deletion
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

// Helper function: Record payment
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