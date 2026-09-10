import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log=new Logger(BootstrapService.name);
  constructor(private readonly db:PrismaService){}

  async onApplicationBootstrap(){
    try{await this.ensureBaseConfiguration();}
    catch(e){this.log.error(`No se pudo completar bootstrap Kredi+: ${e instanceof Error?e.message:String(e)}`);}
  }

  private async ensureBaseConfiguration(){
    const roles=[['BENEFICIARY','Beneficiario'],['ADMIN','Administrador'],['ACCOUNTANT','Contador'],['WAREHOUSE','Almacenista']] as const;
    for(const [code,name] of roles) await this.db.role.upsert({where:{code},update:{name},create:{code,name}});

    const legacy=await this.db.role.findUnique({where:{code:'STOREKEEPER'}});
    const warehouse=await this.db.role.findUnique({where:{code:'WAREHOUSE'}});
    if(legacy&&warehouse){
      const links=await this.db.userRole.findMany({where:{roleId:legacy.id}});
      for(const x of links) await this.db.userRole.upsert({where:{userId_roleId:{userId:x.userId,roleId:warehouse.id}},update:{},create:{userId:x.userId,roleId:warehouse.id}});
    }

    const rules=[
      ['K1','Santa Ana',1,0,1,20,2],['K2','El Ávila',2,3,2,16,2],['K3','Autana',3,6,3,12,3],
      ['K4','Auyantepuy',4,12,4,8,4],['K5','Pico Bolívar',5,20,5,4,5],['K6','Salto Ángel',6,30,6,0,6],
    ] as const;
    for(const [code,name,sortOrder,minPayments,multiplier,initialPercent,maxInstallments] of rules){
      await this.db.loyaltyLevel.upsert({where:{code},update:{name,sortOrder,minPaidUsd:0,minOnTimeInstallments:minPayments,principalLimitUsd:60*multiplier,everydayLimitUsd:0,initialPercent,maxInstallments,benefits:{creditMultiplier:multiplier,baseAmountUsd:60,officialKotlinRule:true}},create:{code,name,sortOrder,minPaidUsd:0,minOnTimeInstallments:minPayments,principalLimitUsd:60*multiplier,everydayLimitUsd:0,initialPercent,maxInstallments,benefits:{creditMultiplier:multiplier,baseAmountUsd:60,officialKotlinRule:true}}});
    }

    const email=(process.env.BOOTSTRAP_ACCOUNTANT_EMAIL||'').trim().toLowerCase();
    const password=process.env.BOOTSTRAP_ACCOUNTANT_PASSWORD||'';
    if(email&&password.length>=8){
      const accountant=await this.db.role.findUnique({where:{code:'ACCOUNTANT'}});
      if(accountant){
        const existingAccountants=await this.db.user.findMany({where:{roles:{some:{role:{code:'ACCOUNTANT'}}}},select:{id:true,email:true},take:2});
        if(existingAccountants.length===0){
          let user=await this.db.user.findUnique({where:{email}});
          if(!user){
            user=await this.db.user.create({data:{username:(process.env.BOOTSTRAP_ACCOUNTANT_USERNAME||'contador.general').trim(),email,firstName:process.env.BOOTSTRAP_ACCOUNTANT_FIRST_NAME||'Contador',lastName:process.env.BOOTSTRAP_ACCOUNTANT_LAST_NAME||'General',phone:process.env.BOOTSTRAP_ACCOUNTANT_PHONE||null,passwordHash:await bcrypt.hash(password,12),pinHash:process.env.BOOTSTRAP_ACCOUNTANT_PIN?await bcrypt.hash(process.env.BOOTSTRAP_ACCOUNTANT_PIN,12):null,status:'ACTIVE',emailVerifiedAt:new Date(),adminSubrole:'ACCOUNTING'}});
          }
          await this.db.userRole.upsert({where:{userId_roleId:{userId:user.id,roleId:accountant.id}},update:{},create:{userId:user.id,roleId:accountant.id}});
          this.log.log('Cuenta Contador bootstrap creada desde variables protegidas.');
        }
      }
    }
  }
}
