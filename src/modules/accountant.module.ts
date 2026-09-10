import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import * as bcrypt from 'bcryptjs';

@Roles('ACCOUNTANT')
@Controller('accountant')
export class AccountantController {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  @Get('dashboard')
  async dashboard(){const [budget,pendingReconciliation,pendingApprovals,stores,staff]=await Promise.all([this.db.budgetAccount.findUnique({where:{code:'CENTRAL'}}),this.db.reconciliationItem.count({where:{status:{in:['PENDING','PROBABLE','MANUAL_REVIEW','DIFFERENCE']}}}),this.db.sensitiveApproval.count({where:{status:'PENDING'}}),this.db.store.count({where:{active:true}}),this.db.userRole.count({where:{role:{code:{in:['ADMIN','WAREHOUSE','STOREKEEPER']}}}})]);return{budget,pendingReconciliation,pendingApprovals,activeBusinesses:stores,staff}}
  @Get('budget') budget(){return this.db.budgetAccount.findUnique({where:{code:'CENTRAL'},include:{movements:{orderBy:{createdAt:'desc'},take:200},allocations:{orderBy:{createdAt:'desc'},take:100}}})}
  @Post('budget-movements') async movement(@CurrentUser()u:any,@Body()b:any){let acct=await this.db.budgetAccount.findUnique({where:{code:'CENTRAL'}});if(!acct)acct=await this.db.budgetAccount.create({data:{code:'CENTRAL',name:'Presupuesto central'}});const signed=['EXPENSE','EGRESO'].includes(String(b.type).toUpperCase())?-Math.abs(Number(b.amountUsd)):Math.abs(Number(b.amountUsd));const m=await this.db.$transaction(async tx=>{const row=await tx.budgetMovement.create({data:{budgetAccountId:acct!.id,type:b.type,amountUsd:Number(b.amountUsd),description:b.description,reference:b.reference||null,actorUserId:u.sub}});await tx.budgetAccount.update({where:{id:acct!.id},data:{balanceUsd:{increment:signed}}});return row});await this.audit.write(u.sub,'BUDGET_MOVEMENT','BudgetMovement',String(m.id),b,b.description);return m}
  @Post('allocations') async allocation(@CurrentUser()u:any,@Body()b:any){let acct=await this.db.budgetAccount.findUnique({where:{code:'CENTRAL'}});if(!acct)acct=await this.db.budgetAccount.create({data:{code:'CENTRAL',name:'Presupuesto central'}});const targetUserId=b.targetUserId?Number(b.targetUserId):(await this.db.user.findFirst({where:{username:String(b.adminUsername||'')}}))?.id;if(!targetUserId)throw new BadRequestException('Administrador destino no encontrado');const a=await this.db.budgetAllocation.create({data:{budgetAccountId:acct.id,targetUserId,amountUsd:Number(b.amountUsd),description:b.description||null,createdBy:u.sub}});await this.audit.write(u.sub,'BUDGET_ALLOCATION','BudgetAllocation',String(a.id),b,b.description);return a}
  @Get('businesses') businesses(){return this.db.store.findMany({include:{branches:true,bankAccounts:true},orderBy:{commercialName:'asc'}})}
  @Post('businesses') business(@Body()b:any){return this.db.store.create({data:{legalName:b.legalName,commercialName:b.commercialName,rif:b.rif,description:b.description||null,categories:b.categories||[],active:b.active!==false}})}
  @Patch('businesses/:id') businessUpdate(@Param('id')id:string,@Body()b:any){return this.db.store.update({where:{id:Number(id)},data:b})}
  @Post('businesses/:id/status') businessStatus(@Param('id')id:string,@Body()b:any){return this.db.store.update({where:{id:Number(id)},data:{active:!!b.active}})}
  @Post('businesses/:id/bank-accounts') bankAccount(@Param('id')id:string,@Body()b:any){return this.db.businessBankAccount.create({data:{storeId:Number(id),bankCode:String(b.bankCode),accountType:b.accountType||null,accountNumber:b.accountNumber||null,phone:b.phone||null,document:b.document||null,method:String(b.method||'BANK'),active:b.active!==false}})}
  @Get('reconciliation') async reconciliation(){const items=await this.db.reconciliationItem.findMany({orderBy:{createdAt:'desc'},take:300});return{items,count:items.length,pending:items.filter(x=>['PENDING','PROBABLE','MANUAL_REVIEW','DIFFERENCE'].includes(x.status)).length}}
  @Post('reconciliation/:id/review') async reconcile(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const x=await this.db.reconciliationItem.update({where:{id:Number(id)},data:{status:b.status,observation:b.observation||null,reviewedBy:u.sub,reviewedAt:new Date()}});await this.audit.write(u.sub,'RECONCILIATION_REVIEW','ReconciliationItem',id,b,b.observation);return x}
  @Get('monthly-close') async close(@Query('month')month?:string){const m=month||new Date().toISOString().slice(0,7);const start=new Date(`${m}-01T00:00:00.000Z`);const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);const[payments,purchases,movements,differences]=await Promise.all([this.db.payment.count({where:{createdAt:{gte:start,lt:end},status:'APPROVED'}}),this.db.purchase.count({where:{createdAt:{gte:start,lt:end},status:'PAID'}}),this.db.budgetMovement.count({where:{createdAt:{gte:start,lt:end}}}),this.db.reconciliationItem.count({where:{createdAt:{gte:start,lt:end},status:{in:['PENDING','MANUAL_REVIEW','DIFFERENCE']}}})]);return{month,checks:{paymentsApproved:payments,purchasesPaid:purchases,budgetMovements:movements,reconciliationDifferences:differences},canClose:differences===0}}
  @Get('sensitive-approvals') approvals(){return this.db.sensitiveApproval.findMany({orderBy:{createdAt:'asc'},take:100})}
  @Post('sensitive-approvals') approval(@CurrentUser()u:any,@Body()b:any){return this.db.sensitiveApproval.create({data:{actionType:b.actionType,payload:b.payload||{},requestedBy:u.sub,reason:b.reason||null}})}
  @Post('sensitive-approvals/:id/review') async approvalReview(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const x=await this.db.sensitiveApproval.findUnique({where:{id:Number(id)}});if(!x)throw new BadRequestException('Solicitud no encontrada');if(x.requestedBy===u.sub)throw new BadRequestException('La segunda autorización debe realizarla otra persona');const out=await this.db.sensitiveApproval.update({where:{id:x.id},data:{status:b.approved?'APPROVED':'REJECTED',reviewedBy:u.sub,reviewedAt:new Date(),reason:b.reason||x.reason}});await this.audit.write(u.sub,'SENSITIVE_APPROVAL_REVIEW','SensitiveApproval',id,{status:out.status},b.reason);return out}

  @Get('staff')
  staff(){return this.db.user.findMany({where:{roles:{some:{role:{code:{in:['ADMIN','WAREHOUSE','STOREKEEPER']}}}}},include:{roles:{include:{role:true}},verifications:{orderBy:{createdAt:'desc'},take:1}},orderBy:{createdAt:'desc'},take:300})}

  @Post('staff')
  async createStaff(@CurrentUser()u:any,@Body()b:any){
    let roleCode=String(b.role||'WAREHOUSE').trim().toUpperCase();
    if(roleCode==='STOREKEEPER'||roleCode==='ALMACENISTA')roleCode='WAREHOUSE';
    if(!['ADMIN','WAREHOUSE'].includes(roleCode))throw new BadRequestException('El Contador solo puede crear Administradores o Almacenistas');
    const allowedAdminSubroles=['GENERAL','SUPERVISOR','ANALYST','SUPPORT','AUDITOR','ANTIFRAUD'];
    const adminSubrole=roleCode==='ADMIN'?String(b.adminSubrole||'GENERAL').trim().toUpperCase():'WAREHOUSE';
    if(roleCode==='ADMIN'&&!allowedAdminSubroles.includes(adminSubrole))throw new BadRequestException('Perfil administrativo inválido');
    const username=String(b.username||'').trim();
    const email=String(b.email||'').toLowerCase().trim();
    const firstName=String(b.firstName||'').trim();
    const lastName=String(b.lastName||'').trim();
    const password=String(b.password||'');
    const pin=String(b.pin||'').trim();
    if(username.length<3||!email.includes('@')||firstName.length<2||lastName.length<2)throw new BadRequestException('Usuario, correo, nombre y apellido son obligatorios');
    if(password.length<8)throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    if(!/^\d{6}$/.test(pin))throw new BadRequestException('El PIN debe tener exactamente 6 dígitos');
    const exists=await this.db.user.findFirst({where:{OR:[{username},{email}]}});
    if(exists)throw new BadRequestException('El usuario o correo ya está registrado');
    const role=await this.db.role.findUnique({where:{code:roleCode}});
    if(!role)throw new BadRequestException('Rol no configurado');
    const user=await this.db.user.create({data:{
      username,email,phone:String(b.phone||'').trim()||null,firstName,middleName:String(b.middleName||'').trim()||null,lastName,
      secondLastName:String(b.secondLastName||'').trim()||null,nationalId:String(b.nationalId||'').trim()||null,
      adminSubrole,passwordHash:await bcrypt.hash(password,12),pinHash:await bcrypt.hash(pin,12),status:'ACTIVE',emailVerifiedAt:new Date()
    }});
    await this.db.userRole.create({data:{userId:user.id,roleId:role.id}});
    await this.db.notification.create({data:{userId:user.id,type:'STAFF_CREATED',title:'Acceso Kredi+ creado',body:`Tu acceso de ${roleCode==='ADMIN'?'Administrador':'Almacenista'} está listo.`,data:{destination:'home'}}});
    await this.audit.write(u.sub,'STAFF_CREATE','User',String(user.id),{role:roleCode,adminSubrole},b.reason);
    return user;
  }

  @Post('staff/:id/access')
  async grantAccess(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){let roleCode=String(b.role||'').toUpperCase();if(roleCode==='STOREKEEPER')roleCode='WAREHOUSE';if(!['ADMIN','WAREHOUSE'].includes(roleCode))throw new BadRequestException('No se puede asignar el rol Contador desde la aplicación');const role=await this.db.role.findUnique({where:{code:roleCode}});if(!role)throw new BadRequestException('Rol no encontrado');const target=await this.db.user.findUnique({where:{id:Number(id)},include:{roles:{include:{role:true}}}});if(!target||!target.roles.some(x=>['ADMIN','WAREHOUSE','STOREKEEPER'].includes(x.role.code)))throw new BadRequestException('Los accesos operativos se crean desde Personal; no se promocionan beneficiarios');await this.db.userRole.upsert({where:{userId_roleId:{userId:Number(id),roleId:role.id}},update:{},create:{userId:Number(id),roleId:role.id}});await this.audit.write(u.sub,'ROLE_GRANT','User',id,{role:role.code},b.reason);return{ok:true}}
  @Delete('staff/:id/access/:role')
  async removeAccess(@CurrentUser()u:any,@Param('id')id:string,@Param('role')roleCode:string,@Body()b:any){const role=await this.db.role.findUnique({where:{code:roleCode.toUpperCase()}});if(role)await this.db.userRole.deleteMany({where:{userId:Number(id),roleId:role.id}});await this.audit.write(u.sub,'ROLE_REMOVE','User',id,{role:roleCode},b?.reason);return{ok:true}}
  @Post('staff/:id/suspend') async suspend(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){if(!String(b.reason||'').trim())throw new BadRequestException('El motivo es obligatorio');const user=await this.db.user.update({where:{id:Number(id)},data:{status:'SUSPENDED'}});await this.audit.write(u.sub,'USER_SUSPEND','User',id,{status:user.status},b.reason);return user}
  @Post('staff/:id/reactivate') async reactivate(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const user=await this.db.user.update({where:{id:Number(id)},data:{status:'ACTIVE'}});await this.audit.write(u.sub,'USER_REACTIVATE','User',id,{status:user.status},b.reason);return user}
  @Delete('staff/:id') async deleteStaff(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){const user=await this.db.user.update({where:{id:Number(id)},data:{status:'DELETED'}});await this.audit.write(u.sub,'USER_SOFT_DELETE','User',id,{status:user.status},b?.reason);return{ok:true}}

  @Get('beneficiaries') beneficiaries(){return this.db.user.findMany({where:{roles:{some:{role:{code:'BENEFICIARY'}}}},include:{roles:{include:{role:true}},loyalty:{include:{level:true}}},orderBy:{createdAt:'desc'},take:500})}
  @Get('credit-loans') creditLoans(){return this.db.purchase.findMany({where:{financedUsd:{gt:0}},include:{user:true,store:true,installments:true,payments:true},orderBy:{createdAt:'desc'},take:500})}

  @Post('monthly-close')
  async executeClose(@CurrentUser()u:any,@Body()b:any){
    const month=String(b.month||new Date().toISOString().slice(0,7));
    if(!/^\d{4}-\d{2}$/.test(month))throw new BadRequestException('Período inválido. Usa AAAA-MM');
    const start=new Date(`${month}-01T00:00:00.000Z`);const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
    const differences=await this.db.reconciliationItem.count({where:{createdAt:{gte:start,lt:end},status:{in:['PENDING','MANUAL_REVIEW','DIFFERENCE']}}});
    if(differences>0)throw new BadRequestException(`No se puede cerrar: ${differences} diferencias de conciliación pendientes`);
    const key=`monthly-close:${month}`;
    const existing=await this.db.appSetting.findUnique({where:{key}});if(existing)throw new BadRequestException('Este período ya fue cerrado');
    const value={month,closedAt:new Date().toISOString(),closedBy:u.sub};
    await this.db.appSetting.create({data:{key,value}});
    await this.audit.write(u.sub,'MONTHLY_CLOSE','AccountingPeriod',month,value,b.reason||'Cierre mensual');
    return{ok:true,...value};
  }

  @Get('discounts') discounts(){return this.db.discount.findMany({orderBy:{createdAt:'desc'}})}
  @Post('discounts') discount(@CurrentUser()u:any,@Body()b:any){return this.db.discount.create({data:{name:b.name,code:b.code||null,type:b.type,value:Number(b.value),startsAt:b.startsAt?new Date(b.startsAt):null,endsAt:b.endsAt?new Date(b.endsAt):null,active:b.active!==false,usageLimit:b.usageLimit?Number(b.usageLimit):null,createdBy:u.sub}})}
  @Get('predictive') async predictive(){const[overdue,pendingPayments,activeLines]=await Promise.all([this.db.installment.count({where:{status:'OVERDUE'}}),this.db.payment.count({where:{status:{in:['REPORTED','REVIEWING']}}}),this.db.creditLine.count({where:{status:'ACTIVE'}})]);return{overdueInstallments:overdue,pendingPaymentReviews:pendingPayments,activeCreditLines:activeLines,alerts:overdue>0?[{type:'COLLECTION',severity:overdue>20?'HIGH':'MEDIUM',message:`${overdue} cuotas vencidas requieren seguimiento.`}]:[]}}
}
@Module({controllers:[AccountantController]}) export class AccountantModule {}
