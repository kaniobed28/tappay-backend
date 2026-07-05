import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './sessions/session.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './provider/payment-provider.interface';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { formatAmount } from '../common/format';
import { Transaction, TxnStatus, User } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly callbackUrl?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.callbackUrl = config.get<string>('PAYSTACK_CALLBACK_URL');
  }

  /** Customer confirms a resolved session -> we create a txn and start provider checkout. */
  async payFromSession(payer: User, sessionId: string) {
    const session = await this.sessions.consumeForPayment(sessionId);

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: session.merchantId },
      include: { user: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (merchant.userId === payer.id) {
      throw new BadRequestException('You cannot pay your own request');
    }

    const reference = `tap_${crypto.randomBytes(10).toString('hex')}`;
    // Provider requires a valid email; `.local` fails Paystack validation, so fall back to
    // a routable placeholder domain for users who have no email on file.
    const email = payer.email ?? `${payer.firebaseUid}@tappay.app`;

    // Record the intent before contacting the provider (idempotent single-use session).
    const txn = await this.prisma.transaction.create({
      data: {
        reference,
        sessionId: session.id,
        merchantId: merchant.id,
        payerId: payer.id,
        payeeId: merchant.userId,
        amount: session.amount,
        currency: session.currency,
        provider: this.provider.name,
        status: TxnStatus.INITIALIZED,
        description: session.description,
      },
    });
    await this.sessions.markConsumed(session.id);
    this.audit.log({
      actorId: payer.id,
      action: 'payment.init',
      targetType: 'transaction',
      targetId: txn.id,
      meta: { reference, amount: session.amount, merchantId: merchant.id },
    });

    try {
      const init = await this.provider.initializePayment({
        reference,
        amount: session.amount,
        currency: session.currency,
        email,
        callbackUrl: this.callbackUrl,
        metadata: { sessionId: session.id, merchantId: merchant.id, txnId: txn.id },
      });

      const updated = await this.prisma.transaction.update({
        where: { id: txn.id },
        data: {
          status: TxnStatus.PENDING,
          authorizationUrl: init.authorizationUrl,
          providerMeta: init.raw as object,
        },
      });
      return {
        transactionId: updated.id,
        reference: updated.reference,
        authorizationUrl: updated.authorizationUrl,
        amount: updated.amount,
        currency: updated.currency,
        status: updated.status,
      };
    } catch (err) {
      await this.prisma.transaction.update({
        where: { id: txn.id },
        data: { status: TxnStatus.FAILED },
      });
      this.logger.error(`Provider init failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to start payment with provider');
    }
  }

  /**
   * Authoritatively reconcile a transaction against the provider and persist the result.
   * Called on-demand (customer/merchant polling) and from the webhook. Idempotent.
   */
  async reconcile(reference: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { reference } });
    if (!txn) throw new NotFoundException('Transaction not found');
    if (txn.status === TxnStatus.SUCCESS) return txn; // already settled

    const result = await this.provider.verifyPayment(reference);

    // Guard against amount/currency mismatch — never trust a smaller charge as success.
    const amountOk = result.amount === txn.amount && result.currency === txn.currency;
    let status: TxnStatus = txn.status;
    if (result.status === 'success') status = amountOk ? TxnStatus.SUCCESS : TxnStatus.FAILED;
    else if (result.status === 'failed') status = TxnStatus.FAILED;

    if (result.status === 'success' && !amountOk) {
      this.logger.warn(
        `Amount mismatch on ${reference}: provider ${result.amount} ${result.currency} vs expected ${txn.amount} ${txn.currency}`,
      );
    }

    const updated = await this.prisma.transaction.update({
      where: { reference },
      data: { status, providerMeta: result.raw as object },
    });

    // Fire side-effects only on the transition into a terminal state.
    if (txn.status !== updated.status) {
      if (updated.status === TxnStatus.SUCCESS) await this.onPaymentSuccess(updated);
      else if (updated.status === TxnStatus.FAILED) await this.onPaymentFailed(updated);
    }

    return updated;
  }

  private async onPaymentSuccess(txn: Transaction) {
    const amount = formatAmount(txn.amount, txn.currency);
    this.audit.log({
      actorId: txn.payerId,
      action: 'payment.success',
      targetType: 'transaction',
      targetId: txn.id,
      meta: { reference: txn.reference, amount: txn.amount },
    });

    const payload = {
      transactionId: txn.id,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
      status: txn.status,
      sessionId: txn.sessionId,
      description: txn.description,
    };
    this.realtime.emitPaymentEvent('payment.success', { merchantId: txn.merchantId, payerId: txn.payerId }, payload);

    // Merchant gets "payment received"; payer gets a receipt-style confirmation.
    await this.notifications.notify(txn.payeeId, {
      type: 'payment_received',
      title: 'Payment received',
      body: `You received ${amount}${txn.description ? ` for ${txn.description}` : ''}.`,
      data: { transactionId: txn.id, reference: txn.reference },
    });
    if (txn.payerId) {
      await this.notifications.notify(txn.payerId, {
        type: 'payment_success',
        title: 'Payment successful',
        body: `Your payment of ${amount} was successful.`,
        data: { transactionId: txn.id, reference: txn.reference },
      });
    }
  }

  private async onPaymentFailed(txn: Transaction) {
    this.audit.log({
      actorId: txn.payerId,
      action: 'payment.failed',
      targetType: 'transaction',
      targetId: txn.id,
      meta: { reference: txn.reference },
    });
    this.realtime.emitPaymentEvent(
      'payment.failed',
      { merchantId: txn.merchantId, payerId: txn.payerId },
      {
        transactionId: txn.id,
        reference: txn.reference,
        amount: txn.amount,
        currency: txn.currency,
        status: txn.status,
        sessionId: txn.sessionId,
        description: txn.description,
      },
    );
    if (txn.payerId) {
      await this.notifications.notify(txn.payerId, {
        type: 'payment_failed',
        title: 'Payment failed',
        body: `Your payment of ${formatAmount(txn.amount, txn.currency)} could not be completed.`,
        data: { transactionId: txn.id, reference: txn.reference },
      });
    }
  }

  async getForUser(user: User, id: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { id } });
    if (!txn || (txn.payerId !== user.id && txn.payeeId !== user.id)) {
      throw new NotFoundException('Transaction not found');
    }
    return txn;
  }

  /** History for a user, both sent and received. */
  async history(user: User, take = 50) {
    return this.prisma.transaction.findMany({
      where: { OR: [{ payerId: user.id }, { payeeId: user.id }] },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
