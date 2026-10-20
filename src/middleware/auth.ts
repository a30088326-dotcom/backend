import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { db } from '../lib/db';
import { RowDataPacket } from 'mysql2';

// ─── JWT Payload Type ─────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'CANDIDATE';
}

// Extend Express Request to include our user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─── Generate Token ───────────────────────────────────────────────────────────

export function generateToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any,
  });
}

// ─── Verify Token ─────────────────────────────────────────────────────────────

export function verifyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return jwt.verify(token, secret) as JwtPayload;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
    return;
  }

  try {
    // Verify user still exists and is active
    const [rows] = await db.query<RowDataPacket[]>('SELECT id, email, role, isActive, mustChangePassword FROM users WHERE id = ? LIMIT 1', [payload.userId]);
    const user = rows[0];

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'Account not found or inactive' });
      return;
    }

    req.user = { userId: user.id, email: user.email, role: user.role };
    if (user.mustChangePassword && !['/api/auth/me', '/api/auth/change-password'].includes(req.originalUrl.split('?')[0])) {
      res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password before using the system.' });
      return;
    }
    next();
  } catch (err) {
    console.error('Auth Database Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error verifying account' });
  }
}

// ─── Admin Only Middleware ────────────────────────────────────────────────────

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }

  next();
}
