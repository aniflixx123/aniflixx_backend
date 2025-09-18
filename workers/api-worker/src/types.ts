// workers/api-worker/src/types.ts

export interface Env {
  // D1 Database
  DB: D1Database;
  
  // KV Namespaces
  CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  
  // Durable Objects
  POST_COUNTERS: DurableObjectNamespace;
  FLICK_COUNTERS: DurableObjectNamespace;
  VIEWER_TRACKER: DurableObjectNamespace;
  
  // Environment Variables
  ENVIRONMENT: string;
  AUTH_WORKER_URL: string;
  MEDIA_WORKER_URL: string;
  CLOUDFLARE_STREAM_CUSTOMER_CODE: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  
  // ADD THESE NEW STRIPE VARIABLES:
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FRONTEND_URL: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

// Add is_liked to Post interface in workers/api-worker/src/types.ts

export interface Post {
  id: string;
  user_id: string;
  content: string;
  media_urls: string[] | null;
  type: 'text' | 'image' | 'video';
  visibility: 'public' | 'followers' | 'clan';
  clan_id: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
  updated_at: string;
  is_liked?: boolean;  // Add this field
}

export interface Flick {
  id: string;
  user_id: string;
  username: string;
  profile_image: string | null;
  title: string;
  description: string | null;
  hashtags: string[];
  stream_video_id: string;
  duration: number;
  thumbnail_url: string;
  animated_thumbnail_url: string;
  playback_url: string;
  dash_url: string;
  status: 'active' | 'deleted' | 'processing';
  width: number;
  height: number;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface FlickAnalytics {
  flick_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completion_rate: number;
  avg_watch_time: number;
}

export interface User {
  id: string;
  email: string;
  username: string;
  profile_image: string | null;
  bio: string | null;
  followers_count: number;
  following_count: number;
  posts_count: number;
  flicks_count: number;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Like {
  user_id: string;
  post_id: string;
  created_at: string;
}

export interface FlickLike {
  id: string;
  flick_id: string;
  user_id: string;
  created_at: string;
}

export interface FlickSave {
  id: string;
  flick_id: string;
  user_id: string;
  created_at: string;
}

export interface Follow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlickComment {
  id: string;
  flick_id: string;
  user_id: string;
  username: string;
  profile_image: string | null;
  content: string;
  parent_id: string | null;
  likes: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  sender_id: string | null;
  type: string;
  target_type: string;
  target_id: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface Report {
  id: string;
  type: 'flick' | 'comment' | 'user' | 'post';
  target_id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
}

export interface FeedOptions {
  type: 'home' | 'trending' | 'following' | 'clan';
  userId?: string;
  clanId?: string;
  page?: number;
  limit?: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}