import { BadRequestException, Body, Controller, Get, Module, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcryptjs';

function workbookBuffer(headers:string[], sample:any[]=[]){
  const ws=XLSX.utils.json_to_sheet(sample.length?sample:[Object.fromEntries(headers.map(h=>[h,'']))],{header:headers});
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Datos');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
function rows(file?:Express.Multer.File){
  if(!file?.buffer)throw new BadRequestException('Archivo Excel requerido');
  const wb=XLSX.read(file.buffer,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<any>(ws,{defval:''});
}

// Compatibilidad administrativa. El Almacenista usa /warehouse/products/import,
// que garantiza vista previa y que un producto existente SOLO cambie de precio.
@Roles('ADMIN')
@Controller('admin/products')
class ProductExcelController{
  constructor(private db:PrismaService){}
  @Get('import-format.xlsx') format(@Res()res:Response){
    const b=workbookBuffer(['name','category','classification','brand','unit','priceIndividualUsd','storeId'],[{name:'Arroz 1kg',category:'Alimentos',classification:'Granos',brand:'Ejemplo',unit:'kg',priceIndividualUsd:2.30,storeId:''}]);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=KrediPlus_Productos.xlsx');res.send(b);
  }
  @Post('import') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024}}))
  async import(@UploadedFile()file:Express.Multer.File,@Body()body:any,@Query('confirm')queryConfirm='false',@Query('updateExisting')queryUpdate='true'){
    const confirm=String(body?.confirm??queryConfirm)==='true';const updateExisting=String(body?.updateExisting??queryUpdate)!=='false';
    const data=rows(file).map((r:any,i:number)=>({row:i+2,name:String(r.name||r.nombre||'').trim(),category:String(r.category||r.categoria||'').trim(),classification:String(r.classification||r.clasificacion||'').trim()||null,brand:String(r.brand||r.marca||'').trim()||null,unit:String(r.unit||r.unidad||'').trim()||null,priceUsd:Number(r.priceIndividualUsd||r.precioIndividualUsd||r.priceUsd||r.precio||0),storeId:r.storeId?Number(r.storeId):null}));
    const errors=data.filter((r:any)=>!r.name||!r.category||!Number.isFinite(r.priceUsd)||r.priceUsd<0).map((r:any)=>({row:r.row,error:'Nombre, categoría y precio individual válidos son obligatorios'}));
    const preview=[] as any[];
    for(const r of data.slice(0,100)){const old=await this.db.product.findFirst({where:{name:{equals:r.name,mode:'insensitive'},storeId:r.storeId}});preview.push({...r,currentPriceUsd:old?Number(old.priceUsd):null,currentStock:old?.stock??0,action:old?(Number(old.priceUsd)!==r.priceUsd?'ACTUALIZAR_PRECIO':'SIN_CAMBIO'):'CREAR_STOCK_0'});}
    if(!confirm||errors.length)return {confirm:false,total:data.length,valid:data.length-errors.length,errors,preview};
    let created=0,updated=0,unchanged=0;
    for(const r of data){
      const old=await this.db.product.findFirst({where:{name:{equals:r.name,mode:'insensitive'},storeId:r.storeId}});
      if(old&&updateExisting){if(Number(old.priceUsd)!==r.priceUsd){await this.db.product.update({where:{id:old.id},data:{priceUsd:r.priceUsd}});updated++;}else unchanged++;}
      else if(!old){await this.db.product.create({data:{storeId:r.storeId,name:r.name,category:r.category,classification:r.classification,brand:r.brand,unit:r.unit,stock:0,priceUsd:r.priceUsd}});created++;}
    }
    return {confirm:true,total:data.length,created,updated,unchanged,stockUpdated:0};
  }
}

@Roles('ACCOUNTANT')
@Controller('accountant/staff')
class StaffExcelController{
  constructor(private db:PrismaService,private audit:AuditService){}
  @Get('import-format.xlsx') format(@Res()res:Response){
    const headers=['username','email','firstName','lastName','phone','nationalId','role','adminSubrole','password','pin'];
    const b=workbookBuffer(headers,[{username:'usuario.demo',email:'demo@krediplus.app',firstName:'Nombre',lastName:'Apellido',phone:'',nationalId:'',role:'WAREHOUSE',adminSubrole:'',password:'CAMBIAR123!',pin:'123456'}]);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=KrediPlus_Personal.xlsx');res.send(b);
  }
  @Get('export.xlsx') async export(@Res()res:Response){
    const users=await this.db.user.findMany({where:{roles:{some:{role:{code:{in:['ADMIN','WAREHOUSE','STOREKEEPER']}}}}},include:{roles:{include:{role:true}}}});
    const out=users.map(u=>({username:u.username,email:u.email,firstName:u.firstName,lastName:u.lastName,phone:u.phone||'',nationalId:u.nationalId||'',role:u.roles.map(r=>r.role.code==='STOREKEEPER'?'WAREHOUSE':r.role.code).join(','),adminSubrole:u.adminSubrole||''}));
    const ws=XLSX.utils.json_to_sheet(out);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Personal');const b=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename=KrediPlus_Personal_Exportado.xlsx');res.send(b);
  }
  @Post('import') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024}}))
  async import(@CurrentUser()actor:any,@UploadedFile()file:Express.Multer.File,@Body()body:any,@Query('confirm')queryConfirm='false'){
    const confirm=String(body?.confirm??queryConfirm)==='true';
    const allowedAdminSubroles=['GENERAL','SUPERVISOR','ANALYST','SUPPORT','AUDITOR','ANTIFRAUD'];
    const data=rows(file).map((r:any,i:number)=>{
      let role=String(r.role||r.rol||'WAREHOUSE').trim().toUpperCase();if(['STOREKEEPER','ALMACENISTA'].includes(role))role='WAREHOUSE';
      return {row:i+2,username:String(r.username||r.usuario||'').trim(),email:String(r.email||r.correo||'').trim().toLowerCase(),firstName:String(r.firstName||r.nombre||'').trim(),lastName:String(r.lastName||r.apellido||'').trim(),phone:String(r.phone||r.telefono||'').trim()||null,nationalId:String(r.nationalId||r.cedula||'').trim()||null,role,adminSubrole:String(r.adminSubrole||r.subrol||r.perfil||'GENERAL').trim().toUpperCase(),password:String(r.password||r.clave||''),pin:String(r.pin||'').trim()};
    });
    const errors=[] as any[];
    for(const r of data){
      if(!r.username||!r.email||!r.firstName||!r.lastName||r.password.length<8)errors.push({row:r.row,error:'Usuario, correo, nombre, apellido y clave de 8+ caracteres son obligatorios'});
      if(!/^\d{6}$/.test(r.pin))errors.push({row:r.row,error:'PIN obligatorio de exactamente 6 dígitos'});
      if(!['ADMIN','WAREHOUSE'].includes(r.role))errors.push({row:r.row,error:'Solo se permite crear Administrador o Almacenista; Contador se crea desde backend'});
      if(r.role==='ADMIN'&&!allowedAdminSubroles.includes(r.adminSubrole))errors.push({row:r.row,error:'Perfil administrativo inválido'});
    }
    if(!confirm||errors.length)return {confirm:false,total:data.length,valid:data.length-new Set(errors.map(e=>e.row)).size,errors,preview:data.map(({password,pin,...r})=>r).slice(0,100)};
    let created=0,skipped=0;
    for(const r of data){
      const exists=await this.db.user.findFirst({where:{OR:[{username:r.username},{email:r.email}]}});if(exists){skipped++;continue;}
      const role=await this.db.role.findUnique({where:{code:r.role}});if(!role){skipped++;continue;}
      const u=await this.db.user.create({data:{username:r.username,email:r.email,firstName:r.firstName,lastName:r.lastName,phone:r.phone,nationalId:r.nationalId,adminSubrole:r.role==='ADMIN'?r.adminSubrole:'WAREHOUSE',passwordHash:await bcrypt.hash(r.password,12),pinHash:await bcrypt.hash(r.pin,12),status:'ACTIVE',emailVerifiedAt:new Date()}});
      await this.db.userRole.create({data:{userId:u.id,roleId:role.id}});created++;
      await this.audit.write(actor.sub,'STAFF_EXCEL_CREATE','User',String(u.id),{role:r.role,adminSubrole:u.adminSubrole},'Importación Excel de personal');
    }
    return {confirm:true,total:data.length,created,skipped};
  }
}
@Module({controllers:[ProductExcelController,StaffExcelController]}) export class ExcelModule{}
