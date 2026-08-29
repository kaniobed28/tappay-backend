/** Shapes returned by the MTN MoMo Collection API (only the fields TapPay relies on). */

export interface MomoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

export type MomoTransactionStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface MomoRequestToPayStatus {
  amount: string; // major units, e.g. "25.00"
  currency: string;
  financialTransactionId?: string;
  externalId: string; // our own reference
  payer: { partyIdType: 'MSISDN'; partyId: string };
  status: MomoTransactionStatus;
  reason?: string | { code?: string; message?: string };
}
