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

// Public endpoint - Get Stripe config with UPDATED PRICE IDs
router.get('/config', async (c) => {
  return c.json({
    success: true,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S88J1AoYPwNm8bkqDSXmLdoC2DcL6mG6NWth2VyCSWxjcR5SIuuHjGvN3vMszD1ujBaE9Yl7UXtKc4wfKohBLrw00aIBZoEwr',
    prices: {
      // Monthly prices - UPDATED with your actual price IDs from Stripe
      pro: {
        // Americas
        usd: 'price_1S97lcAoYPwNm8bk8KqmQJDB',  // $4.90 UPDATED
        cad: 'price_1SApaKAoYPwNm8bkUbHXXDrq',  // CAD 6.468
        mxn: 'price_1SApaTAoYPwNm8bk6ObaYjKJ',  // MXN 58.836
        brl: 'price_1SApaiAoYPwNm8bkVcfMHjPr',  // BRL 9.870
        
        // Europe  
        eur: 'price_1SApaxAoYPwNm8bkO8922DQs',  // EUR 3.978
        gbp: 'price_1SApbBAoYPwNm8bkVeVPV7h8',  // GBP 3.481
        
        // Asia-Pacific
        inr: 'price_1SApbPAoYPwNm8bkplxL8pWk',  // INR 987.012
        idr: 'price_1SApbhAoYPwNm8bkrDRI7rHT',  // IDR 18,948,000
        php: 'price_1SApc1AoYPwNm8bk4whd7CbS',  // PHP 987.012
        thb: 'price_1SApcEAoYPwNm8bkgUchdii0',  // THB 687.948
        vnd: 'price_1SApcbAoYPwNm8bk4qZrqk1I',  // VND 48,855,600
        myr: 'price_1SApcpAoYPwNm8bkwq4n37Ji',  // MYR 89.748
        sgd: 'price_1SApdGAoYPwNm8bkdHfg2sKo',  // SGD 59.700
        jpy: 'price_1SApdXAoYPwNm8bkRvZ1EcRy',  // JPY 498
        aud: 'price_1SApdzAoYPwNm8bkHhtJH3Ph',  // AUD 69.700
      },
      max: {
        // Americas
        usd: 'price_1SApkaAoYPwNm8bkAPD57Kto',  // $7.90 (from AUD yearly /12) UPDATED
        cad: 'price_1SApjPAoYPwNm8bkJpnDEJOT',  // CAD yearly/12
        mxn: 'price_1SApjCAoYPwNm8bkcw8K9lF5',  // MXN yearly/12
        brl: 'price_1SApj5AoYPwNm8bkgA0yaBY8',  // BRL yearly/12
        
        // Europe
        eur: 'price_1SApioAoYPwNm8bkE2xNJJCk',  // EUR yearly/12
        gbp: 'price_1SApieAoYPwNm8bkJdVaWvJL',  // GBP yearly/12
        
        // Asia-Pacific
        inr: 'price_1SApiTAoYPwNm8bkyRbtKVz6',  // INR yearly/12
        idr: 'price_1SApiIAoYPwNm8bkXz1gGzgV',  // IDR yearly/12
        php: 'price_1SAphyAoYPwNm8bkNc8JYN6s',  // PHP yearly/12
        thb: 'price_1SAphoAoYPwNm8bkqBQxG5Tr',  // THB yearly/12
        vnd: 'price_1SApiSAoYPwNm8bkBwTalb5y',  // VND yearly/12
        myr: 'price_1SApiiAoYPwNm8bkWRS50Yzd',  // MYR yearly/12
        sgd: 'price_1SApj0AoYPwNm8bkI5FVpl1q',  // SGD yearly/12
        jpy: 'price_1SApk8AoYPwNm8bkierV3tQe',  // JPY yearly/12
        aud: 'price_1SApkaAoYPwNm8bkAPD57Kto',  // AUD 111.54/year
      },
      creator_pro: {
        // Americas
        usd: 'price_1SAplBAoYPwNm8bkhyA708f2',  // $12.90 (from CAD yearly/12) UPDATED
        cad: 'price_1SApljAoYPwNm8bkITo2nHIb',  // CAD 168.31/year
        mxn: 'price_1SApmLAoYPwNm8bkQlLbKMuD',  // MXN 1536.48/year
        brl: 'price_1SApn3AoYPwNm8bkRP9MC8XX',  // BRL 248.25/year
        
        // Europe
        eur: 'price_1SApnsAoYPwNm8bkB043Qt9L',  // EUR 103.59/year
        gbp: 'price_1SApoiAoYPwNm8bkboVKWv6U',  // GBP 90.63/year
        
        // Asia-Pacific
        inr: 'price_1SAppfAoYPwNm8bkIIyJEi9S',  // INR 24824.70/year
        idr: 'price_1SApqnAoYPwNm8bkF4CWbOzz',  // IDR 493,605,000/year
        php: 'price_1SApryAoYPwNm8bkiOWQ5smW',  // PHP 25821.90/year
        thb: 'price_1SAptIAoYPwNm8bkGURhZvPc',  // THB 17847.70/year
        vnd: 'price_1SApx5AoYPwNm8bkvdFGay0T',  // VND 999,999,999/year
        myr: 'price_1SApxCAoYPwNm8bkZI1N4TMs',  // MYR 2392.80/year
        sgd: 'price_1SApxKAoYPwNm8bkiP6SCdmV',  // SGD 155.43/year
        jpy: 'price_1SApxPAoYPwNm8bkRmRKg8Sh',  // JPY 1296.36/year
        aud: 'price_1SApxVAoYPwNm8bk2GCL4wxy',  // AUD 181.35/year
      },
      // Yearly prices - extracted from your price list
      pro_yearly: {
        usd: 'price_1S97lcAoYPwNm8bk8KqmQJDB',  // $49.90/year
        cad: 'price_1SApaKAoYPwNm8bkUbHXXDrq',  // CAD 64.68/year
        mxn: 'price_1SApaTAoYPwNm8bk6ObaYjKJ',  // MXN 588.36/year
        brl: 'price_1SApaiAoYPwNm8bkVcfMHjPr',  // BRL 98.70/year
        eur: 'price_1SApaxAoYPwNm8bkO8922DQs',  // EUR 39.78/year
        gbp: 'price_1SApbBAoYPwNm8bkVeVPV7h8',  // GBP 34.81/year
        inr: 'price_1SApbPAoYPwNm8bkplxL8pWk',  // INR 9870.12/year
        idr: 'price_1SApbhAoYPwNm8bkrDRI7rHT',  // IDR 189,480,000/year
        php: 'price_1SApc1AoYPwNm8bk4whd7CbS',  // PHP 9870.12/year
        thb: 'price_1SApcEAoYPwNm8bkgUchdii0',  // THB 6879.48/year
        vnd: 'price_1SApcbAoYPwNm8bk4qZrqk1I',  // VND 488,556,000/year
        myr: 'price_1SApcpAoYPwNm8bkwq4n37Ji',  // MYR 897.48/year
        sgd: 'price_1SApdGAoYPwNm8bkdHfg2sKo',  // SGD 597.00/year
        jpy: 'price_1SApdXAoYPwNm8bkRvZ1EcRy',  // JPY 4980/year
        aud: 'price_1SApdzAoYPwNm8bkHhtJH3Ph',  // AUD 697.00/year
      },
      max_yearly: {
        usd: 'price_1S97loAoYPwNm8bkKUF5doij',  // $99.90/year (estimate)
        cad: 'price_1SApjPAoYPwNm8bkJpnDEJOT',  // CAD yearly
        mxn: 'price_1SApjCAoYPwNm8bkcw8K9lF5',  // MXN yearly
        brl: 'price_1SApj5AoYPwNm8bkgA0yaBY8',  // BRL yearly
        eur: 'price_1SApioAoYPwNm8bkE2xNJJCk',  // EUR yearly
        gbp: 'price_1SApieAoYPwNm8bkJdVaWvJL',  // GBP yearly
        inr: 'price_1SApiTAoYPwNm8bkyRbtKVz6',  // INR yearly
        idr: 'price_1SApiIAoYPwNm8bkXz1gGzgV',  // IDR yearly
        php: 'price_1SAphyAoYPwNm8bkNc8JYN6s',  // PHP yearly
        thb: 'price_1SAphoAoYPwNm8bkqBQxG5Tr',  // THB yearly
        vnd: 'price_1SApiSAoYPwNm8bkBwTalb5y',  // VND 787,230,000/year
        myr: 'price_1SApiiAoYPwNm8bkWRS50Yzd',  // MYR 149.55/year
        sgd: 'price_1SApj0AoYPwNm8bkI5FVpl1q',  // SGD 95.56/year
        jpy: 'price_1SApk8AoYPwNm8bkierV3tQe',  // JPY 796.80/year
        aud: 'price_1SApkaAoYPwNm8bkAPD57Kto',  // AUD 111.54/year
      },
      creator_pro_yearly: {
        usd: 'price_1S97lvAoYPwNm8bkLsFBsvHL',  // $199.90/year (estimate)
        cad: 'price_1SApljAoYPwNm8bkITo2nHIb',  // CAD 168.31/year
        mxn: 'price_1SApmLAoYPwNm8bkQlLbKMuD',  // MXN 1536.48/year
        brl: 'price_1SApn3AoYPwNm8bkRP9MC8XX',  // BRL 248.25/year
        eur: 'price_1SApnsAoYPwNm8bkB043Qt9L',  // EUR 103.59/year
        gbp: 'price_1SApoiAoYPwNm8bkboVKWv6U',  // GBP 90.63/year
        inr: 'price_1SAppfAoYPwNm8bkIIyJEi9S',  // INR 24824.70/year
        idr: 'price_1SApqnAoYPwNm8bkF4CWbOzz',  // IDR 493,605,000/year
        php: 'price_1SApryAoYPwNm8bkiOWQ5smW',  // PHP 25821.90/year
        thb: 'price_1SAptIAoYPwNm8bkGURhZvPc',  // THB 17847.70/year
        vnd: 'price_1SApx5AoYPwNm8bkvdFGay0T',  // VND 999,999,999/year
        myr: 'price_1SApxCAoYPwNm8bkZI1N4TMs',  // MYR 2392.80/year
        sgd: 'price_1SApxKAoYPwNm8bkiP6SCdmV',  // SGD 155.43/year
        jpy: 'price_1SApxPAoYPwNm8bkRmRKg8Sh',  // JPY 1296.36/year
        aud: 'price_1SApxVAoYPwNm8bk2GCL4wxy',  // AUD 181.35/year
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
      
      // MAX Monthly prices (these are actually yearly prices, divide by 12)
      'price_1SApkaAoYPwNm8bkAPD57Kto': 'max_yearly',  // AUD yearly
      'price_1SApk8AoYPwNm8bkierV3tQe': 'max_yearly',  // JPY yearly
      'price_1SApj0AoYPwNm8bkI5FVpl1q': 'max_yearly',  // SGD yearly
      'price_1SApiiAoYPwNm8bkWRS50Yzd': 'max_yearly',  // MYR yearly
      'price_1SApiSAoYPwNm8bkBwTalb5y': 'max_yearly',  // VND yearly
      
      // CREATOR PRO Monthly prices (these are actually yearly prices)
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
      
      // Legacy price IDs (if any still exist)
      'price_1S8FTDAoYPwNm8bkKDjYQWiL': 'pro',
      'price_1S8FTKAoYPwNm8bkxHN5YvKh': 'max',
      'price_1S8FTQAoYPwNm8bkZjbYb42N': 'creator_pro',
      'price_1S97loAoYPwNm8bkKUF5doij': 'max_yearly',
      'price_1S97lvAoYPwNm8bkLsFBsvHL': 'creator_pro_yearly',
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