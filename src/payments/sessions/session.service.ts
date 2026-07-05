import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantsService } from '../../merchants/merchants.service';
import { AuditService } from '../../audit/audit.service';
import { signSession, verifySessionSignature } from './session-signing';
import { PaymentSession, SessionChannel, SessionStatus } from '@prisma/client';

export interface SessionPayload {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  description?: string | null;
  nonce: string;
  channel: SessionChannel;
  expiresAt: string;
  signature: string;
}

@Injectable()
export class SessionService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('SESSION_SIGNING_SECRET') ?? 'insecure-dev-secret';
    this.ttlSeconds = Number(config.get('SESSION_TTL_SECONDS') ?? 180);
  }

  /** Merchant creates a signed session to broadcast over NFC or render as a QR code. */
  async create(
    userId: string,
    input: { amount: number; description?: string; channel?: SessionChannel },
  ): Promise<SessionPayload> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('amount must be a positive integer (minor units)');
    }
    const merchant = await this.merchants.requireActiveMerchant(userId);

    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const signature = signSession(
      {
        id,
        merchantId: merchant.id,
        amount: input.amount,
        currency: merchant.currency,
        nonce,
        expiresAt: expiresAt.toISOString(),
      },
      this.secret,
    );

    const session = await this.prisma.paymentSession.create({
      data: {
        id,
        merchantId: merchant.id,
        createdById: userId,
        amount: input.amount,
        currency: merchant.currency,
        description: input.description,
        channel: input.channel ?? SessionChannel.NFC,
        nonce,
        signature,
        expiresAt,
      },
    });

    this.audit.log({
      actorId: userId,
      action: 'session.create',
      targetType: 'session',
      targetId: session.id,
      meta: { amount: input.amount, merchantId: merchant.id, channel: session.channel },
    });

    return this.toPayload(session, merchant.businessName);
  }

  /** Customer resolves a scanned/tapped session; validates signature, expiry and status. */
  async resolve(sessionId: string): Promise<SessionPayload> {
    const session = await this.prisma.paymentSession.findUnique({
      where: { id: sessionId },
      include: { merchant: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    this.assertUsable(session);

    const valid = verifySessionSignature(
      {
        id: session.id,
        merchantId: session.merchantId,
        amount: session.amount,
        currency: session.currency,
        nonce: session.nonce,
        expiresAt: session.expiresAt.toISOString(),
      },
      session.signature,
      this.secret,
    );
    if (!valid) throw new BadRequestException('Session signature is invalid');

    return this.toPayload(session, session.merchant.businessName);
  }

  /** Loads a session for consumption by the payment flow, enforcing single-use. */
  async consumeForPayment(sessionId: string): Promise<PaymentSession> {
    const session = await this.prisma.paymentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    this.assertUsable(session);
    return session;
  }

  async markConsumed(sessionId: string) {
    await this.prisma.paymentSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.CONSUMED },
    });
  }

  private assertUsable(session: PaymentSession) {
    if (session.status !== SessionStatus.PENDING) {
      throw new BadRequestException(`Session is ${session.status.toLowerCase()}`);
    }
    if (session.expiresAt.getTime() < Date.now()) {
      // Best-effort flip to EXPIRED so it can't be retried.
      void this.prisma.paymentSession
        .update({ where: { id: session.id }, data: { status: SessionStatus.EXPIRED } })
        .catch(() => undefined);
      throw new BadRequestException('Session has expired');
    }
  }

  private toPayload(session: PaymentSession, merchantName: string): SessionPayload {
    return {
      id: session.id,
      merchantId: session.merchantId,
      merchantName,
      amount: session.amount,
      currency: session.currency,
      description: session.description,
      nonce: session.nonce,
      channel: session.channel,
      expiresAt: session.expiresAt.toISOString(),
      signature: session.signature,
    };
  }
}
