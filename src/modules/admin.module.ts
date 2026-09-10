import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { Permissions, permissionsForAdmin } from '../common/permissions';

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  @Get('work-queue')
  async queue(@CurrentUser() u:any) {
    const user=await this.db.user.findUnique({where:{id:u.sub},select:{adminSubrole:true}});
    const perms=permissionsForAdmin(user?.adminSubrole); const full=perms.has('FULL_ADMIN');
    const [verifications, payments, credits, community] = await Promise.all([
      (full||perms.has('REVIEW_USERS'))?this.db.verification.findMany({ where: { status: { in: ['PENDING','REVIEWING'] } }, take: 100, orderBy: { createdAt: 'asc' }, include: { user: true } }):Promise.resolve([]),
      (full||perms.has('REVIEW_PAYMENTS'))?this.db.payment.findMany({ where: { status: { in: ['REPORTED','REVIEWING'] } }, take: 100, orderBy: { createdAt: 'asc' }, include: { user: true, purchase: true } }):Promise.resolve([]),
      (full||perms.has('REVIEW_CREDITS'))?this.db.creditRequest.findMany({ where: { status: { in: ['PENDING','REVIEWING'] } }, take: 100, orderBy: { createdAt: 'asc' } }):Promise.resolve([]),
      (full||perms.has('REVIEW_USERS'))?this.db.communityRequest.findMany({ where: { status: 'PENDING' }, take: 100, orderBy: { createdAt: 'asc' } }):Promise.resolve([]),
    ]);
    return { counts: { verifications: verifications.length, payments: payments.length, credits: credits.length, community: community.length, total: verifications.length + payments.length + credits.length + community.length }, verifications, payments, credits, community };
  }

  @Permissions('VIEW_USERS')
  @Get('users')
  users(@Query('q') q?: string) {
    return this.db.user.findMany({
      where: q ? { OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { nationalId: { contains: q, mode: 'insensitive' } },
      ] } : {},
      include: { roles: { include: { role: true } }, verifications: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
  }

  @Permissions('VIEW_USERS')
  @Get('users/:id/dossier')
  dossier(@Param('id') id: string) {
    return this.db.user.findUnique({
      where: { id: Number(id) },
      include: {
        addresses: true,
        roles: { include: { role: true } },
        creditLines: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 100 } } },
        purchases: { include: { store: true, items: true, installments: true }, orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' } },
        verifications: { orderBy: { createdAt: 'desc' } },
        notifications: { orderBy: { createdAt: 'desc' }, take: 50 },
        loyalty: { include: { level: true } },
      },
    });
  }

  @Permissions('REVIEW_USERS')
  @Get('verifications')
  verifications() { return this.db.verification.findMany({ include: { user: true }, orderBy: { createdAt: 'asc' } }); }

  @Permissions('REVIEW_USERS')
  @Post('verifications/:id/review')
  async reviewVerification(@CurrentUser() u: any, @Param('id') id: string, @Body() b: any) {
    const verification = await this.db.verification.update({ where: { id: Number(id) }, data: { status: b.approved ? 'APPROVED' : 'REJECTED', notes: b.notes || null, reviewedBy: u.sub, reviewedAt: new Date() } });
    if (b.approved) {
      await this.db.user.update({ where: { id: verification.userId }, data: { status: 'ACTIVE' } });
      await this.db.creditLine.updateMany({ where: { userId: verification.userId, status: 'PENDING' }, data: { status: 'ACTIVE' } });
    }
    await this.db.notification.create({ data: {
      userId: verification.userId,
      type: b.approved ? 'IDENTITY_APPROVED' : 'IDENTITY_REJECTED',
      title: b.approved ? 'Identidad verificada' : 'Debes repetir tu verificación',
      body: b.approved ? 'Tu identidad fue aprobada. Ya puedes usar todas las funciones habilitadas de Kredi+.' : String(b.notes || 'Revisa las fotos de tu cédula y selfie y vuelve a enviarlas.'),
      data: { destination: 'identityVerification' },
    }});
    await this.audit.write(u.sub, 'VERIFICATION_REVIEW', 'Verification', id, { status: verification.status }, b.notes);
    return verification;
  }

  @Permissions('REVIEW_CREDITS')
  @Get('credit-requests') credits() { return this.db.creditRequest.findMany({ orderBy: { createdAt: 'asc' } }); }
  @Permissions('REVIEW_CREDITS')
  @Post('credit-requests/:id/review') async creditReview(@CurrentUser() u:any,@Param('id')id:string,@Body()b:any){const x=await this.db.creditRequest.update({where:{id:Number(id)},data:{status:b.approved?'APPROVED':'REJECTED',lenderStoreId:b.lenderStoreId?Number(b.lenderStoreId):undefined,receiverStoreId:b.receiverStoreId?Number(b.receiverStoreId):undefined,reviewedBy:u.sub,reviewNotes:b.notes||null}});await this.audit.write(u.sub,'CREDIT_REQUEST_REVIEW','CreditRequest',id,{status:x.status},b.notes);return x;}
  @Permissions('VIEW_PAYMENTS')
  @Get('payment-reports') payments(){return this.db.payment.findMany({where:{status:{in:['REPORTED','REVIEWING']}},include:{user:true,purchase:true},orderBy:{createdAt:'asc'}})}
  @Permissions('REVIEW_PAYMENTS')
  @Post('payment-reports/:id/review') async paymentReview(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const p=await this.db.payment.update({where:{id:Number(id)},data:{status:b.approved?'APPROVED':'REJECTED',notes:b.notes||null,reviewedBy:u.sub,reviewedAt:new Date()}});await this.audit.write(u.sub,'PAYMENT_REVIEW','Payment',id,{status:p.status},b.notes);return p;}
  @Permissions('VIEW_INVENTORY')
  @Get('inventory') inventory(){return this.db.product.findMany({orderBy:[{stock:'asc'},{name:'asc'}]})}
  @Permissions('MANAGE_CATALOG')
  @Patch('products/:id') product(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){return this.db.product.update({where:{id:Number(id)},data:b})}
  @Permissions('VIEW_ORDERS')
  @Get('fairs') fairs(){return this.db.fair.findMany({orderBy:{startsAt:'desc'}})}
  @Permissions('MANAGE_CATALOG')
  @Post('fairs') fairCreate(@Body()b:any){return this.db.fair.create({data:{name:b.name,description:b.description||null,startsAt:new Date(b.startsAt),endsAt:b.endsAt?new Date(b.endsAt):null,address:b.address||null,stateId:b.stateId||null,municipalityId:b.municipalityId||null,parishId:b.parishId||null,storeId:b.storeId||null,paymentConfig:b.paymentConfig||null,published:!!b.published}})}
  @Permissions('MANAGE_CATALOG')
  @Get('banners') banners(){return this.db.banner.findMany({orderBy:{sortOrder:'asc'}})}
  @Permissions('MANAGE_CATALOG')
  @Post('banners') banner(@Body()b:any){return this.db.banner.create({data:b})}
  @Permissions('MANAGE_CATALOG')
  @Get('promotions') promotions(){return this.db.promotion.findMany({orderBy:{startsAt:'desc'}})}
  @Permissions('MANAGE_CATALOG')
  @Post('promotions') promotion(@Body()b:any){return this.db.promotion.create({data:{...b,startsAt:new Date(b.startsAt),endsAt:new Date(b.endsAt)}})}
  @Permissions('VIEW_USERS')
  @Get('communities') communities(){return this.db.community.findMany({include:{parish:{include:{municipality:{include:{state:true}}}}},orderBy:{name:'asc'}})}
  @Permissions('MANAGE_CATALOG')
  @Post('communities') community(@Body()b:any){return this.db.community.create({data:{parishId:Number(b.parishId),name:b.name,active:b.active!==false}})}
  @Permissions('VIEW_USERS')
  @Get('community-requests') communityRequests(){return this.db.communityRequest.findMany({orderBy:{createdAt:'desc'},take:200})}
  @Permissions('VIEW_ORDERS')
  @Get('purchases') purchases(){return this.db.purchase.findMany({include:{user:true,store:true,items:true,installments:true,payments:true},orderBy:{createdAt:'desc'},take:300})}
  @Permissions('VIEW_AUDIT')
  @Get('reports/summary') async reports(){const [users,purchases,payments,credits,verifications]=await Promise.all([this.db.user.count(),this.db.purchase.count(),this.db.payment.count(),this.db.creditRequest.count(),this.db.verification.count()]);return{users,purchases,payments,creditRequests:credits,verifications}}
}
@Module({controllers:[AdminController]}) export class AdminModule {}
