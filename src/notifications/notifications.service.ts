import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

interface NotifyInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  /** Persist an in-app notification and best-effort push it via FCM to the user's devices. */
  async notify(userId: string, input: NotifyInput) {
    await this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      },
    });
    await this.push(userId, input);
  }

  async list(userId: string, take = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    return { ok: true };
  }

  private async push(userId: string, input: NotifyInput) {
    const messaging = this.firebase.getMessaging();
    if (!messaging) return; // dev mode / Firebase not configured

    const devices = await this.prisma.device.findMany({
      where: { userId, blocked: false, pushToken: { not: null } },
    });
    const tokens = devices.map((d) => d.pushToken!).filter(Boolean);
    if (tokens.length === 0) return;

    try {
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: input.title, body: input.body },
        data: input.data,
      });
      // Prune tokens FCM reports as unregistered so we stop sending to dead devices.
      const stale: string[] = [];
      res.responses.forEach((r, i) => {
        if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
          stale.push(tokens[i]);
        }
      });
      if (stale.length) {
        await this.prisma.device.updateMany({
          where: { pushToken: { in: stale } },
          data: { pushToken: null },
        });
      }
    } catch (err) {
      this.logger.warn(`FCM push failed: ${(err as Error).message}`);
    }
  }
}
