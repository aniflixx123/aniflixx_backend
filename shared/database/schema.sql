-- Fixed and optimized database schema for Cloudflare D1

-- Create base tables first
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  profile_image TEXT,
  bio TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  flicks_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Hub Posts table (keep separate from flicks)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  media_urls TEXT,
  type TEXT DEFAULT 'text' CHECK(type IN ('text', 'image', 'video')),
  visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'followers', 'clan')),
  clan_id TEXT,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Flicks table (main video content)
CREATE TABLE IF NOT EXISTS flicks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  profile_image TEXT,
  title TEXT NOT NULL,
  description TEXT,
  hashtags TEXT, -- JSON array
  
  -- Cloudflare Stream data
  stream_video_id TEXT NOT NULL,
  duration REAL,
  thumbnail_url TEXT,
  animated_thumbnail_url TEXT,
  playback_url TEXT,
  dash_url TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'deleted', 'processing')),
  width INTEGER,
  height INTEGER,
  size INTEGER,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Flick analytics table
CREATE TABLE IF NOT EXISTS flick_analytics (
  flick_id TEXT PRIMARY KEY,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0,
  avg_watch_time REAL DEFAULT 0,
  
  FOREIGN KEY (flick_id) REFERENCES flicks(id) ON DELETE CASCADE
);

-- Rename likes tables to avoid conflicts
-- Post likes
CREATE TABLE IF NOT EXISTS post_likes (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- Flick likes
CREATE TABLE IF NOT EXISTS flick_likes (
  id TEXT PRIMARY KEY,
  flick_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (flick_id) REFERENCES flicks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(flick_id, user_id)
);

-- Flick saves
CREATE TABLE IF NOT EXISTS flick_saves (
  id TEXT PRIMARY KEY,
  flick_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (flick_id) REFERENCES flicks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(flick_id, user_id)
);

-- Follows table
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (follower_id != following_id)
);

-- Hub comments (for posts)
CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  parent_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES post_comments(id) ON DELETE CASCADE
);

-- Flick comments
CREATE TABLE IF NOT EXISTS flick_comments (
  id TEXT PRIMARY KEY,
  flick_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  profile_image TEXT,
  content TEXT NOT NULL,
  parent_id TEXT, -- For replies
  likes INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (flick_id) REFERENCES flicks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES flick_comments(id) ON DELETE CASCADE
);

-- Flick comment likes
CREATE TABLE IF NOT EXISTS flick_comment_likes (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (comment_id) REFERENCES flick_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(comment_id, user_id)
);

-- Shares table
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Clans table
CREATE TABLE IF NOT EXISTS clans (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  avatar_url TEXT,
  founder_id TEXT NOT NULL,
  member_count INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (founder_id) REFERENCES users(id)
);

-- Clan members table
CREATE TABLE IF NOT EXISTS clan_members (
  clan_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK(role IN ('founder', 'admin', 'moderator', 'member')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clan_id, user_id),
  FOREIGN KEY (clan_id) REFERENCES clans(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Flick views table (for detailed analytics)
CREATE TABLE IF NOT EXISTS flick_views (
  id TEXT PRIMARY KEY,
  flick_id TEXT NOT NULL,
  user_id TEXT, -- Can be null for anonymous views
  duration REAL,
  watch_time REAL,
  completion_rate REAL,
  source TEXT, -- home, profile, search, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (flick_id) REFERENCES flicks(id) ON DELETE CASCADE
);

-- Unified notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  sender_id TEXT,
  type TEXT NOT NULL, -- like, comment, follow, mention, post_like, flick_like
  target_type TEXT, -- post, flick, comment, user
  target_id TEXT, -- ID of the target entity
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- flick, comment, user, post
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

-- Create indexes for performance
-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Post indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_clan ON posts(clan_id, created_at DESC) WHERE clan_id IS NOT NULL;

-- Flick indexes
CREATE INDEX IF NOT EXISTS idx_flicks_user_id ON flicks(user_id);
CREATE INDEX IF NOT EXISTS idx_flicks_status ON flicks(status);
CREATE INDEX IF NOT EXISTS idx_flicks_created_at ON flicks(created_at);
CREATE INDEX IF NOT EXISTS idx_flicks_hashtags ON flicks(hashtags);

-- Flick engagement indexes
CREATE INDEX IF NOT EXISTS idx_flick_likes_flick_id ON flick_likes(flick_id);
CREATE INDEX IF NOT EXISTS idx_flick_likes_user_id ON flick_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_flick_saves_flick_id ON flick_saves(flick_id);
CREATE INDEX IF NOT EXISTS idx_flick_saves_user_id ON flick_saves(user_id);

-- Comment indexes
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_flick_comments_flick_id ON flick_comments(flick_id);
CREATE INDEX IF NOT EXISTS idx_flick_comments_parent_id ON flick_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_flick_comments_is_deleted ON flick_comments(is_deleted);

-- View analytics indexes
CREATE INDEX IF NOT EXISTS idx_flick_views_flick_id ON flick_views(flick_id);
CREATE INDEX IF NOT EXISTS idx_flick_views_user_id ON flick_views(user_id);
CREATE INDEX IF NOT EXISTS idx_flick_views_created_at ON flick_views(created_at);

-- Other indexes
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clan_members_user ON clan_members(user_id);