import { BadRequestException, Body, Controller, HttpException, HttpStatus, Injectable, Module, Post } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../common/auth';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

@Injectable()
class AuthRateLimiter {
  private buckets = new Map<string, { count:number; resetAt:number }>();
  assert(key:string, limit:number, windowMs:number){
    const now=Date.now();
    const bucket=this.buckets.get(key);
    if(!bucket || bucket.resetAt<=now){this.buckets.set(key,{count:1,resetAt:now+windowMs});return;}
    if(bucket.count>=limit) throw new HttpException('Demasiados intentos. Espera un momento e inténtalo nuevamente.', HttpStatus.TOO_MANY_REQUESTS);
    bucket.count++;
  }
}

@Injectable()
class AuthService {
  constructor(private db:PrismaService, private jwt:JwtService, private limiter:AuthRateLimiter){}

  private async roles(userId:number){
    const rows=await this.db.userRole.findMany({where:{userId},include:{role:true}});
    return [...new Set(rows.map(r=>r.role.code==='STOREKEEPER'?'WAREHOUSE':r.role.code))];
  }

  private roleForFlutter(roles:string[]){
    if(roles.includes('ACCOUNTANT'))return 'ACCOUNTANT';
    if(roles.includes('ADMIN'))return 'ADMIN';
    if(roles.includes('WAREHOUSE')||roles.includes('STOREKEEPER'))return 'WAREHOUSE';
    return 'BENEFICIARY';
  }

  async userPayload(user:any){
    const roles=await this.roles(user.id);
    const verification=await this.db.verification.findFirst({where:{userId:user.id,type:'IDENTITY'},orderBy:{createdAt:'desc'}});
    return {
      id:user.id,
      username:user.username,
      fullName:[user.firstName,user.middleName,user.lastName,user.secondLastName].filter(Boolean).join(' '),
      email:user.email,
      phone:user.phone||'',
      role:this.roleForFlutter(roles),
      roles,
      verificationStatus:verification?.status||'PENDING',
      verificationRequired:verification?.status!=='APPROVED',
      accountStatus:user.status,
      firstName:user.firstName,
      middleName:user.middleName,
      lastName:user.lastName,
      secondLastName:user.secondLastName,
      nationalId:user.nationalId,
      birthDate:user.birthDate,
      employmentType:user.employmentType,
      adminSubrole:user.adminSubrole,
      state:user.stateName,
      municipality:user.municipalityName,
      parish:user.parishName,
      community:user.communityName,
      address:user.addressLine,
    };
  }

  private access(userId:number,username:string,roles:string[]){
    return this.jwt.sign({sub:userId,username,roles,purpose:'access'},{expiresIn:(process.env.JWT_EXPIRES_IN||'15m') as any});
  }

  private refresh(userId:number,username:string,roles:string[]){
    return this.jwt.sign({sub:userId,username,roles,purpose:'refresh'},{expiresIn:'30d'});
  }

  private hash(value:string){return createHash('sha256').update(value).digest('hex');}

  private async createSession(user:any, roles:string[], deviceName?:string){
    const accessToken=this.access(user.id,user.username,roles);
    const refreshToken=this.refresh(user.id,user.username,roles);
    await this.db.userSession.create({data:{
      userId:user.id,
      deviceName:deviceName||'Kredi+ Android Flutter',
      refreshTokenHash:this.hash(refreshToken),
      expiresAt:new Date(Date.now()+30*24*60*60_000),
    }});
    return {accessToken,refreshToken,user:await this.userPayload(user)};
  }

  async register(b:any){
    const email=String(b.email||'').trim().toLowerCase();
    const username=String(b.username||'').trim();
    this.limiter.assert(`register:${email||username}`,5,10*60_000);
    if(!email||!username||String(b.password||'').length<8) throw new BadRequestException('Datos de registro incompletos');
    if(String(b.pin||'').length!==6) throw new BadRequestException('El PIN debe tener 6 dígitos');
    const exists=await this.db.user.findFirst({where:{OR:[{email},{username}]}});
    if(exists)throw new BadRequestException('El usuario o correo ya está registrado');

    const passwordHash=await bcrypt.hash(String(b.password),12);
    const pinHash=await bcrypt.hash(String(b.pin),12);
    const birthDate=b.birthDate?new Date(`${String(b.birthDate).slice(0,10)}T12:00:00.000Z`):null;
    const user=await this.db.user.create({data:{
      username,email,phone:b.phone||null,
      firstName:b.firstName||'',middleName:b.middleName||null,lastName:b.lastName||'',secondLastName:b.secondLastName||null,
      nationalId:b.nationalId||b.cedula||null,
      birthDate:Number.isNaN(birthDate?.getTime())?null:birthDate,
      employmentType:b.employmentType||null,
      stateName:b.state||null,municipalityName:b.municipality||null,parishName:b.parish||null,communityName:b.community||null,addressLine:b.address||null,
      passwordHash,pinHash,status:'PENDING'
    }});

    const role=await this.db.role.findUnique({where:{code:'BENEFICIARY'}});
    if(role) await this.db.userRole.create({data:{userId:user.id,roleId:role.id}});
    const level=await this.db.loyaltyLevel.findUnique({where:{code:'K1'}});
    if(level) await this.db.loyaltyProfile.create({data:{userId:user.id,levelId:level.id}});
    // La única línea de compra visible y operativa es PRINCIPAL. La deuda se deriva de las cuotas pendientes.
    await this.db.creditLine.createMany({data:[
      {userId:user.id,code:'PRINCIPAL',name:'Principal',limitUsd:0,usedUsd:0,minInstallments:1,maxInstallments:level?.maxInstallments||2,initialPercent:level?Number(level.initialPercent):20,status:'PENDING'}
    ],skipDuplicates:true});
    await this.db.verification.create({data:{userId:user.id,type:'IDENTITY',status:'PENDING'}});
    await this.db.notification.create({data:{
      userId:user.id,
      type:'IDENTITY_PENDING',
      title:'Verifica tu identidad',
      body:'Completa tu selfie y ambos lados de la cédula para habilitar todas las funciones de Kredi+.',
      data:{destination:'identityVerification'}
    }});
    if(b.address){
      await this.db.address.create({data:{
        userId:user.id,label:'Casa',stateName:b.state||null,municipalityName:b.municipality||null,parishName:b.parish||null,communityName:b.community||null,
        addressLine:String(b.address),isPrimary:true
      }});
    }
    const roles=await this.roles(user.id);
    const session=await this.createSession(user,roles,b.deviceName);
    return {id:user.id,status:user.status,authenticated:true,next:'HOME',verification:{required:true,status:'PENDING'},...session};
  }

  async login(b:any){
    const key=String(b.username||b.email||'').trim();
    this.limiter.assert(`login:${key.toLowerCase()}`,10,5*60_000);
    const user=await this.db.user.findFirst({where:{OR:[{username:key},{email:key.toLowerCase()}]}});
    if(!user || !await bcrypt.compare(String(b.password||''),user.passwordHash)) throw new BadRequestException('Credenciales inválidas');
    if(user.status==='BLOCKED'||user.status==='DELETED')throw new BadRequestException('La cuenta no está disponible');
    if(!user.pinHash)throw new BadRequestException('La cuenta no tiene PIN de 6 dígitos configurado');
    const pinChallengeToken=this.jwt.sign({sub:user.id,purpose:'pin_challenge'},{expiresIn:'5m'});
    return {userId:user.id,pinChallengeToken,email:user.email};
  }

  async verifyPin(b:any){
    let challenge:any;
    try{challenge=this.jwt.verify(String(b.challengeToken||''));}catch{throw new BadRequestException('El desafío de PIN expiró');}
    const userId=Number(b.userId);
    if(challenge.purpose!=='pin_challenge'||Number(challenge.sub)!==userId)throw new BadRequestException('Desafío de PIN inválido');
    const user=await this.db.user.findUnique({where:{id:userId}});
    if(!user?.pinHash||!await bcrypt.compare(String(b.pin||''),user.pinHash)) throw new BadRequestException('PIN inválido');
    const roles=await this.roles(user.id);
    return this.createSession(user,roles,b.deviceName);
  }

  async refreshSession(b:any){
    let data:any;
    try{data=this.jwt.verify(String(b.refreshToken||''));}catch{throw new BadRequestException('Sesión vencida');}
    if(data.purpose!=='refresh')throw new BadRequestException('Token de renovación inválido');
    const user=await this.db.user.findUnique({where:{id:Number(data.sub)}});
    if(!user)throw new BadRequestException('Usuario no disponible');
    const roles=await this.roles(user.id);
    return {accessToken:this.access(user.id,user.username,roles),refreshToken:this.refresh(user.id,user.username,roles),user:await this.userPayload(user)};
  }

  async recoveryRequest(b:any){
    const key=String(b.username||b.email||b.identifier||'').trim();
    this.limiter.assert(`recovery:${key.toLowerCase()}`,5,15*60_000);
    const user=await this.db.user.findFirst({where:{OR:[{username:key},{email:key.toLowerCase()}]}});
    if(!user)return {ok:true};
    const code=String(Math.floor(100000+Math.random()*900000));
    await this.db.passwordResetToken.create({data:{userId:user.id,code,expiresAt:new Date(Date.now()+15*60_000)}});
    return {ok:true,delivery:'configured-provider'};
  }

  async recoveryReset(b:any){
    const key=String(b.username||b.email||b.identifier||'').trim();
    const user=await this.db.user.findFirst({where:{OR:[{username:key},{email:key.toLowerCase()}]}});
    if(!user)throw new BadRequestException('Solicitud inválida');
    const token=await this.db.passwordResetToken.findFirst({where:{userId:user.id,code:String(b.code||''),usedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});
    if(!token)throw new BadRequestException('Código inválido o vencido');
    const data:any={};
    if(b.password||b.newPassword)data.passwordHash=await bcrypt.hash(String(b.password||b.newPassword),12);
    if(b.pin||b.newPin){const next=String(b.pin||b.newPin);if(next.length!==6)throw new BadRequestException('El PIN debe tener 6 dígitos');data.pinHash=await bcrypt.hash(next,12);}
    if(!Object.keys(data).length)throw new BadRequestException('Indica nueva contraseña o PIN');
    await this.db.$transaction([
      this.db.user.update({where:{id:user.id},data}),
      this.db.passwordResetToken.update({where:{id:token.id},data:{usedAt:new Date()}})
    ]);
    return {ok:true};
  }
}

@Controller('auth')
class AuthController {
  constructor(private s:AuthService){}
  @Public() @Post('register') register(@Body() b:any){return this.s.register(b)}
  @Public() @Post('login') login(@Body() b:any){return this.s.login(b)}
  @Public() @Post('verify-pin') pin(@Body() b:any){return this.s.verifyPin(b)}
  @Public() @Post('refresh') refresh(@Body() b:any){return this.s.refreshSession(b)}
  @Public() @Post('password-recovery/request') recoveryRequest(@Body()b:any){return this.s.recoveryRequest(b)}
  @Public() @Post('password-recovery/reset') recoveryReset(@Body()b:any){return this.s.recoveryReset(b)}
}

@Module({
  imports:[JwtModule.register({global:true,secret:process.env.JWT_SECRET||'DEV_ONLY_CHANGE_ME'})],
  controllers:[AuthController],
  providers:[AuthService,AuthRateLimiter],
  exports:[JwtModule,AuthService]
})
export class AuthModule {}
