import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { permissionsForAdmin } from '../common/permissions';

@Injectable()
export class MobileService {
  constructor(private readonly db: PrismaService) {}

  private async refreshLevel(userId:number){
    const paidInstallments=await this.db.installment.count({where:{purchase:{userId},status:'PAID'}});
    const levels=await this.db.loyaltyLevel.findMany({orderBy:{sortOrder:'desc'}});
    const target=levels.find(l=>paidInstallments>=l.minOnTimeInstallments) || levels[levels.length-1];
    if(!target) return null;
    const current=await this.db.loyaltyProfile.findUnique({where:{userId}});
    if(current){
      await this.db.loyaltyProfile.update({where:{userId},data:{levelId:target.id,onTimeInstallments:paidInstallments}});
    } else {
      await this.db.loyaltyProfile.create({data:{userId,levelId:target.id,onTimeInstallments:paidInstallments}});
    }
    const principal=await this.db.creditLine.findFirst({where:{userId,code:'PRINCIPAL'}});
    if(principal){
      const levelLimit=target.principalLimitUsd==null?0:Number(target.principalLimitUsd);
      await this.db.creditLine.update({where:{id:principal.id},data:{
        maxInstallments:target.maxInstallments,
        initialPercent:target.initialPercent,
        limitUsd:Math.max(Number(principal.limitUsd),levelLimit),
      }});
    }
    return target;
  }

  async home(userId: number) {
    await this.refreshLevel(userId);
    const [lines, pending, campaign, banners, stores, loyalty, verification, unread, debt, overdueDebt] = await Promise.all([
      this.db.creditLine.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
      this.db.installment.findFirst({
        where: { purchase: { userId }, status: { in: ['PENDING', 'REPORTED', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
        include: { purchase: { select: { id: true, store: { select: { commercialName: true } } } } },
      }),
      this.db.campaign.findFirst({ where: { active: true, placement: 'home' }, orderBy: { id: 'desc' } }),
      this.db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, take: 8 }),
      this.db.store.findMany({ where: { active: true }, take: 8, orderBy: [{ rating: 'desc' }, { commercialName: 'asc' }] }),
      this.db.loyaltyProfile.findUnique({ where: { userId }, include: { level: true } }),
      this.db.verification.findFirst({ where: { userId, type: 'IDENTITY' }, orderBy: { createdAt: 'desc' } }),
      this.db.notification.count({ where: { userId, readAt: null } }),
      this.db.installment.aggregate({where:{purchase:{userId},status:{in:['PENDING','REPORTED','OVERDUE']}},_sum:{amountUsd:true},_count:true}),
      this.db.installment.aggregate({where:{purchase:{userId},status:'OVERDUE'},_sum:{amountUsd:true},_count:true}),
    ]);
    const currentLevel = loyalty?.level;
    const nextLevel = currentLevel ? await this.db.loyaltyLevel.findFirst({ where: { sortOrder: { gt: currentLevel.sortOrder } }, orderBy: { sortOrder: 'asc' } }) : null;
    const principal=lines.find(x=>x.code.toUpperCase()==='PRINCIPAL');
    return {
      level: loyalty && currentLevel ? {
        number: currentLevel.sortOrder,
        code: currentLevel.code,
        name: currentLevel.name,
        points: loyalty.points,
        paidUsd: Number(loyalty.paidUsd),
        onTimeInstallments: loyalty.onTimeInstallments,
        initialPercent:Number(currentLevel.initialPercent),
        maxInstallments:currentLevel.maxInstallments,
        principalLimitUsd:currentLevel.principalLimitUsd==null?null:Number(currentLevel.principalLimitUsd),
        benefits:currentLevel.benefits,
        next: nextLevel ? { code: nextLevel.code, name: nextLevel.name, number: nextLevel.sortOrder, minPaidUsd: Number(nextLevel.minPaidUsd), minOnTimeInstallments: nextLevel.minOnTimeInstallments } : null,
      } : { number: 1, code: 'K1', name: 'Santa Ana', points: 0, onTimeInstallments:0 },
      verification: {
        required: verification?.status !== 'APPROVED',
        status: verification?.status || 'PENDING',
        complete: Boolean(verification?.frontUrl && verification?.backUrl && verification?.selfieUrl),
      },
      unreadNotifications: unread,
      // COTIDIANA se conserva solo por compatibilidad histórica; la app compra exclusivamente con PRINCIPAL.
      lines: principal ? [{...principal,limitUsd:Number(principal.limitUsd),usedUsd:Number(principal.usedUsd),availableUsd:Math.max(0,Number(principal.limitUsd)-Number(principal.usedUsd)),initialPercent:Number(principal.initialPercent)}] : [],
      debt: {
        totalDebtUsd:Number(debt._sum.amountUsd||0),
        overdueDebtUsd:Number(overdueDebt._sum.amountUsd||0),
        pendingInstallments:debt._count,
        overdueInstallments:overdueDebt._count,
      },
      totalDebtUsd:Number(debt._sum.amountUsd||0),
      overdueDebtUsd:Number(overdueDebt._sum.amountUsd||0),
      nextPayment: pending ? { ...pending, amountUsd: Number(pending.amountUsd) } : null,
      campaign,
      banners,
      stores: stores.map(store => ({ ...store, rating: store.rating == null ? null : Number(store.rating) })),
      quickActions: [
        { code: 'BUY', label: 'Comprar', destination: 'fairs' },
        { code: 'PAY', label: 'Pagar', destination: 'requests' },
        { code: 'LEVELS', label: 'Niveles', destination: 'loyalty' },
        { code: 'MORE', label: 'Más', destination: 'modules' },
      ],
    };
  }

  async navigation(userId: number) {
    const [rows,user] = await Promise.all([
      this.db.userRole.findMany({
        where: { userId },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
      this.db.user.findUnique({where:{id:userId},select:{adminSubrole:true}}),
    ]);
    const roles = [...new Set(rows.map(row => row.role.code === 'STOREKEEPER' ? 'WAREHOUSE' : row.role.code))];
    const basePermissions=rows.filter(row=>row.role.code!=='ADMIN').flatMap(row=>row.role.permissions.map(p=>p.permission.code));
    const adminPermissions=roles.includes('ADMIN')?[...permissionsForAdmin(user?.adminSubrole)]:[];
    const permissions = [...new Set([...basePermissions,...adminPermissions])];
    const experiences = roles.map(role => ({
      role,
      bottom: role === 'BENEFICIARY'
        ? ['home', 'buy', 'qr', 'payments', 'profile']
        : role === 'ACCOUNTANT'
          ? ['home', 'budget', 'reconciliation', 'staff', 'profile']
          : role === 'WAREHOUSE'
            ? ['home', 'inventory', 'orders', 'notifications', 'profile']
            : ['home', 'pending', 'modules', 'notifications', 'profile'],
    }));
    return { roles, permissions, experiences, adminSubrole:user?.adminSubrole||null };
  }
}

@Controller('mobile')
export class MobileController {
  constructor(private readonly service: MobileService) {}
  @Get('home') home(@CurrentUser() u: any) { return this.service.home(u.sub); }
  @Get('navigation') navigation(@CurrentUser() u: any) { return this.service.navigation(u.sub); }
}

@Module({ controllers: [MobileController], providers: [MobileService] })
export class MobileModule {}
