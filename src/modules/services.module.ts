import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly db: PrismaService) {}

  @Get('providers')
  providers(@Query('type') type?: string) {
    return this.db.serviceProvider.findMany({ where: { active: true, ...(type ? { type } : {}) }, orderBy: { name: 'asc' } });
  }

  @Get('accounts')
  accounts(@CurrentUser() u: any) {
    return this.db.serviceAccount.findMany({ where: { userId: u.sub }, include: { provider: true }, orderBy: { updatedAt: 'desc' } });
  }

  @Post('accounts')
  account(@CurrentUser() u: any, @Body() b: any) {
    return this.db.serviceAccount.create({ data: { userId: u.sub, providerId: b.providerId ? Number(b.providerId) : null, providerName: b.providerName || null, identifier: String(b.identifier || '').trim(), alias: b.alias || null } });
  }

  @Patch('accounts/:id')
  update(@CurrentUser() u: any, @Param('id') id: string, @Body() b: any) {
    return this.db.serviceAccount.update({ where: { id: Number(id), userId: u.sub }, data: { alias: b.alias, identifier: b.identifier } });
  }

  @Post('quote')
  async quote(@CurrentUser() u: any, @Body() b: any) {
    const provider = await this.db.serviceProvider.findFirst({ where: { id: Number(b.providerId), active: true } });
    if (!provider) throw new BadRequestException('Proveedor no disponible');
    const amountUsd = Math.max(0, Number(b.amountUsd || 0));
    return { provider, identifier: String(b.identifier || ''), amountUsd, currency: 'USD', userId: u.sub, quoteId: `SQ-${Date.now()}-${u.sub}`, expiresInSeconds: 300 };
  }

  @Post('pay')
  async pay(@CurrentUser() u: any, @Body() b: any) {
    const verification = await this.db.verification.findFirst({ where: { userId: u.sub, type: 'IDENTITY' }, orderBy: { createdAt: 'desc' } });
    if (verification?.status !== 'APPROVED') throw new BadRequestException('Completa la verificación de identidad para realizar este pago.');
    return this.db.servicePayment.create({ data: { userId: u.sub, providerId: b.providerId ? Number(b.providerId) : null, identifier: String(b.identifier || ''), amountUsd: Number(b.amountUsd || 0), status: 'PENDING' } });
  }
}

@Module({ controllers: [ServicesController] })
export class ServicesModule {}
