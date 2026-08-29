import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { MomoTokenResponse } from './momo.types';

/**
 * Authenticated transport for the MTN MoMo Collection API.
 *
 * MoMo access tokens are short-lived (1h) and minted from the API user/key pair, so the
 * client caches one and refreshes it slightly early rather than authenticating per call.
 */
export class MomoClient {
  private readonly logger = new Logger(MomoClient.name);
  private readonly http: AxiosInstance;
  private readonly subscriptionKey: string;
  private readonly apiUser: string;
  private readonly apiKey: string;

  /** Cached token and the moment it stops being usable. */
  private token?: { value: string; expiresAt: number };
  /** In-flight refresh, so concurrent payments mint one token, not N. */
  private refreshing?: Promise<string>;

  readonly targetEnvironment: string;

  constructor(config: ConfigService) {
    this.subscriptionKey = config.get<string>('MOMO_SUBSCRIPTION_KEY') ?? '';
    this.apiUser = config.get<string>('MOMO_API_USER') ?? '';
    this.apiKey = config.get<string>('MOMO_API_KEY') ?? '';
    this.targetEnvironment = config.get<string>('MOMO_TARGET_ENVIRONMENT') ?? 'mtnghana';
    this.http = axios.create({
      baseURL: config.get<string>('MOMO_BASE_URL') ?? 'https://proxy.momoapi.mtn.com',
      timeout: 20000,
    });
  }

  get isSandbox(): boolean {
    return this.targetEnvironment === 'sandbox';
  }

  /** Headers every Collection call needs, including a fresh bearer token. */
  async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.accessToken()}`,
      'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      'X-Target-Environment': this.targetEnvironment,
    };
  }

  async post<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
    const { data } = await this.http.post<T>(url, body, {
      headers: { ...(await this.authHeaders()), ...headers },
    });
    return data;
  }

  async get<T>(url: string): Promise<T> {
    const { data } = await this.http.get<T>(url, { headers: await this.authHeaders() });
    return data;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;
    // Collapse concurrent refreshes onto one request.
    this.refreshing ??= this.mintToken().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async mintToken(): Promise<string> {
    const basic = Buffer.from(`${this.apiUser}:${this.apiKey}`).toString('base64');
    const { data } = await this.http.post<MomoTokenResponse>('/collection/token/', null, {
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      },
    });
    if (!data?.access_token) throw new Error('MoMo did not return an access token');
    // Refresh a minute early so a token never expires mid-flight.
    const ttl = Math.max((data.expires_in ?? 3600) - 60, 60);
    this.token = { value: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    this.logger.log(`Obtained MoMo access token (valid ${ttl}s)`);
    return data.access_token;
  }
}
