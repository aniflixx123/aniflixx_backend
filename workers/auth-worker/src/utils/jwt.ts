// workers/auth-worker/src/utils/jwt.ts
import type { JWTPayload } from '../types';

// Simple JWT implementation for Cloudflare Workers
export async function generateToken(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss'>,
  secret: string,
  issuer: string,
  expiresIn: string
): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iss: issuer,
    iat: now,
    exp: now + 604800 // 7 days
  };
  
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, '');
  
  const signature = await createSignature(`${encodedHeader}.${encodedPayload}`, secret);
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  
  const [header, payload, signature] = parts;
  const expectedSignature = await createSignature(`${header}.${payload}`, secret);
  
  if (signature !== expectedSignature) {
    throw new Error('Invalid signature');
  }
  
  const decodedPayload = JSON.parse(atob(payload)) as JWTPayload;
  
  // Check expiration
  if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  
  return decodedPayload;
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

async function createSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');
}