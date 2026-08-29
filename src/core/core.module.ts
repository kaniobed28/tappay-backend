import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';

/**
 * Cross-cutting infrastructure every feature module may rely on: database access and
 * the audit trail. Global, so feature modules declare only their *feature* dependencies
 * and never re-import plumbing.
 *
 * Feature logic never belongs here — if it knows about payments, merchants or sessions,
 * it belongs in that feature module instead.
 */
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  exports: [PrismaModule, AuditModule],
})
export class CoreModule {}
