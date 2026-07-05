import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerifiedIdentity } from '../auth/firebase-admin.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Find-or-create the local user mirror for a verified Firebase identity. */
  async upsertFromIdentity(identity: VerifiedIdentity): Promise<User> {
    return this.prisma.user.upsert({
      where: { firebaseUid: identity.uid },
      update: {
        email: identity.email ?? undefined,
        phone: identity.phone ?? undefined,
        displayName: identity.name ?? undefined,
        photoUrl: identity.picture ?? undefined,
      },
      create: {
        firebaseUid: identity.uid,
        email: identity.email,
        phone: identity.phone,
        displayName: identity.name,
        photoUrl: identity.picture,
      },
    });
  }

  async updateProfile(userId: string, data: { displayName?: string; photoUrl?: string }) {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async registerDevice(userId: string, deviceId: string, platform?: string, pushToken?: string) {
    return this.prisma.device.upsert({
      where: { deviceId },
      update: { platform, pushToken, lastSeenAt: new Date(), userId },
      create: { deviceId, platform, pushToken, userId },
    });
  }
}
