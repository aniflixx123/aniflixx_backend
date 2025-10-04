-- Device tokens table for mobile app authentication
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  device_id TEXT NOT NULL,
  device_model TEXT,
  platform TEXT CHECK(platform IN ('ios', 'android')) NOT NULL,
  app_version TEXT,
  is_active INTEGER DEFAULT 1,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes separately (SQLite requirement)
CREATE INDEX IF NOT EXISTS idx_device_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_token ON device_tokens(token);

-- Checkout sessions table for mobile-to-web payment flow
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  device_token_id TEXT,
  stripe_session_id TEXT,
  price_id TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired', 'cancelled')),
  metadata TEXT,
  expires_at DATETIME NOT NULL,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (device_token_id) REFERENCES device_tokens(id) ON DELETE SET NULL
);

-- Create indexes for checkout_sessions
CREATE INDEX IF NOT EXISTS idx_session_token ON checkout_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_session_user ON checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_session_status ON checkout_sessions(status);