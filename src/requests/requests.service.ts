import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MerchantsService } from '../merchants/merchants.service';
import { SessionService } from '../payments/sessions/session.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { formatAmount } from '../common/format';
import { PaymentRequest, PaymentRequestStatus, User } from '@prisma/client';

/** A user record trimmed to the fields safe to expose to the counterparty. */
type PersonView = Pick<User, 'id' | 'displayName' | 'email' | 'phone'>;

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly merchants: MerchantsService,
    private readonly sessions: SessionService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  /** Requester (payee) asks a specific known user to pay them. */
  async create(requester: User, input: { target: string; amount: number; note?: string }) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('amount must be a positive integer (minor units)');
    }
    const payer = await this.users.findByIdentifier(input.target);
    if (!payer) throw new NotFoundException('No TapPay user with that email or phone');
    if (payer.id === requester.id) {
      throw new BadRequestException('You cannot request money from yourself');
    }

    const request = await this.prisma.paymentRequest.create({
      data: {
        requesterId: requester.id,
        payerId: payer.id,
        amount: input.amount,
        note: input.note,
      },
    });

    this.audit.log({
      actorId: requester.id,
      action: 'request.create',
      targetType: 'payment_request',
      targetId: request.id,
      meta: { payerId: payer.id, amount: request.amount },
    });

    const amount = formatAmount(request.amount, request.currency);
    const from =
      requester.displayName ?? requester.email ?? requester.phone ?? 'A TapPay user';
    this.realtime.emitRequestEvent('request.created', payer.id, {
      requestId: request.id,
      amount: request.amount,
      currency: request.currency,
      status: request.status,
      note: request.note,
    });
    await this.notifications.notify(payer.id, {
      type: 'request_received',
      title: 'Payment request',
      body: `${from} requested ${amount}${request.note ? ` for ${request.note}` : ''}.`,
      data: { requestId: request.id },
    });

    return this.shape(request, requester, payer);
  }

  /** Requests where the caller is the payer (things they've been asked to pay). */
  async incoming(user: User) {
    const rows = await this.prisma.paymentRequest.findMany({
      where: { payerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { requester: true, payer: true },
    });
    return rows.map((r) => this.shape(r, r.requester, r.payer));
  }

  /** Requests the caller has sent out (as the payee). */
  async outgoing(user: User) {
    const rows = await this.prisma.paymentRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { requester: true, payer: true },
    });
    return rows.map((r) => this.shape(r, r.requester, r.payer));
  }

  /** Payer declines a pending request. */
  async decline(user: User, id: string) {
    const request = await this.find(id);
    if (request.payerId !== user.id) {
      throw new ForbiddenException('Only the requested payer can decline this request');
    }
    if (request.status !== PaymentRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${request.status.toLowerCase()}`);
    }

    const updated = await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: { status: PaymentRequestStatus.DECLINED },
      include: { requester: true, payer: true },
    });

    this.audit.log({
      actorId: user.id,
      action: 'request.decline',
      targetType: 'payment_request',
      targetId: id,
    });
    this.realtime.emitRequestEvent('request.declined', request.requesterId, {
      requestId: request.id,
      amount: request.amount,
      currency: request.currency,
      status: PaymentRequestStatus.DECLINED,
      note: request.note,
    });
    await this.notifications.notify(request.requesterId, {
      type: 'request_declined',
      title: 'Request declined',
      body: `Your request for ${formatAmount(request.amount, request.currency)} was declined.`,
      data: { requestId: request.id },
    });

    return this.shape(updated, updated.requester, updated.payer);
  }

  /** Requester cancels (withdraws) their own pending request. */
  async cancel(user: User, id: string) {
    const request = await this.find(id);
    if (request.requesterId !== user.id) {
      throw new ForbiddenException('Only the requester can cancel this request');
    }
    if (request.status !== PaymentRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${request.status.toLowerCase()}`);
    }

    const updated = await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: { status: PaymentRequestStatus.CANCELLED },
      include: { requester: true, payer: true },
    });

    this.audit.log({
      actorId: user.id,
      action: 'request.cancel',
      targetType: 'payment_request',
      targetId: id,
    });
    this.realtime.emitRequestEvent('request.cancelled', request.payerId, {
      requestId: request.id,
      amount: request.amount,
      currency: request.currency,
      status: PaymentRequestStatus.CANCELLED,
      note: request.note,
    });
    await this.notifications.notify(request.payerId, {
      type: 'request_cancelled',
      title: 'Request cancelled',
      body: `A request for ${formatAmount(request.amount, request.currency)} was cancelled.`,
      data: { requestId: request.id },
    });

    return this.shape(updated, updated.requester, updated.payer);
  }

  /**
   * Payer settles a pending request. This reuses the standard settlement path exactly:
   * we mint a signed session on the requester's behalf and run it through the same
   * `payFromSession` checkout the NFC/QR flow uses, then link the resulting transaction to
   * the request. The request stays PENDING until the payment actually settles (webhook /
   * reconcile), at which point `PaymentsService` marks it PAID.
   */
  async pay(payer: User, id: string) {
    const request = await this.find(id);
    if (request.payerId !== payer.id) {
      throw new ForbiddenException('Only the requested payer can pay this request');
    }
    if (request.status !== PaymentRequestStatus.PENDING) {
      throw new BadRequestException(`Request is ${request.status.toLowerCase()}`);
    }

    // The requester (payee) must be able to receive money — provision a merchant if needed.
    await this.merchants.ensurePersonalMerchant(request.requesterId);

    const session = await this.sessions.create(request.requesterId, {
      amount: request.amount,
      description: request.note ?? undefined,
    });
    const result = await this.payments.payFromSession(payer, session.id);

    await this.prisma.paymentRequest.update({
      where: { id: request.id },
      data: { sessionId: session.id, transactionId: result.transactionId },
    });

    this.audit.log({
      actorId: payer.id,
      action: 'request.pay',
      targetType: 'payment_request',
      targetId: request.id,
      meta: { transactionId: result.transactionId, sessionId: session.id },
    });

    return result;
  }

  private async find(id: string): Promise<PaymentRequest> {
    const request = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private shape(r: PaymentRequest, requester?: PersonView | null, payer?: PersonView | null) {
    return {
      id: r.id,
      amount: r.amount,
      currency: r.currency,
      note: r.note,
      status: r.status,
      transactionId: r.transactionId,
      sessionId: r.sessionId,
      createdAt: r.createdAt,
      requesterId: r.requesterId,
      payerId: r.payerId,
      requester: requester ? this.person(requester) : undefined,
      payer: payer ? this.person(payer) : undefined,
    };
  }

  private person(u: PersonView) {
    return { id: u.id, displayName: u.displayName, email: u.email, phone: u.phone };
  }
}
