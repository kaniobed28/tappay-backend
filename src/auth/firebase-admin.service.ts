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
      const parts = token.split(':');
      if (parts[0] !== 'dev' || !parts[1]) {
        throw new Error('Dev auth expects token "dev:<uid>[:email]"');
      }
      return { uid: parts[1], email: parts[2] };
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

  /** Firebase Cloud Messaging handle, or null when Firebase isn't configured (dev). */
  getMessaging(): admin.messaging.Messaging | null {
    return this.app ? this.app.messaging() : null;
  }
}
