import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../src/payments/payments.service';
import { TxnStatus } from '@prisma/client';

function setup(txn: any) {
  const updateMock = jest.fn().mockImplementation(({ data }) => ({ ...txn, ...data }));
  const prisma = {
    transaction: {
      findUnique: jest.fn().mockResolvedValue(txn),
      update: updateMock,
    },
  };
  const provider = {
    name: 'paystack',
    refundPayment: jest.fn().mockResolvedValue({ status: 'pending', raw: {} }),
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
  return { service, provider, updateMock, realtime, notifications };
}

const successfulTxn = {
  id: 'txn_1',
  reference: 'tap_1',
  status: TxnStatus.SUCCESS,
  amount: 3500,
  currency: 'GHS',
  merchantId: 'm1',
  payeeId: 'u_merchant',
  payerId: 'u_payer',
  sessionId: 's1',
  description: 'Latte',
};

const merchant = { id: 'u_merchant' } as any;
const stranger = { id: 'u_other' } as any;

describe('PaymentsService.refund', () => {
  it('refunds a successful payment when the caller is the payee', async () => {
    const { service, provider, realtime, notifications } = setup(successfulTxn);
    const result = await service.refund(merchant, 'txn_1');
    expect(provider.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'tap_1' }),
    );
    expect(result.status).toBe(TxnStatus.REFUNDED);
    expect(realtime.emitPaymentEvent).toHaveBeenCalledWith('payment.refunded', expect.anything(), expect.anything());
    expect(notifications.notify).toHaveBeenCalledTimes(2); // payer + merchant
  });

  it('forbids refund by anyone who is not the payee (IDOR guard)', async () => {
    const { service, provider } = setup(successfulTxn);
    await expect(service.refund(stranger, 'txn_1')).rejects.toThrow(ForbiddenException);
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('rejects refunding a non-successful payment', async () => {
    const { service, provider } = setup({ ...successfulTxn, status: TxnStatus.PENDING });
    await expect(service.refund(merchant, 'txn_1')).rejects.toThrow(BadRequestException);
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('rejects a partial amount greater than the original', async () => {
    const { service, provider } = setup(successfulTxn);
    await expect(service.refund(merchant, 'txn_1', { amount: 9999 })).rejects.toThrow(BadRequestException);
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-refunded txn returns without re-calling the provider', async () => {
    const { service, provider } = setup({ ...successfulTxn, status: TxnStatus.REFUNDED });
    const result = await service.refund(merchant, 'txn_1');
    expect(result.status).toBe(TxnStatus.REFUNDED);
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });
});
