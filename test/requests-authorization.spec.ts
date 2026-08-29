import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestsService } from '../src/requests/requests.service';
import { PaymentRequestStatus, TxnStatus } from '@prisma/client';

/**
 * Guards the IDOR / self-service rules on money requests, mirroring the rigor of the
 * refund guards: you can't request from yourself, and only the addressed payer may
 * decline (a stranger must be forbidden, never leak the request's state).
 */
function setup(request?: any, transaction?: any) {
  const prisma = {
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue(request ?? null),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'req_1',
        currency: 'GHS',
        status: PaymentRequestStatus.PENDING,
        ...data,
      })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...request, ...data })),
    },
    transaction: {
      findUnique: jest.fn().mockResolvedValue(transaction ?? null),
    },
  };
  const users = { findByIdentifier: jest.fn() };
  const merchants = { ensurePersonalMerchant: jest.fn() };
  const sessions = { create: jest.fn() };
  const payments = { payFromSession: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const realtime = { emitRequestEvent: jest.fn() };
  const audit = { log: jest.fn() };

  const service = new RequestsService(
    prisma as any,
    users as any,
    merchants as any,
    sessions as any,
    payments as any,
    notifications as any,
    realtime as any,
    audit as any,
  );
  return { service, prisma, users, notifications, realtime, sessions, payments };
}

const requester = { id: 'u_requester', displayName: 'Ama' } as any;
const payer = { id: 'u_payer' } as any;
const stranger = { id: 'u_other' } as any;

const pendingRequest = {
  id: 'req_1',
  requesterId: 'u_requester',
  payerId: 'u_payer',
  amount: 4200,
  currency: 'GHS',
  note: 'Lunch',
  status: PaymentRequestStatus.PENDING,
};

describe('RequestsService authorization', () => {
  it('rejects requesting money from yourself', async () => {
    const { service, users, prisma } = setup();
    users.findByIdentifier.mockResolvedValue(requester); // target resolves to the caller
    await expect(
      service.create(requester, { target: 'ama@example.com', amount: 4200 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    const { service } = setup();
    await expect(
      service.create(requester, { target: 'kofi@example.com', amount: 0 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('notifies the payer and emits realtime when a request is created', async () => {
    const { service, users, notifications, realtime } = setup();
    users.findByIdentifier.mockResolvedValue(payer);
    const view = await service.create(requester, { target: 'kofi@example.com', amount: 4200, note: 'Lunch' });
    expect(view.status).toBe(PaymentRequestStatus.PENDING);
    expect(notifications.notify).toHaveBeenCalledWith('u_payer', expect.objectContaining({ type: 'request_received' }));
    expect(realtime.emitRequestEvent).toHaveBeenCalledWith('request.created', 'u_payer', expect.anything());
  });

  it('forbids a non-payer from declining (IDOR guard)', async () => {
    const { service, prisma } = setup(pendingRequest);
    await expect(service.decline(stranger, 'req_1')).rejects.toThrow(ForbiddenException);
    expect(prisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it('forbids a non-requester from cancelling (IDOR guard)', async () => {
    const { service, prisma } = setup(pendingRequest);
    await expect(service.cancel(payer, 'req_1')).rejects.toThrow(ForbiddenException);
    expect(prisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it('forbids a non-payer from paying (IDOR guard)', async () => {
    const { service } = setup(pendingRequest);
    await expect(service.pay(stranger, 'req_1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects declining a request that is no longer pending', async () => {
    const { service } = setup({ ...pendingRequest, status: PaymentRequestStatus.PAID });
    await expect(service.decline(payer, 'req_1')).rejects.toThrow(BadRequestException);
  });

  it('resumes the same charge instead of minting a second one on a double-tap Pay', async () => {
    const linkedRequest = { ...pendingRequest, transactionId: 'txn_existing' };
    const inFlightTxn = {
      id: 'txn_existing',
      reference: 'tap_existing',
      authorizationUrl: 'https://checkout.paystack.com/existing',
      amount: 4200,
      currency: 'GHS',
      status: TxnStatus.PENDING,
    };
    const { service, sessions, payments } = setup(linkedRequest, inFlightTxn);
    const result = await service.pay(payer, 'req_1');
    // Returns the existing checkout, so the payer resumes the same charge.
    expect(result.transactionId).toBe('txn_existing');
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/existing');
    // Critically: no second session/transaction was created.
    expect(sessions.create).not.toHaveBeenCalled();
    expect(payments.payFromSession).not.toHaveBeenCalled();
  });

  it('starts a fresh charge when the linked transaction previously FAILED', async () => {
    const linkedRequest = { ...pendingRequest, transactionId: 'txn_failed' };
    const failedTxn = { id: 'txn_failed', status: TxnStatus.FAILED };
    const { service, sessions, payments } = setup(linkedRequest, failedTxn);
    sessions.create.mockResolvedValue({ id: 'sess_new' });
    payments.payFromSession.mockResolvedValue({
      transactionId: 'txn_new',
      reference: 'tap_new',
      authorizationUrl: 'https://checkout.paystack.com/new',
      amount: 4200,
      currency: 'GHS',
      status: TxnStatus.PENDING,
    });
    const result = await service.pay(payer, 'req_1');
    expect(result.transactionId).toBe('txn_new');
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(payments.payFromSession).toHaveBeenCalledTimes(1);
  });
});
