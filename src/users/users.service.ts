import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerifiedIdentity } from '../auth/firebase-admin.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Find-or-create the local user mirror for a verified Firebase identity. */
  async upsertFromIdentity(identity: VerifiedIdentity): Promise<User> {
    const profile = {
      email: identity.email ?? undefined,
      phone: identity.phone ?? undefined,
      displayName: identity.name ?? undefined,
      photoUrl: identity.picture ?? undefined,
    };

    // Primary key for auth is firebaseUid.
    const byUid = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.uid },
    });
    if (byUid) {
      return this.prisma.user.update({ where: { id: byUid.id }, data: profile });
    }

    // No account for this uid yet. Email is globally unique, so if this email already
    // belongs to another identity (e.g. the user deleted and re-created their Firebase
    // account, or a dev-mode row pre-exists), re-link that record to the new uid instead
    // of crashing on the unique constraint. Firebase verifies the email, so this is a
    // safe account-linking step, not a takeover vector.
    if (identity.email) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: { equals: identity.email, mode: 'insensitive' } },
      });
      if (byEmail) {
        return this.prisma.user.update({
          where: { id: byEmail.id },
          data: { firebaseUid: identity.uid, ...profile },
        });
      }
    }

    return this.prisma.user.create({
      data: {
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

  /** Resolve a user by their email (case-insensitive) or phone. Returns null if none. */
  async findByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim();
    if (!value) return null;
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: { equals: value, mode: 'insensitive' } }, { phone: value }],
      },
    });
  }

  async registerDevice(userId: string, deviceId: string, platform?: string, pushToken?: string) {
    return this.prisma.device.upsert({
      where: { deviceId },
      update: { platform, pushToken, lastSeenAt: new Date(), userId },
      create: { deviceId, platform, pushToken, userId },
    });
  }
}
