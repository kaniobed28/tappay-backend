/**
 * Integration tests for the payment-session lifecycle against a REAL PostgreSQL.
 * These prove the anti-replay guarantees that unit tests can't: single-use consumption
 * and expiry enforcement are DB-backed state transitions.
 *
 * Requires DATABASE_URL (loaded from .env locally, provided by the CI Postgres service).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { SessionService } from '../../src/sessions/session.service';
import { MerchantsService } from '../../src/merchants/merchants.service';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d('payment session lifecycle (real Postgres)', () => {
  const prisma = new PrismaClient();
  const merchants = new MerchantsService(prisma as any);
  const audit = { log: jest.fn() };
  const config = {
    get: (key: string) =>
      ({
        SESSION_SIGNING_SECRET: 'integration-test-secret-0123456789',
        SESSION_TTL_SECONDS: 60,
      })[key],
  } as unknown as ConfigService;
  const sessions = new SessionService(prisma as any, merchants, audit as any, config);

  const uid = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { firebaseUid: uid, email: `${uid}@example.com` },
    });
    userId = user.id;
    await prisma.merchant.create({
      data: { userId, businessName: 'Integration Test Shop', currency: 'GHS' },
    });
  });

  afterAll(async () => {
    // Cascades remove merchant + sessions with the user.
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('creates a signed session and resolves it', async () => {
    const payload = await sessions.create(userId, { amount: 5000, description: 'Test sale' });
    expect(payload.signature).toHaveLength(64); // HMAC-SHA256 hex
    const resolved = await sessions.resolve(payload.id);
    expect(resolved.amount).toBe(5000);
    expect(resolved.merchantName).toBe('Integration Test Shop');
  });

  it('enforces single-use: a consumed session cannot be paid again', async () => {
    const payload = await sessions.create(userId, { amount: 1000 });

    // First consumption succeeds…
    await sessions.consumeForPayment(payload.id);
    await sessions.markConsumed(payload.id);

    // …replaying the same session (same QR / same NFC payload) is rejected.
    await expect(sessions.consumeForPayment(payload.id)).rejects.toThrow(BadRequestException);
    await expect(sessions.resolve(payload.id)).rejects.toThrow(/consumed/i);
  });

  it('rejects expired sessions and flips them to EXPIRED', async () => {
    const payload = await sessions.create(userId, { amount: 2000 });
    await prisma.paymentSession.update({
      where: { id: payload.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(sessions.resolve(payload.id)).rejects.toThrow(/expired/i);
    // Give the best-effort status flip a beat, then verify it landed.
    await new Promise((r) => setTimeout(r, 300));
    const row = await prisma.paymentSession.findUnique({ where: { id: payload.id } });
    expect(row?.status).toBe('EXPIRED');
  });

  it('rejects a session whose signature no longer matches its data (DB tamper)', async () => {
    const payload = await sessions.create(userId, { amount: 3000 });
    // Attacker with DB write access bumps the amount without re-signing.
    await prisma.paymentSession.update({
      where: { id: payload.id },
      data: { amount: 1 },
    });
    await expect(sessions.resolve(payload.id)).rejects.toThrow(/signature/i);
  });

  it('404s for a session id that does not exist', async () => {
    await expect(sessions.resolve('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundException,
    );
  });
});
