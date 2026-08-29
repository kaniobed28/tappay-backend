import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { Merchant, TxnStatus } from '@prisma/client';

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create the merchant profile for a user, or update it if it already exists. */
  async register(
    userId: string,
    data: { businessName: string; category?: string; currency?: string },
  ): Promise<Merchant> {
    return this.prisma.merchant.upsert({
      where: { userId },
      update: { businessName: data.businessName, category: data.category, currency: data.currency },
      create: {
        userId,
        businessName: data.businessName,
        category: data.category,
        currency: data.currency ?? 'GHS',
      },
    });
  }

  async getMine(userId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!merchant) throw new NotFoundException('No merchant profile for this user');
    return merchant;
  }

  /** Resolve the caller's active merchant, guaranteeing ownership. */
  async requireActiveMerchant(userId: string): Promise<Merchant> {
    const merchant = await this.getMine(userId);
    if (!merchant.active) throw new ForbiddenException('Merchant account is inactive');
    return merchant;
  }

  /**
   * Guarantee a user can receive money by provisioning a personal merchant profile on
   * demand. Used by the request-money flow: the requester (payee) may not have set up a
   * business yet, but accepting a payment still needs a merchant to settle against.
   */
  async ensurePersonalMerchant(userId: string): Promise<Merchant> {
    const existing = await this.prisma.merchant.findUnique({ where: { userId } });
    if (existing) {
      if (!existing.active) throw new ForbiddenException('Recipient account is inactive');
      return existing;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const businessName = user?.displayName?.trim() || 'TapPay user';
    return this.prisma.merchant.create({ data: { userId, businessName } });
  }

  async publicView(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return { id: merchant.id, businessName: merchant.businessName, currency: merchant.currency };
  }

  /** Sales analytics for the calling merchant (successful transactions only). */
  async analytics(userId: string) {
    const merchant = await this.getMine(userId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const sumSince = async (from?: Date) => {
      const res = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: {
          merchantId: merchant.id,
          status: TxnStatus.SUCCESS,
          ...(from ? { createdAt: { gte: from } } : {}),
        },
      });
      return { total: res._sum.amount ?? 0, count: res._count._all };
    };

    const [today, week, month, all] = await Promise.all([
      sumSince(startOfToday),
      sumSince(weekAgo),
      sumSince(monthAgo),
      sumSince(),
    ]);

    return {
      currency: merchant.currency,
      today: today.total,
      week: week.total,
      month: month.total,
      count: all.count,
      totalVolume: all.total,
      avgPayment: all.count > 0 ? Math.round(all.total / all.count) : 0,
    };
  }
}
