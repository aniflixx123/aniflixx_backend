import jwt from 'jsonwebtoken';
import type { JWTPayload } from '../types';

export function generateToken(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss'>,
  secret: string,
  issuer: string,
  expiresIn: string
): string {
  return jwt.sign(
    {
      ...payload,
      iss: issuer
    },
    secret,
    { expiresIn }
  );
}

export function verifyToken(token: string, secret: string): JWTPayload {
  return jwt.verify(token, secret) as JWTPayload;
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}