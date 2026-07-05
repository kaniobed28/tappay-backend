import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../src/payments/payments.service';
import { TxnStatus } from '@prisma/client';

/**
 * Guards the most dangerous failure mode: the provider reports "success" but for a
 * DIFFERENT amount than we asked for. That must be treated as FAILED, never SUCCESS.
 */
function setup(overrides: { verifyResult: any; txn: any }) {
  const updateMock = jest.fn().mockImplementation(({ data }) => ({ ...overrides.txn, ...data }));
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(overrides.txn),
      update: updateMock,
    },
  };
  const provider = {
    name: 'paystack',
    verifyPayment: jest.fn().mockResolvedValue(overrides.verifyResult),
  };
  const realtime = { emitPaymentEvent: jest.fn() };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  const service = new PaymentsService(
    prisma as any,
    {} as any,
    provider as any,
    realtime as any,
    notifications as any,
    audit as any,
    config,
  );
  return { service, updateMock, realtime, notifications };
}

const baseTxn = {
  id: 'txn_1',
  reference: 'tap_1',
  status: TxnStatus.PENDING,
  amount: 3500,
  currency: 'GHS',
  merchantId: 'm1',
  payeeId: 'u_merchant',
  payerId: 'u_payer',
  sessionId: 's1',
  description: 'Latte',
};

describe('PaymentsService.reconcile amount guard', () => {
  it('marks FAILED when the provider succeeds for a smaller amount', async () => {
    const { service, updateMock, realtime } = setup({
      txn: baseTxn,
      verifyResult: { status: 'success', amount: 100, currency: 'GHS', reference: 'tap_1', raw: {} },
    });
    const result = await service.reconcile('tap_1');
    expect(result.status).toBe(TxnStatus.FAILED);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: TxnStatus.FAILED }) }),
    );
    // A mismatched charge must not emit a success event.
    expect(realtime.emitPaymentEvent).not.toHaveBeenCalledWith('payment.success', expect.anything(), expect.anything());
  });

  it('marks FAILED when the currency differs', async () => {
    const { service } = setup({
      txn: baseTxn,
      verifyResult: { status: 'success', amount: 3500, currency: 'NGN', reference: 'tap_1', raw: {} },
    });
    const result = await service.reconcile('tap_1');
    expect(result.status).toBe(TxnStatus.FAILED);
  });

  it('marks SUCCESS and emits realtime + notifications on an exact match', async () => {
    const { service, realtime, notifications } = setup({
      txn: baseTxn,
      verifyResult: { status: 'success', amount: 3500, currency: 'GHS', reference: 'tap_1', raw: {} },
    });
    const result = await service.reconcile('tap_1');
    expect(result.status).toBe(TxnStatus.SUCCESS);
    expect(realtime.emitPaymentEvent).toHaveBeenCalledWith(
      'payment.success',
      expect.objectContaining({ merchantId: 'm1', payerId: 'u_payer' }),
      expect.objectContaining({ transactionId: 'txn_1' }),
    );
    // Merchant + payer both notified.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('is idempotent: an already-SUCCESS txn is returned untouched', async () => {
    const { service, updateMock } = setup({
      txn: { ...baseTxn, status: TxnStatus.SUCCESS },
      verifyResult: { status: 'success', amount: 3500, currency: 'GHS', reference: 'tap_1', raw: {} },
    });
    const result = await service.reconcile('tap_1');
    expect(result.status).toBe(TxnStatus.SUCCESS);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
