import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const db = new PrismaClient();

const permissions = [
  'users.view','users.verify','users.suspend','users.delete','dossier.view','roles.switch',
  'notifications.manage','services.manage','credit.review','credit.manage','payments.review','payments.reconcile',
  'catalog.view','catalog.manage','inventory.view','inventory.manage','inventory.movements','orders.view','orders.manage',
  'product_images.manage','excel.products.preview','excel.products.price_update','fairs.view','fairs.manage','combos.view',
  'banners.manage','promotions.manage','communities.manage','reports.view','audit.view','budget.view','budget.move',
  'budget.allocate','businesses.manage','monthly_close.manage','sensitive_approvals.manage','staff.manage','discounts.manage',
  'predictive.view','loyalty.manage'
];

async function upsertRole(code:string,name:string){
  return db.role.upsert({where:{code},update:{name},create:{code,name}});
}

async function attach(roleId:number,codes:string[]){
  const all=await db.permission.findMany({where:{code:{in:codes}}});
  for(const p of all) await db.rolePermission.upsert({
    where:{roleId_permissionId:{roleId,permissionId:p.id}},update:{},create:{roleId,permissionId:p.id}
  });
}

async function main(){
  for(const code of permissions) await db.permission.upsert({where:{code},update:{},create:{code,description:code}});

  const beneficiary=await upsertRole('BENEFICIARY','Beneficiario');
  const admin=await upsertRole('ADMIN','Administrador');
  const accountant=await upsertRole('ACCOUNTANT','Contador');
  const warehouse=await upsertRole('WAREHOUSE','Almacenista');

  // Compatibilidad: instalaciones 2.1.x podían haber creado STOREKEEPER.
  const legacyStorekeeper=await db.role.findUnique({where:{code:'STOREKEEPER'}});
  if(legacyStorekeeper){
    const links=await db.userRole.findMany({where:{roleId:legacyStorekeeper.id}});
    for(const link of links){
      await db.userRole.upsert({
        where:{userId_roleId:{userId:link.userId,roleId:warehouse.id}},
        update:{},create:{userId:link.userId,roleId:warehouse.id}
      });
    }
  }

  await attach(beneficiary.id,['roles.switch']);
  await attach(admin.id,permissions.filter(x=>!['staff.manage','monthly_close.manage','budget.allocate','budget.move','businesses.manage'].includes(x)));
  await attach(accountant.id,[
    'budget.view','budget.move','budget.allocate','businesses.manage','payments.reconcile','monthly_close.manage',
    'sensitive_approvals.manage','staff.manage','discounts.manage','predictive.view','dossier.view','reports.view',
    'users.view','users.verify','audit.view','credit.manage','payments.review'
  ]);
  await attach(warehouse.id,[
    'catalog.view','catalog.manage','inventory.view','inventory.manage','inventory.movements','orders.view','orders.manage',
    'product_images.manage','excel.products.preview','excel.products.price_update','fairs.view','combos.view','notifications.manage'
  ]);

  // Reglas oficiales heredadas del backend Kotlin Kredi+: 6 niveles venezolanos.
  const levels = [
    {code:'K1',name:'Santa Ana',sortOrder:1,minOnTimeInstallments:0, creditMultiplier:1, initialPercent:20,maxInstallments:2},
    {code:'K2',name:'El Ávila',sortOrder:2,minOnTimeInstallments:3, creditMultiplier:2, initialPercent:16,maxInstallments:2},
    {code:'K3',name:'Autana',sortOrder:3,minOnTimeInstallments:6, creditMultiplier:3, initialPercent:12,maxInstallments:3},
    {code:'K4',name:'Auyantepuy',sortOrder:4,minOnTimeInstallments:12,creditMultiplier:4, initialPercent:8,maxInstallments:4},
    {code:'K5',name:'Pico Bolívar',sortOrder:5,minOnTimeInstallments:20,creditMultiplier:5, initialPercent:4,maxInstallments:5},
    {code:'K6',name:'Salto Ángel',sortOrder:6,minOnTimeInstallments:30,creditMultiplier:6, initialPercent:0,maxInstallments:6},
  ];
  for(const l of levels){
    const principalLimitUsd=60*l.creditMultiplier;
    await db.loyaltyLevel.upsert({
      where:{code:l.code},
      update:{
        name:l.name,sortOrder:l.sortOrder,minPaidUsd:0,minOnTimeInstallments:l.minOnTimeInstallments,
        principalLimitUsd,everydayLimitUsd:0,maxInstallments:l.maxInstallments,initialPercent:l.initialPercent,
        benefits:{creditMultiplier:l.creditMultiplier,baseAmountUsd:60,officialKotlinRule:true}
      },
      create:{
        code:l.code,name:l.name,sortOrder:l.sortOrder,minPaidUsd:0,minOnTimeInstallments:l.minOnTimeInstallments,
        principalLimitUsd,everydayLimitUsd:0,maxInstallments:l.maxInstallments,initialPercent:l.initialPercent,
        benefits:{creditMultiplier:l.creditMultiplier,baseAmountUsd:60,officialKotlinRule:true}
      }
    });
  }

  const serviceProviders=[
    {code:'DIGITEL',name:'Digitel',type:'MOBILE',description:'Recarga y pago de telefonía móvil'},
    {code:'MOVISTAR',name:'Movistar',type:'MOBILE',description:'Recarga y pago de telefonía móvil'},
    {code:'MOVILNET',name:'Movilnet',type:'MOBILE',description:'Recarga y pago de telefonía móvil'},
    {code:'INTER',name:'Inter',type:'SERVICE',description:'Pago de servicios'},
  ];
  for(const provider of serviceProviders) await db.serviceProvider.upsert({where:{code:provider.code},update:provider,create:provider});

  await db.budgetAccount.upsert({where:{code:'CENTRAL'},update:{},create:{code:'CENTRAL',name:'Presupuesto central Kredi+'}});
  for(const [code,name] of [['0102','Banco de Venezuela'],['0105','Mercantil'],['0108','Provincial'],['0134','Banesco'],['0191','BNC']])
    await db.bank.upsert({where:{code},update:{name},create:{code,name}});

  // El Contador es la única cuenta operativa que puede nacer desde variables protegidas del backend.
  const accountantEmail=(process.env.BOOTSTRAP_ACCOUNTANT_EMAIL||'').trim().toLowerCase();
  const accountantPassword=process.env.BOOTSTRAP_ACCOUNTANT_PASSWORD||'';
  if(accountantEmail && accountantPassword.length>=8){
    let u=await db.user.findUnique({where:{email:accountantEmail}});
    if(!u){
      u=await db.user.create({data:{
        username:(process.env.BOOTSTRAP_ACCOUNTANT_USERNAME||'contador.general').trim(),email:accountantEmail,
        firstName:(process.env.BOOTSTRAP_ACCOUNTANT_FIRST_NAME||'Contador').trim(),
        lastName:(process.env.BOOTSTRAP_ACCOUNTANT_LAST_NAME||'General').trim(),
        phone:process.env.BOOTSTRAP_ACCOUNTANT_PHONE||null,
        passwordHash:await bcrypt.hash(accountantPassword,12),
        pinHash:process.env.BOOTSTRAP_ACCOUNTANT_PIN?await bcrypt.hash(process.env.BOOTSTRAP_ACCOUNTANT_PIN,12):null,
        status:'ACTIVE',emailVerifiedAt:new Date()
      }});
    }
    await db.userRole.upsert({where:{userId_roleId:{userId:u.id,roleId:accountant.id}},update:{},create:{userId:u.id,roleId:accountant.id}});
  }

  // Los Administradores y Almacenistas se crean exclusivamente desde el panel del Contador.
  // Variables SEED_ADMIN_* ya no crean cuentas en Backend Mobile 2.2.0.

}

main().finally(()=>db.$disconnect());
