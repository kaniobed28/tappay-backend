import { UsersService } from '../src/users/users.service';

/**
 * upsertFromIdentity keys on firebaseUid, but email is globally unique. A user who
 * re-creates their Firebase account (new uid, same email) — or a dev-mode row that
 * pre-dates a real login — must NOT hit a unique-constraint 500. Instead the existing
 * record is re-linked to the new identity.
 */
function setup(opts: { byUid?: any; byEmail?: any } = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.byUid ?? null),
      findFirst: jest.fn().mockResolvedValue(opts.byEmail ?? null),
      update: jest.fn().mockImplementation(({ where, data }) => ({ id: where.id, ...data })),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'new_user', ...data })),
    },
  };
  const service = new UsersService(prisma as any);
  return { service, prisma };
}

describe('UsersService.upsertFromIdentity', () => {
  it('updates the existing record when the firebaseUid already exists', async () => {
    const { service, prisma } = setup({ byUid: { id: 'u1', firebaseUid: 'uid1' } });
    await service.upsertFromIdentity({ uid: 'uid1', email: 'a@b.com' } as any);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('re-links an existing email to the new uid instead of crashing on the unique constraint', async () => {
    // No user for this uid, but the email already belongs to a different identity.
    const { service, prisma } = setup({
      byUid: null,
      byEmail: { id: 'u_old', firebaseUid: 'old_uid', email: 'a@b.com' },
    });
    const result = await service.upsertFromIdentity({ uid: 'new_uid', email: 'a@b.com' } as any);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u_old' },
        data: expect.objectContaining({ firebaseUid: 'new_uid' }),
      }),
    );
    expect(result.firebaseUid).toBe('new_uid');
  });

  it('creates a new record when neither the uid nor the email exists', async () => {
    const { service, prisma } = setup({ byUid: null, byEmail: null });
    await service.upsertFromIdentity({ uid: 'brand_new', email: 'fresh@b.com' } as any);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firebaseUid: 'brand_new' }) }),
    );
  });

  it('does not attempt an email re-link when the identity has no email', async () => {
    const { service, prisma } = setup({ byUid: null, byEmail: null });
    await service.upsertFromIdentity({ uid: 'phone_only' } as any);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalled();
  });
});
