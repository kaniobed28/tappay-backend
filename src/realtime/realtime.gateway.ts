import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

interface PaymentEventPayload {
  transactionId: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  sessionId?: string | null;
  description?: string | null;
}

/**
 * Real-time channel. Clients authenticate on connect with a Firebase/dev token
 * (`socket.handshake.auth.token`). Each socket joins a personal room and, if the user is a
 * merchant, their merchant room — so a settled payment pushes instantly to the merchant's
 * device instead of being polled.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string);
      if (!token) throw new Error('missing token');

      const identity = await this.firebase.verifyToken(token);
      const user = await this.users.upsertFromIdentity(identity);
      client.data.userId = user.id;
      client.join(`user:${user.id}`);

      const merchant = await this.prisma.merchant.findUnique({ where: { userId: user.id } });
      if (merchant) client.join(`merchant:${merchant.id}`);

      client.emit('connected', { userId: user.id, merchantId: merchant?.id ?? null });
    } catch (err) {
      this.logger.warn(`Rejected socket: ${(err as Error).message}`);
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  /** Push a payment event to the merchant's room and the payer's personal room. */
  emitPaymentEvent(
    event: 'payment.success' | 'payment.failed',
    target: { merchantId: string; payerId?: string | null },
    payload: PaymentEventPayload,
  ) {
    this.server.to(`merchant:${target.merchantId}`).emit(event, payload);
    if (target.payerId) this.server.to(`user:${target.payerId}`).emit(event, payload);
  }
}
