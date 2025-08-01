export interface Env {
  // D1 Database
  DB: D1Database;
  
  // KV Namespaces
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  
  // Environment Variables
  JWT_SECRET: string;
  HASH_SECRET: string;
  JWT_ISSUER: string;
  JWT_EXPIRY: string;
  REFRESH_EXPIRY: string;
  ENVIRONMENT: string;
}

export interface User {
  id: string;
  email: string;
  username: string | null;
  password_hash: string;
  profile_image: string | null;
  bio: string | null;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface JWTPayload {
  sub: string; // user id
  email: string;
  username?: string;
  iat: number;
  exp: number;
  iss: string;
}