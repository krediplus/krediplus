import {
  BadRequestException, Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageModule, StorageService } from './storage.module';

function bool(v:any, fallback=false){ if(v===undefined||v===null)return fallback; return v===true||String(v).toLowerCase()==='true'||String(v)==='1'; }
function num(v:any, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function parsePairs(value:any){
  if(Array.isArray(value)) return value.map((x:any)=>({id:num(x.id??x.productId??x.comboId),quantity:Math.max(1,num(x.quantity,1))})).filter((x:any)=>x.id>0);
  return String(value||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const [a,b]=x.split(':');return {id:num(a),quantity:Math.max(1,num(b,1))}}).filter(x=>x.id>0);
}

@Controller()
class PublicCompatibilityController {
  constructor(private db:PrismaService){}

  @Get('exchange-rate/bcv')
  bcv(){
    const rate=num(process.env.BCV_RATE,0);
    return {rate,usdVes:rate,source:rate>0?'CONFIGURADO':'SIN_CONFIGURAR',updatedAt:new Date().toISOString()};
  }

  @Get('businesses')
  businesses(){return this.db.store.findMany({where:{active:true},include:{branches:true,bankAccounts:{where:{active:true}}},orderBy:{commercialName:'asc'}})}

  @Get('banners')
  banners(@Query('includeInactive')includeInactive?:string){return this.db.banner.findMany({where:bool(includeInactive)?{}:{active:true},orderBy:{sortOrder:'asc'}})}

  @Get('promotions')
  promotions(@Query('includeInactive')includeInactive?:string){return this.db.promotion.findMany({where:bool(includeInactive)?{}:{active:true},orderBy:{startsAt:'desc'}})}

  @Get('catalog-sales-destinations')
  async destinations(){return (await this.db.appSetting.findUnique({where:{key:'catalog_sales_destinations'}}))?.value||{productBusinessId:null,comboBusinessId:null}}

  @Put('catalog-sales-destinations')
  @Roles('ACCOUNTANT')
  async saveDestinations(@Body()b:any){
    const value={productBusinessId:b.productBusinessId?num(b.productBusinessId):null,comboBusinessId:b.comboBusinessId?num(b.comboBusinessId):null};
    await this.db.appSetting.upsert({where:{key:'catalog_sales_destinations'},create:{key:'catalog_sales_destinations',value},update:{value}});
    return value;
  }

  @Get('ratings/insights')
  async ratings(){
    const [count,avg,bySurvey]=await Promise.all([
      this.db.surveyResponse.count({where:{score:{not:null}}}),
      this.db.surveyResponse.aggregate({where:{score:{not:null}},_avg:{score:true}}),
      this.db.survey.findMany({include:{_count:{select:{responses:true}}},orderBy:{createdAt:'desc'}}),
    ]);
    return {responses:count,averageScore:avg._avg.score||0,surveys:bySurvey};
  }

  @Get('promotions/insights')
  async promotionInsights(){
    const [active,total]=await Promise.all([this.db.promotion.count({where:{active:true}}),this.db.promotion.count()]);
    return {active,total,generatedAt:new Date().toISOString(),note:'Métricas base del backend 2.0; ampliar con eventos de conversión cuando se conecte analítica.'};
  }
}

@Controller('me')
class MeCompatibilityController {
  constructor(private db:PrismaService,private storage:StorageService){}
  @Get('purchases') purchases(@CurrentUser()u:any){return this.db.purchase.findMany({where:{userId:u.sub},include:{store:true,items:true,installments:true,payments:true},orderBy:{createdAt:'desc'}})}
  @Get('credit') async credit(@CurrentUser()u:any){
    const primary=await this.db.creditLine.findFirst({where:{userId:u.sub,code:'PRINCIPAL'}});
    const [debt,overdue]=await Promise.all([
      this.db.installment.aggregate({where:{purchase:{userId:u.sub},status:{in:['PENDING','REPORTED','OVERDUE']}},_sum:{amountUsd:true},_count:true}),
      this.db.installment.aggregate({where:{purchase:{userId:u.sub},status:'OVERDUE'},_sum:{amountUsd:true},_count:true}),
    ]);
    const debtData={totalDebtUsd:Number(debt._sum.amountUsd||0),overdueDebtUsd:Number(overdue._sum.amountUsd||0),pendingInstallments:debt._count,overdueInstallments:overdue._count};
    if(!primary)return {availableUsd:0,limitUsd:0,usedUsd:0,status:'PENDING',lines:[],debt:debtData};
    const visible={...primary,limitUsd:Number(primary.limitUsd),usedUsd:Number(primary.usedUsd),availableUsd:Math.max(0,Number(primary.limitUsd)-Number(primary.usedUsd)),initialPercent:Number(primary.initialPercent)};
    return {...visible,lines:[visible],debt:debtData};
  }
  @Get('credit-requests') creditRequests(@CurrentUser()u:any){return this.db.creditRequest.findMany({where:{userId:u.sub},orderBy:{createdAt:'desc'}})}
  @Post('credit-requests') creditRequest(@CurrentUser()u:any,@Body()b:any){return this.db.creditRequest.create({data:{userId:u.sub,amountUsd:num(b.amountUsd),installments:Math.max(1,num(b.installments,1)),purpose:b.purpose||null}})}
  @Get('credimpulso-transactions') async creditTransactions(@CurrentUser()u:any){const lines=await this.db.creditLine.findMany({where:{userId:u.sub},select:{id:true}});return this.db.creditTransaction.findMany({where:{creditLineId:{in:lines.map(x=>x.id)}},orderBy:{createdAt:'desc'},take:200})}
  @Get('payment-reports') paymentReports(@CurrentUser()u:any){return this.db.payment.findMany({where:{userId:u.sub},include:{purchase:true},orderBy:{createdAt:'desc'}})}
  @Get('notifications') notifications(@CurrentUser()u:any){return this.db.notification.findMany({where:{userId:u.sub},orderBy:{createdAt:'desc'},take:100})}

  @Post('payment-reports/with-proof')
  @UseInterceptors(FileInterceptor('proof',{limits:{fileSize:8*1024*1024}}))
  async paymentWithProof(@CurrentUser()u:any,@UploadedFile()file:any,@Body()b:any){
    if(!file?.buffer)throw new BadRequestException('Comprobante requerido');
    const up=await this.storage.uploadBuffer(u.sub,'payment_proof',file.buffer,file.mimetype||'image/jpeg');
    const purchaseId=b.orderId?num(b.orderId):null;
    return this.db.payment.create({data:{
      userId:u.sub,purchaseId:purchaseId||null,method:String(b.method||'TRANSFER'),amountBs:b.amountBs!==undefined?num(b.amountBs):null,
      bankCode:b.originBankCode||null,phone:b.originPhone||null,reference:b.referenceNumber||null,proofUrl:up.publicUrl,
      notes:[b.notes,bool(b.paidFromDifferentPhone)?'Pago realizado desde un teléfono diferente':null].filter(Boolean).join(' · ')||null,status:'REPORTED',
    }});
  }
}

@Controller('purchases')
class PurchaseCompatibilityController {
  constructor(private db:PrismaService,private storage:StorageService){}

  private async createLegacy(userId:number,b:any,proofUrl?:string){
    const products=parsePairs(b.items), combos=parsePairs(b.comboItems);
    let subtotal=0, storeId:number|null=null;
    const rows:any[]=[];
    for(const x of products){
      const p=await this.db.product.findUnique({where:{id:x.id}}); if(!p)continue;
      const total=Number(p.priceUsd)*x.quantity; subtotal+=total; storeId=storeId||p.storeId||null;
      rows.push({productId:p.id,description:p.name,quantity:x.quantity,unitPriceUsd:Number(p.priceUsd),totalUsd:total});
    }
    for(const x of combos){
      const c=await this.db.combo.findUnique({where:{id:x.id}}); if(!c)continue;
      const total=Number(c.priceUsd)*x.quantity; subtotal+=total; storeId=storeId||c.storeId||null;
      rows.push({productId:null,description:`Combo: ${c.name}`,quantity:x.quantity,unitPriceUsd:Number(c.priceUsd),totalUsd:total});
    }
    const fairId=num(b.fairId)||null;
    if(fairId){const fair=await this.db.fair.findUnique({where:{id:fairId}}); storeId=storeId||fair?.storeId||null;}
    if(subtotal<=0)throw new BadRequestException('No hay productos válidos en la compra');
    const line=await this.db.creditLine.findFirst({where:{userId,code:'PRINCIPAL',status:'ACTIVE'}});
    const initial=line?+(subtotal*Number(line.initialPercent)/100).toFixed(2):subtotal;
    const financed=line?+(subtotal-initial).toFixed(2):0;
    const status=proofUrl?'PENDING':'PENDING_INITIAL_PAYMENT';
    const purchase=await this.db.purchase.create({data:{
      userId,storeId,creditLineId:line?.id||null,fairId,type:'LEGACY_FLUTTER',status,subtotalUsd:subtotal,initialPaymentUsd:initial,financedUsd:financed,totalUsd:subtotal,
      metadata:{paymentMethod:b.paymentMethod||null,paymentReference:b.paymentReference||null,proofUrl:proofUrl||null},items:{create:rows},
    },include:{items:true,store:true}});
    if(proofUrl){await this.db.payment.create({data:{userId,purchaseId:purchase.id,method:String(b.paymentMethod||'TRANSFER'),amountUsd:initial,bankCode:b.originBankCode||null,phone:b.originPhone||null,reference:b.paymentReference||null,proofUrl,status:'REPORTED'}})}
    return purchase;
  }

  @Post() create(@CurrentUser()u:any,@Body()b:any){return this.createLegacy(u.sub,b)}
  @Post('with-proof')
  @UseInterceptors(FileInterceptor('proof',{limits:{fileSize:8*1024*1024}}))
  async createWithProof(@CurrentUser()u:any,@UploadedFile()file:any,@Body()b:any){if(!file?.buffer)throw new BadRequestException('Comprobante requerido');const up=await this.storage.uploadBuffer(u.sub,'purchase_proof',file.buffer,file.mimetype||'image/jpeg');return this.createLegacy(u.sub,b,up.publicUrl)}
}

@Roles('ADMIN')
@Controller('admin')
class AdminCompatibilityController {
  constructor(private db:PrismaService,private audit:AuditService){}
  @Get('usuarios') usuarios(){return this.db.user.findMany({include:{roles:{include:{role:true}}},orderBy:{createdAt:'desc'},take:300})}
  @Get('usuarios/:id') usuario(@Param('id')id:string){return this.db.user.findUnique({where:{id:num(id)},include:{roles:{include:{role:true}},addresses:true,verifications:{orderBy:{createdAt:'desc'}}}})}
  @Get('usuarios/:id/expediente') dossier(@Param('id')id:string){return this.db.user.findUnique({where:{id:num(id)},include:{addresses:true,roles:{include:{role:true}},creditLines:{include:{transactions:{orderBy:{createdAt:'desc'}}}},purchases:{include:{store:true,items:true,installments:true,payments:true},orderBy:{createdAt:'desc'}},payments:{orderBy:{createdAt:'desc'}},verifications:{orderBy:{createdAt:'desc'}},notifications:{orderBy:{createdAt:'desc'}}}})}
  @Delete('usuarios/:id') async deleteUser(@CurrentUser()u:any,@Param('id')id:string){const x=await this.db.user.update({where:{id:num(id)},data:{status:'DELETED'}});await this.audit.write(u.sub,'USER_SOFT_DELETE','User',id,{status:'DELETED'},'Eliminación lógica desde administración');return x}
  @Get('purchases') purchases(){return this.db.purchase.findMany({include:{user:true,store:true,items:true,installments:true,payments:true},orderBy:{createdAt:'desc'},take:300})}
  @Get('credit-loans') loans(){return this.db.purchase.findMany({where:{financedUsd:{gt:0}},include:{user:true,store:true,installments:true,payments:true},orderBy:{createdAt:'desc'},take:300})}
  @Get('user-payment-reports') reports(){return this.db.payment.findMany({include:{user:true,purchase:true},orderBy:{createdAt:'desc'},take:300})}
  @Get('payment-reviews') paymentReviews(){return this.db.payment.findMany({where:{status:{in:['REPORTED','REVIEWING']}},include:{user:true,purchase:true},orderBy:{createdAt:'asc'}})}
  @Get('payment-verifications') paymentVerifications(){return this.db.payment.findMany({include:{user:true,purchase:true},orderBy:{createdAt:'desc'},take:300})}
  @Get('inventory-demand') demand(){return this.db.product.findMany({where:{active:true},orderBy:[{stock:'asc'},{name:'asc'}],take:200})}
  @Get('qr-records') qr(){return this.db.qrRecord.findMany({orderBy:{createdAt:'desc'},take:300})}
  @Get('community-requests') communities(){return this.db.communityRequest.findMany({orderBy:{createdAt:'asc'},take:300})}

  @Get('credimpulso-wallet') async wallet(){let a=await this.db.budgetAccount.findUnique({where:{code:'CREDIMPULSO_ADMIN'}});if(!a)a=await this.db.budgetAccount.create({data:{code:'CREDIMPULSO_ADMIN',name:'Cartera Crédito Kredi+'}});return a}
  @Get('credimpulso-transactions') async transactions(){const a=await this.db.budgetAccount.findUnique({where:{code:'CREDIMPULSO_ADMIN'}});if(!a)return [];return this.db.budgetMovement.findMany({where:{budgetAccountId:a.id},orderBy:{createdAt:'desc'},take:300})}

  @Post('users/:userId/verification') async userVerification(@CurrentUser()u:any,@Param('userId')userId:string,@Body()b:any){
    const uid=num(userId); let v=await this.db.verification.findFirst({where:{userId:uid,status:{in:['PENDING','REVIEWING']}},orderBy:{createdAt:'desc'}});
    if(!v)v=await this.db.verification.create({data:{userId:uid,type:'IDENTITY',status:'PENDING'}});
    const out=await this.db.verification.update({where:{id:v.id},data:{status:b.approved?'APPROVED':'REJECTED',notes:b.notes||null,reviewedBy:u.sub,reviewedAt:new Date()}});
    await this.audit.write(u.sub,'VERIFICATION_REVIEW','Verification',String(v.id),{status:out.status},b.notes); return out;
  }
  @Post('credit-requests/:id/decision') async creditDecision(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const out=await this.db.creditRequest.update({where:{id:num(id)},data:{status:b.approved?'APPROVED':'REJECTED',lenderStoreId:b.lenderBusinessId?num(b.lenderBusinessId):undefined,receiverStoreId:b.repaymentBusinessId?num(b.repaymentBusinessId):undefined,reviewedBy:u.sub,reviewNotes:b.notes||null}});await this.audit.write(u.sub,'CREDIT_REQUEST_DECISION','CreditRequest',id,{status:out.status},b.notes);return out}

  @Post('products') product(@Body()b:any){return this.db.product.create({data:{name:String(b.name),description:b.details||b.description||null,category:String(b.category||'General'),classification:b.classification||null,brand:b.brand||null,unit:b.unit||null,priceUsd:num(b.priceUsd),stock:Math.max(0,num(b.stock)),active:b.active!==false}})}
  @Put('products/:id/stock') stock(@Param('id')id:string,@Body()b:any){return this.db.product.update({where:{id:num(id)},data:{stock:Math.max(0,num(b.stock))}})}
  @Put('products/:id/pricing') pricing(@Param('id')id:string,@Body()b:any){return this.db.product.update({where:{id:num(id)},data:{priceUsd:num(b.priceUsd)}})}
  @Delete('products/:id') deleteProduct(@Param('id')id:string){return this.db.product.update({where:{id:num(id)},data:{active:false}})}
  @Get('combos') combos(){return this.db.combo.findMany({include:{items:{include:{product:true}}},orderBy:{createdAt:'desc'}})}
  @Post('combos') combo(@Body()b:any){return this.db.combo.create({data:{name:b.name,description:b.description||null,priceUsd:num(b.priceUsd),active:b.active!==false,storeId:b.storeId?num(b.storeId):null,imageUrl:b.imageUrl||null}})}
  @Delete('combos/:id') comboDelete(@Param('id')id:string){return this.db.combo.update({where:{id:num(id)},data:{active:false}})}
  @Delete('fairs/:id') fairDelete(@Param('id')id:string){return this.db.fair.delete({where:{id:num(id)}})}
  @Post('fairs/:id/publish') fairPublish(@Param('id')id:string,@Body()b:any){return this.db.fair.update({where:{id:num(id)},data:{published:bool(b.published,true)}})}
  @Post('fairs/:id/finalize') fairFinalize(@Param('id')id:string){return this.db.fair.update({where:{id:num(id)},data:{finalized:true}})}
  @Put('promotions/:id/status') promotionStatus(@Param('id')id:string,@Body()b:any){return this.db.promotion.update({where:{id:num(id)},data:{active:bool(b.active)}})}
}

@Roles('ACCOUNTANT')
@Controller('accountant')
class AccountantCompatibilityController {
  constructor(private db:PrismaService,private audit:AuditService){}
  @Get('wallet') async wallet(){let a=await this.db.budgetAccount.findUnique({where:{code:'CENTRAL'}});if(!a)a=await this.db.budgetAccount.create({data:{code:'CENTRAL',name:'Presupuesto central'}});const committed=await this.db.budgetAllocation.aggregate({_sum:{amountUsd:true}});return {...a,committedUsd:Number(committed._sum.amountUsd||0)}}
  @Get('beneficiaries') beneficiaries(){return this.db.user.findMany({where:{roles:{some:{role:{code:'BENEFICIARY'}}}},orderBy:{createdAt:'desc'},take:300})}
  @Get('credit-loans') loans(){return this.db.purchase.findMany({where:{financedUsd:{gt:0}},include:{user:true,store:true,installments:true,payments:true},orderBy:{createdAt:'desc'},take:300})}
  @Delete('staff/:id') async staffDelete(@CurrentUser()u:any,@Param('id')id:string){const out=await this.db.user.update({where:{id:num(id)},data:{status:'DELETED'}});await this.audit.write(u.sub,'STAFF_SOFT_DELETE','User',id,{status:'DELETED'});return out}
  @Delete('staff/:id/access') async removeAdmin(@CurrentUser()u:any,@Param('id')id:string){const role=await this.db.role.findUnique({where:{code:'ADMIN'}});if(role)await this.db.userRole.deleteMany({where:{userId:num(id),roleId:role.id}});await this.audit.write(u.sub,'REMOVE_ADMIN_ACCESS','User',id,{role:'ADMIN'});return {ok:true}}
  @Post('businesses/:id/status') businessStatus(@Param('id')id:string,@Body()b:any){return this.db.store.update({where:{id:num(id)},data:{active:bool(b.active)}})}
}

@Module({imports:[StorageModule],controllers:[PublicCompatibilityController,MeCompatibilityController,PurchaseCompatibilityController,AdminCompatibilityController,AccountantCompatibilityController]})
export class LegacyCompatModule {}
