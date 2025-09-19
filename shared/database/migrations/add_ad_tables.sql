-- Ad impressions tracking
CREATE TABLE IF NOT EXISTS ad_impressions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_unit_id TEXT NOT NULL,
  placement TEXT NOT NULL, -- 'reel', 'feed', 'interstitial'
  position INTEGER,
  session_id TEXT,
  device_type TEXT,
  region TEXT,
  viewed_duration INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  clicked INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Ad revenue tracking
CREATE TABLE IF NOT EXISTS ad_revenue (
  id TEXT PRIMARY KEY,
  ad_impression_id TEXT,
  revenue_amount DECIMAL(10, 4),
  currency TEXT DEFAULT 'USD',
  ecpm DECIMAL(10, 4),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_impression_id) REFERENCES ad_impressions(id)
);

-- User ad preferences
CREATE TABLE IF NOT EXISTS user_ad_preferences (
  user_id TEXT PRIMARY KEY,
  frequency_preference TEXT DEFAULT 'normal', -- 'minimal', 'normal', 'maximum'
  categories_blocked TEXT, -- JSON array
  last_ad_shown_at DATETIME,
  total_ads_viewed INTEGER DEFAULT 0,
  total_ads_clicked INTEGER DEFAULT 0,
  opt_out INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Ad configuration (for A/B testing)
CREATE TABLE IF NOT EXISTS ad_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL, -- JSON config
  is_active INTEGER DEFAULT 1,
  target_percentage INTEGER DEFAULT 100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ad_impressions_user ON ad_impressions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_session ON ad_impressions(session_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_date ON ad_impressions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_revenue_date ON ad_revenue(created_at DESC);