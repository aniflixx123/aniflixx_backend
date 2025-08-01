// workers/api-worker/src/types.ts

export interface Env {
  // D1 Database
  DB: D1Database;
  
  // KV Namespaces
  CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  
  // Durable Objects
  POST_COUNTERS: DurableObjectNamespace;
  
  // Environment Variables
  ENVIRONMENT: string;
  AUTH_WORKER_URL: string;
  MEDIA_WORKER_URL: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

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
  created_at: string;
  updated_at: string;
}

export interface Like {
  user_id: string;
  post_id: string;
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