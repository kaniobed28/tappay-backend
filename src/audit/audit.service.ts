import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append-only audit trail. Logging must never break the business action, so writes are
 * fire-and-forget with errors swallowed (and logged).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(entry: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          actorId: entry.actorId ?? undefined,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          ip: entry.ip ?? undefined,
          meta: entry.meta as object,
        },
      })
      .catch((err) => this.logger.warn(`Audit write failed: ${(err as Error).message}`));
  }

  list(take = 100) {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  }
}
