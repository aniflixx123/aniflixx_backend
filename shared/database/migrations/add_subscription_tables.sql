-- Create subscription plans table (needed for Stripe)
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  stripe_product_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  features TEXT, -- JSON array
  price INTEGER NOT NULL,
  currency TEXT NOT NULL,
  billing_interval TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create user subscriptions table (tracks active subscriptions)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start DATETIME,
  current_period_end DATETIME,
  cancel_at_period_end INTEGER DEFAULT 0,
  canceled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

-- Create payment history table (tracks all payments)
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe ON user_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_date ON payment_history(created_at DESC);

-- Insert your Stripe subscription plans
INSERT OR IGNORE INTO subscription_plans (id, stripe_product_id, name, description, features, price, currency, billing_interval) VALUES 
('pro', 'prod_T4OFhO7IfIigBV', 'Aniflixx Pro', 'Essential anime streaming with HD quality', '["HD streaming up to 1080p","No ads","Access to seasonal anime","Create up to 5 watchlists","Basic community features"]', 499, 'usd', 'month'),
('max', 'prod_T4OFO4IYwaumrZ', 'Aniflixx Max', 'Premium anime experience with 4K and downloads', '["4K streaming","No ads","Offline downloads (25 episodes)","Simulcast access","Early access to new episodes","Unlimited watchlists","Priority support","Advanced community features","Exclusive Max badge"]', 799, 'usd', 'month'),
('creator_pro', 'prod_T4OFmnsdMa34lf', 'Aniflixx Creator Pro', 'Ultimate creator experience with all features', '["All Max features included","Creator dashboard and analytics","Upload and monetize content","Exclusive creator content","Advanced moderation tools","Verified creator badge","Priority encoding","Custom channel branding","Revenue sharing program","Direct fan engagement tools"]', 1299, 'usd', 'month');