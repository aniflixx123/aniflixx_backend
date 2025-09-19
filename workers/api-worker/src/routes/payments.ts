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

// Public endpoint - Get Stripe config
router.get('/config', async (c) => {
  return c.json({
    success: true,
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S88J1AoYPwNm8bkqDSXmLdoC2DcL6mG6NWth2VyCSWxjcR5SIuuHjGvN3vMszD1ujBaE9Yl7UXtKc4wfKohBLrw00aIBZoEwr',
    prices: {
      pro: {
        usd: 'price_1S8FTDAoYPwNm8bkKDjYQWiL',
        brl: 'price_1S8FTsAoYPwNm8bkwRNXZkUh',
        inr: 'price_1S8FTXAoYPwNm8bkDEEWT73z'
      },
      max: {
        usd: 'price_1S8FTKAoYPwNm8bkxHN5YvKh',
        brl: 'price_1S8FTxAoYPwNm8bkjFbi1B82',
        inr: 'price_1S8FTcAoYPwNm8bk3Wn5Qz7l'
      },
      creator_pro: {
        usd: 'price_1S8FTQAoYPwNm8bkZjbYb42N',
        brl: 'price_1S8FU4AoYPwNm8bkODhjMn0a',
        inr: 'price_1S8FTiAoYPwNm8bkcsChLQHx'
      }
    },
    paymentLinks: {
      pro: 'https://buy.stripe.com/6oUeVcceQ92A7Z70i9gUM00',
      max: 'https://buy.stripe.com/6oUbJ0ceQbaIenvaWNgUM01',
      creator_pro: 'https://buy.stripe.com/00w14ma6I92Acfn3ulgUM02'
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
    sessionData.append('success_url', validated.data.successUrl || `${c.env.FRONTEND_URL || 'https://aniflixx-api.black-poetry-4fa5.workers.dev'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`);
    sessionData.append('cancel_url', validated.data.cancelUrl || `${c.env.FRONTEND_URL || 'https://aniflixx-api.black-poetry-4fa5.workers.dev'}/subscription/plans`);
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

// Get subscription status
router.get('/subscription-status', async (c) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    // Check database for subscription
    const subscription = await c.env.DB.prepare(`
      SELECT 
        us.*,
        sp.name as plan_name,
        sp.features,
        sp.price,
        sp.currency
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

    return c.json({
      success: true,
      data: {
        hasSubscription: true,
        tier: subscription.plan_id,
        plan: {
          id: subscription.plan_id,
          name: subscription.plan_name,
          features: subscription.features ? JSON.parse(subscription.features as string) : [],
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end
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

    const returnUrl = validated.data.returnUrl || `${c.env.FRONTEND_URL || 'https://aniflixx-api.black-poetry-4fa5.workers.dev'}/account`;

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

    // For now, parse without verification (add verification later)
    const event = JSON.parse(body);
    console.log(`Webhook: Processing ${event.type} event`);

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('Checkout completed for:', session.metadata?.user_id);
        // Subscription will be created via customer.subscription.created event
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
        // TODO: Send notification email
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

// Helper function: Update subscription
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

    // Map product to plan
    const productId = subscription.items.data[0]?.price.product;
    const planMap: Record<string, string> = {
      'prod_T4OFhO7IfIigBV': 'pro',
      'prod_T4OFO4IYwaumrZ': 'max',
      'prod_T4OFmnsdMa34lf': 'creator_pro'
    };
    const planId = planMap[productId] || 'pro';

    // Check if subscription exists
    const existing = await db.prepare(`
      SELECT id FROM user_subscriptions WHERE stripe_subscription_id = ?
    `).bind(subscription.id).first();

    if (existing) {
      // Update existing
      await db.prepare(`
        UPDATE user_subscriptions SET
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          cancel_at_period_end = ?,
          updated_at = ?
        WHERE stripe_subscription_id = ?
      `).bind(
        subscription.status,
        new Date(subscription.current_period_start * 1000).toISOString(),
        new Date(subscription.current_period_end * 1000).toISOString(),
        subscription.cancel_at_period_end ? 1 : 0,
        new Date().toISOString(),
        subscription.id
      ).run();
    } else {
      // Create new
      await db.prepare(`
        INSERT INTO user_subscriptions (
          id, user_id, stripe_subscription_id, stripe_customer_id,
          plan_id, status, current_period_start, current_period_end,
          cancel_at_period_end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        nanoid(),
        user.id,
        subscription.id,
        subscription.customer,
        planId,
        subscription.status,
        new Date(subscription.current_period_start * 1000).toISOString(),
        new Date(subscription.current_period_end * 1000).toISOString(),
        subscription.cancel_at_period_end ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString()
      ).run();
    }

    // Update user tier
    await db.prepare(`
      UPDATE users SET 
        subscription_tier = ?,
        is_premium = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      planId,
      subscription.status === 'active' ? 1 : 0,
      new Date().toISOString(),
      user.id
    ).run();

    console.log(`Subscription updated for user ${user.id}: ${planId} (${subscription.status})`);
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

// Helper function: Handle subscription deletion
async function handleSubscriptionDeleted(db: D1Database, subscription: any) {
  try {
    // Mark as canceled
    await db.prepare(`
      UPDATE user_subscriptions SET
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

// Add payment history table creation to your migration
const paymentHistorySchema = `
CREATE TABLE IF NOT EXISTS payment_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_invoice_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  refund_amount INTEGER DEFAULT 0,
  refund_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export { router as paymentsRouter };