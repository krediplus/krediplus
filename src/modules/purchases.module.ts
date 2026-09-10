import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PurchaseService {
  constructor(private readonly db: PrismaService) {}

  async quote(userId:number,b:any){
    const line=await this.db.creditLine.findFirst({where:{id:Number(b.creditLineId),userId,code:'PRINCIPAL',status:'ACTIVE'}});
    if(!line)throw new BadRequestException('La compra solo puede utilizar tu línea Principal activa');
    let subtotal=0;const items:any[]=[];
    for(const x of b.items||[]){const p=await this.db.product.findUnique({where:{id:Number(x.productId)}});if(!p||!p.active)throw new BadRequestException('Producto no disponible');const quantity=Math.max(1,Number(x.quantity||1));const total=Number(p.priceUsd)*quantity;subtotal+=total;items.push({productId:p.id,description:p.name,quantity,unitPriceUsd:Number(p.priceUsd),totalUsd:total})}
    const n=Math.min(Math.max(Number(b.installments||line.minInstallments),line.minInstallments),line.maxInstallments);
    const initial=subtotal*Number(line.initialPercent)/100;const financed=subtotal-initial;const installment=n>0?financed/n:0;
    return{subtotalUsd:+subtotal.toFixed(2),initialPaymentUsd:+initial.toFixed(2),financedUsd:+financed.toFixed(2),installments:Array.from({length:n},(_,i)=>({number:i+1,amountUsd:+installment.toFixed(2),dueDate:new Date(Date.now()+(i+1)*14*86400000).toISOString()})),items,line:{id:line.id,name:line.name,availableUsd:Number(line.limitUsd)-Number(line.usedUsd),initialPercent:Number(line.initialPercent),maxInstallments:line.maxInstallments}};
  }

  async confirm(userId:number,b:any){
    const verification=await this.db.verification.findFirst({where:{userId,type:'IDENTITY'},orderBy:{createdAt:'desc'}});
    if(verification?.status!=='APPROVED')throw new BadRequestException('Completa la verificación de identidad para confirmar la compra. Puedes seguir explorando Kredi+ mientras tanto.');
    const key=String(b.idempotencyKey||'').trim();
    if(key){const previous=await this.db.purchase.findFirst({where:{metadata:{path:['idempotencyKey'],equals:key},userId},include:{items:true,installments:true}});if(previous)return previous;}
    const q=await this.quote(userId,b);if(q.subtotalUsd>q.line.availableUsd)throw new BadRequestException('Disponible insuficiente');
    return this.db.$transaction(async tx=>{const purchase=await tx.purchase.create({data:{userId,storeId:b.storeId||null,creditLineId:b.creditLineId||null,fairId:b.fairId||null,type:b.type||'CATALOG',status:'PENDING_INITIAL_PAYMENT',subtotalUsd:q.subtotalUsd,initialPaymentUsd:q.initialPaymentUsd,financedUsd:q.financedUsd,totalUsd:q.subtotalUsd,metadata:{...(b.metadata||{}),idempotencyKey:key||undefined},items:{create:q.items},installments:{create:q.installments.map((i:any)=>({number:i.number,amountUsd:i.amountUsd,dueDate:new Date(i.dueDate)}))}},include:{items:true,installments:true}});await tx.creditLine.update({where:{id:Number(b.creditLineId)},data:{usedUsd:{increment:q.financedUsd}}});const updated=await tx.creditLine.findUnique({where:{id:Number(b.creditLineId)}});await tx.creditTransaction.create({data:{creditLineId:Number(b.creditLineId),direction:'DEBIT',amountUsd:q.financedUsd,type:'PURCHASE',referenceType:'Purchase',referenceId:String(purchase.id),description:'Compra Kredi+',balanceAfterUsd:updated?Number(updated.limitUsd)-Number(updated.usedUsd):null}});await tx.notification.create({data:{userId,type:'PURCHASE_CREATED',title:'Compra creada',body:`Tu compra #${purchase.id} fue creada correctamente.`,data:{destination:'purchases',purchaseId:purchase.id}}});return purchase;});
  }
}

@Controller()
export class PurchasesController {
  constructor(private readonly service:PurchaseService,private readonly db:PrismaService){}
  @Post('checkout/quote') quote(@CurrentUser()u:any,@Body()b:any){return this.service.quote(u.sub,b)}
  @Post('checkout/confirm') confirm(@CurrentUser()u:any,@Body()b:any){return this.service.confirm(u.sub,b)}
  @Get('purchases') list(@CurrentUser()u:any,@Query('status')status?:string){const map:any={pending:['DRAFT','PENDING_INITIAL_PAYMENT','PENDING'],paid:['PAID'],cancelled:['CANCELLED','REJECTED','REFUNDED']};return this.db.purchase.findMany({where:{userId:u.sub,...(status&&map[status]?{status:{in:map[status]}}:{})},include:{store:true,items:true,installments:true,payments:true},orderBy:{createdAt:'desc'}})}
  @Get('purchases/:id') detail(@CurrentUser()u:any,@Param('id')id:string){return this.db.purchase.findFirst({where:{id:Number(id),userId:u.sub},include:{store:true,items:true,installments:{include:{payments:{include:{payment:true}}}},payments:true}})}
}
@Module({controllers:[PurchasesController],providers:[PurchaseService]}) export class PurchasesModule {}
