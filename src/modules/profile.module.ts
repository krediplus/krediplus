import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { permissionsForAdmin } from '../common/permissions';

@Injectable()
class ProfileService {
  constructor(private db:PrismaService){}

  async me(id:number){
    const user=await this.db.user.findUnique({where:{id},include:{roles:{include:{role:true}},verifications:{where:{type:'IDENTITY'},orderBy:{createdAt:'desc'},take:1}}});
    if(!user)return null;
    const roles=user.roles.map(r=>r.role.code);
    const role=roles.includes('ACCOUNTANT')?'ACCOUNTANT':roles.includes('ADMIN')?'ADMIN':(roles.includes('WAREHOUSE')||roles.includes('STOREKEEPER'))?'WAREHOUSE':'BENEFICIARY';
    const verification=user.verifications[0];
    return {
      id:user.id,username:user.username,
      fullName:[user.firstName,user.middleName,user.lastName,user.secondLastName].filter(Boolean).join(' '),
      email:user.email,phone:user.phone||'',role,roles,
      verificationStatus:verification?.status||'PENDING',verificationRequired:verification?.status!=='APPROVED',accountStatus:user.status,
      firstName:user.firstName,middleName:user.middleName,lastName:user.lastName,secondLastName:user.secondLastName,nationalId:user.nationalId,
      birthDate:user.birthDate,employmentType:user.employmentType,adminSubrole:user.adminSubrole,state:user.stateName,municipality:user.municipalityName,parish:user.parishName,community:user.communityName,address:user.addressLine,
      emailVerifiedAt:user.emailVerifiedAt,phoneVerifiedAt:user.phoneVerifiedAt,createdAt:user.createdAt,
    };
  }
}

@Controller('me')
class ProfileController {
  constructor(private s:ProfileService,private db:PrismaService){}

  @Get() me(@CurrentUser()u:any){return this.s.me(u.sub)}

  @Get('role-experience') async roleExperience(@CurrentUser()u:any){
    const [rs,user]=await Promise.all([
      this.db.userRole.findMany({where:{userId:u.sub},include:{role:{include:{permissions:{include:{permission:true}}}}}}),
      this.db.user.findUnique({where:{id:u.sub},select:{adminSubrole:true}}),
    ]);
    const roles=[...new Set(rs.map(x=>x.role.code==='STOREKEEPER'?'WAREHOUSE':x.role.code))];
    const base=rs.filter(x=>x.role.code!=='ADMIN').flatMap(x=>x.role.permissions.map(p=>p.permission.code));
    const admin=roles.includes('ADMIN')?[...permissionsForAdmin(user?.adminSubrole)]:[];
    const permissions=[...new Set([...base,...admin])];
    return {roles,permissions,primaryRole:roles.includes('ACCOUNTANT')?'ACCOUNTANT':roles.includes('ADMIN')?'ADMIN':roles.includes('WAREHOUSE')?'WAREHOUSE':'BENEFICIARY',adminSubrole:user?.adminSubrole||null};
  }

  @Patch() update(@CurrentUser()u:any,@Body()b:any){
    const allowed:any={};
    for(const k of ['phone','middleName','secondLastName']) if(b[k]!==undefined) allowed[k]=b[k];
    return this.db.user.update({where:{id:u.sub},data:allowed});
  }

  @Get('addresses') addresses(@CurrentUser()u:any){
    return this.db.address.findMany({where:{userId:u.sub},orderBy:[{isPrimary:'desc'},{id:'asc'}]});
  }

  @Post('addresses') async addressCreate(@CurrentUser()u:any,@Body()b:any){
    if(!String(b.addressLine||'').trim())throw new BadRequestException('Indica la dirección');
    return this.db.$transaction(async tx=>{
      if(b.isPrimary)await tx.address.updateMany({where:{userId:u.sub},data:{isPrimary:false}});
      return tx.address.create({data:{
        userId:u.sub,label:b.label||'Casa',stateId:b.stateId||null,municipalityId:b.municipalityId||null,parishId:b.parishId||null,communityId:b.communityId||null,
        stateName:b.stateName||null,municipalityName:b.municipalityName||null,parishName:b.parishName||null,communityName:b.communityName||null,
        addressLine:String(b.addressLine).trim(),formattedAddress:String(b.formattedAddress||b.addressLine).trim(),reference:b.reference||null,latitude:b.latitude||null,longitude:b.longitude||null,isPrimary:!!b.isPrimary
      }});
    });
  }

  @Patch('addresses/:id') async addressUpdate(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){
    const address=await this.db.address.findFirst({where:{id:Number(id),userId:u.sub}});
    if(!address)throw new BadRequestException('Dirección no encontrada');
    const data:any={};
    for(const k of ['label','stateId','municipalityId','parishId','communityId','stateName','municipalityName','parishName','communityName','addressLine','formattedAddress','reference','latitude','longitude','isPrimary']) if(b[k]!==undefined)data[k]=b[k];
    return this.db.$transaction(async tx=>{
      if(b.isPrimary)await tx.address.updateMany({where:{userId:u.sub,id:{not:Number(id)}},data:{isPrimary:false}});
      return tx.address.update({where:{id:Number(id)},data});
    });
  }

  @Delete('addresses/:id') async addressDelete(@CurrentUser()u:any,@Param('id')id:string){
    const address=await this.db.address.findFirst({where:{id:Number(id),userId:u.sub}});
    if(!address)throw new BadRequestException('Dirección no encontrada');
    return this.db.address.delete({where:{id:Number(id)}});
  }

  @Get('sessions') sessions(@CurrentUser()u:any){
    return this.db.userSession.findMany({where:{userId:u.sub,revokedAt:null},select:{id:true,deviceName:true,createdAt:true,expiresAt:true},orderBy:{createdAt:'desc'}});
  }

  @Post('sessions/:id/revoke') async revoke(@CurrentUser()u:any,@Param('id')id:string){
    const session=await this.db.userSession.findFirst({where:{id,userId:u.sub,revokedAt:null}});
    if(!session)throw new BadRequestException('Sesión no encontrada');
    await this.db.userSession.update({where:{id},data:{revokedAt:new Date()}});
    return {ok:true};
  }
}

@Module({controllers:[ProfileController],providers:[ProfileService],exports:[ProfileService]})
export class ProfileModule {}
