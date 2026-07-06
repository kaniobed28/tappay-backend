import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as admin from 'firebase-admin';

export interface VerifiedIdentity {
  uid: string;
  email?: string;
  phone?: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app?: admin.app.App;
  private devMode = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Prefer base64 (single-line, paste-safe) over raw JSON (its private-key newlines
    // are easily mangled in env-var fields). Both, or a file path, are supported.
    const b64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');
    const json = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    const path = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

    let credential: admin.ServiceAccount | undefined;
    try {
      const candidate =
        (b64 && b64.trim()) ||
        (json && json.trim()) ||
        (path && fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : undefined);

      if (candidate) {
        // Tolerant of either form: raw JSON, or base64-encoded JSON, in any of the vars.
        const parsed = this.parseServiceAccount(candidate);
        if (!parsed || !parsed.project_id) {
          throw new Error('could not read a service account with "project_id" (accepts raw JSON or base64 JSON)');
        }
        credential = parsed;
      }
    } catch (err) {
      this.logger.error(`Invalid Firebase service account: ${(err as Error).message}`);
    }

    const isProd = this.config.get('NODE_ENV') === 'production';
    const allowDevAuth = String(this.config.get('ALLOW_DEV_AUTH')) === 'true';

    if (credential) {
      // Never let a bad credential crash the whole payments API (avoids a boot crash-loop).
      try {
        this.app = admin.apps.length
          ? admin.app()
          : admin.initializeApp({ credential: admin.credential.cert(credential) });
        this.logger.log('Firebase Admin initialized');
      } catch (err) {
        this.logger.error(`Firebase init failed — auth will reject requests: ${(err as Error).message}`);
      }
    } else if (!isProd || allowDevAuth) {
      // No Firebase configured. Accept tokens of the form "dev:<uid>[:email]" so the app
      // is usable without a Firebase project. Automatic in non-prod; in prod it requires
      // the explicit ALLOW_DEV_AUTH=true flag (insecure — for demos only).
      this.devMode = true;
      const where = isProd ? 'PRODUCTION (ALLOW_DEV_AUTH=true)' : 'development';
      this.logger.warn(
        `Firebase not configured — DEV auth mode in ${where}. Accepts "dev:<uid>" tokens; ` +
          'ANYONE can impersonate any user. Wire Firebase and remove ALLOW_DEV_AUTH before real use.',
      );
    } else {
      this.logger.error('Firebase service account missing in production. Auth will reject all requests.');
    }
  }

  /** Parses a service account from raw JSON or base64-encoded JSON. Returns null if neither. */
  private parseServiceAccount(value: string): any {
    const tryJson = (s: string) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };
    // 1) direct JSON
    const direct = tryJson(value);
    if (direct) return direct;
    // 2) base64-encoded JSON
    try {
      return tryJson(Buffer.from(value, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    if (this.devMode) {
      // "dev:<uid>" or "dev:<uid>:email@example.com"
      if (token.startsWith('dev:')) {
        const parts = token.split(':');
        if (!parts[1]) throw new Error('Dev auth expects token "dev:<uid>[:email]"');
        return { uid: parts[1], email: parts[2] };
      }
      // The app may be running with a real Firebase project while this backend has no
      // service account (common local setup). Accept the ID token WITHOUT signature
      // verification — dev mode already allows arbitrary impersonation, so this adds
      // no new risk, and it stops every request from 401ing in that setup.
      const unverified = this.decodeUnverifiedJwt(token);
      if (unverified) return unverified;
      throw new Error('Dev auth expects "dev:<uid>[:email]" or a Firebase ID token');
    }

    if (!this.app) throw new Error('Auth is not configured');
    const decoded = await this.app.auth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      phone: decoded.phone_number,
      name: decoded.name,
      picture: decoded.picture,
    };
  }

  /** Decodes a JWT payload without verifying its signature. DEV MODE ONLY. */
  private decodeUnverifiedJwt(token: string): VerifiedIdentity | null {
    const segments = token.split('.');
    if (segments.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
      const uid = payload.user_id ?? payload.sub;
      if (!uid || typeof uid !== 'string') return null;
      return {
        uid,
        email: payload.email,
        phone: payload.phone_number,
        name: payload.name,
        picture: payload.picture,
      };
    } catch {
      return null;
    }
  }

  /** Firebase Cloud Messaging handle, or null when Firebase isn't configured (dev). */
  getMessaging(): admin.messaging.Messaging | null {
    return this.app ? this.app.messaging() : null;
  }
}
