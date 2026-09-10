import { BadRequestException, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly db: PrismaService) {}

  @Get('profile')
  async profile(@CurrentUser() u: any) {
    const profile = await this.db.loyaltyProfile.findUnique({ where: { userId: u.sub }, include: { level: true } });
    if (!profile) return null;
    const next = await this.db.loyaltyLevel.findFirst({ where: { sortOrder: { gt: profile.level.sortOrder } }, orderBy: { sortOrder: 'asc' } });
    return { ...profile, paidUsd: Number(profile.paidUsd), level: { ...profile.level, minPaidUsd: Number(profile.level.minPaidUsd), principalLimitUsd: profile.level.principalLimitUsd == null ? null : Number(profile.level.principalLimitUsd), everydayLimitUsd: profile.level.everydayLimitUsd == null ? null : Number(profile.level.everydayLimitUsd), initialPercent: Number(profile.level.initialPercent) }, nextLevel: next ? { ...next, minPaidUsd: Number(next.minPaidUsd), principalLimitUsd: next.principalLimitUsd == null ? null : Number(next.principalLimitUsd), everydayLimitUsd: next.everydayLimitUsd == null ? null : Number(next.everydayLimitUsd), initialPercent: Number(next.initialPercent) } : null };
  }

  @Get('levels')
  async levels() {
    const rows = await this.db.loyaltyLevel.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(row => ({ ...row, minPaidUsd: Number(row.minPaidUsd), principalLimitUsd: row.principalLimitUsd == null ? null : Number(row.principalLimitUsd), everydayLimitUsd: row.everydayLimitUsd == null ? null : Number(row.everydayLimitUsd), initialPercent: Number(row.initialPercent) }));
  }

  @Get('rewards') rewards() { return this.db.reward.findMany({ where: { status: 'ACTIVE' }, orderBy: { pointsCost: 'asc' } }); }
  @Get('rewards/mine') mine(@CurrentUser() u: any) { return this.db.rewardRedemption.findMany({ where: { userId: u.sub }, include: { reward: true }, orderBy: { createdAt: 'desc' } }); }
  @Get('points/history') history(@CurrentUser() u: any) { return this.db.pointsLedger.findMany({ where: { userId: u.sub }, orderBy: { createdAt: 'desc' }, take: 100 }); }

  @Post('rewards/:id/redeem')
  async redeem(@CurrentUser() u: any, @Param('id') id: string) {
    const [profile, reward] = await Promise.all([
      this.db.loyaltyProfile.findUnique({ where: { userId: u.sub } }),
      this.db.reward.findUnique({ where: { id: Number(id) } }),
    ]);
    if (!profile || !reward || reward.status !== 'ACTIVE' || profile.points < reward.pointsCost) throw new BadRequestException('Recompensa no disponible');
    return this.db.$transaction(async tx => {
      const updated = await tx.loyaltyProfile.update({ where: { userId: u.sub }, data: { points: { decrement: reward.pointsCost } } });
      await tx.pointsLedger.create({ data: { userId: u.sub, delta: -reward.pointsCost, reason: 'REWARD_REDEEM', referenceType: 'Reward', referenceId: String(reward.id), balanceAfter: updated.points } });
      return tx.rewardRedemption.create({ data: { rewardId: reward.id, userId: u.sub, pointsCost: reward.pointsCost, code: `KR-${Date.now()}-${u.sub}` } });
    });
  }
}

@Module({ controllers: [LoyaltyController] })
export class LoyaltyModule {}
