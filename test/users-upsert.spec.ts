import { BadRequestException, ConflictException } from '@nestjs/common';
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

/**
 * Mobile money charges a phone, not a card, so a payer with no number on file must be
 * able to add one — and never by quietly taking a number that belongs to someone else.
 */
describe('UsersService.updateProfile phone', () => {
  const setup = (update: jest.Mock) =>
    new UsersService({ user: { update } } as any);

  it('stores hand-typed Ghanaian numbers in E.164', async () => {
    const update = jest.fn().mockImplementation(({ data }) => data);
    for (const [typed, stored] of [
      ['024 123 4567', '+233241234567'],
      ['0241234567', '+233241234567'],
      ['+233241234567', '+233241234567'],
      ['233241234567', '+233241234567'],
    ]) {
      await expect(setup(update).updateProfile('u_1', { phone: typed })).resolves.toMatchObject({
        phone: stored,
      });
    }
  });

  it('rejects numbers it cannot dial', async () => {
    const update = jest.fn();
    await expect(setup(update).updateProfile('u_1', { phone: '12345' })).rejects.toThrow(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('reports a number already linked to another account instead of failing opaquely', async () => {
    const update = jest.fn().mockRejectedValue({ code: 'P2002' });
    await expect(
      setup(update).updateProfile('u_1', { phone: '0241234567' }),
    ).rejects.toThrow(ConflictException);
  });

  it('leaves the phone untouched when the update does not mention it', async () => {
    const update = jest.fn().mockImplementation(({ data }) => data);
    const result = await setup(update).updateProfile('u_1', { displayName: 'Ama' });
    expect(result).toMatchObject({ displayName: 'Ama', phone: undefined });
  });
});
