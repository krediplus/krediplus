import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser, Roles } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageModule, StorageService } from './storage.module';
import * as XLSX from 'xlsx';

const PRODUCT_ALIASES:Record<string,string[]>= {
  name:['name','nombre','producto','nombre del producto','descripcion del producto'],
  category:['category','categoria','categoría','categoria principal','categoría principal','tipo de producto'],
  classification:['classification','clasificacion','clasificación','subcategoria','subcategoría','clasificacion del producto'],
  brand:['brand','marca','fabricante'],
  unit:['unit','unidad','presentacion','presentación','unidad de medida'],
  pricingMode:['pricingmode','pricing mode','forma de precio','modalidad de precio','tipo de precio'],
  priceUsd:['priceindividualusd','precioindividualusd','priceusd','precio usd','precio (usd)','precio en usd','precio dolares','precio dólares','precio'],
  minimumStock:['minimumstock','existencia minima','existencia mínima','stock minimo','stock mínimo','minimo','mínimo'],
  storeId:['storeid','store id','tienda id','negocio id'],
};
function normalized(value:any){return String(value??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function aliasMap(){const out=new Map<string,string>();for(const [key,values] of Object.entries(PRODUCT_ALIASES))for(const value of values)out.set(normalized(value),key);return out;}
const PRODUCT_ALIAS_MAP=aliasMap();

function readRows(file?:Express.Multer.File){
  if(!file?.buffer) throw new BadRequestException('Archivo Excel requerido');
  let wb:XLSX.WorkBook;
  try{wb=XLSX.read(file.buffer,{type:'buffer'});}catch{throw new BadRequestException('No fue posible leer el Excel. Verifica que sea un archivo .xlsx o .xls válido.');}
  const result:any[]=[];
  for(const sheetName of wb.SheetNames){
    if(['leeme','leer','instrucciones','readme','ayuda','notas','informacion','info','clasificaciones'].includes(normalized(sheetName)))continue;
    const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,defval:'',raw:false});
    if(!matrix.length)continue;
    let headerIndex=-1;let mappedHeaders:string[]=[];let best=0;
    for(let i=0;i<Math.min(matrix.length,12);i++){
      const row=Array.isArray(matrix[i])?matrix[i]:[];const mapped=row.map(v=>PRODUCT_ALIAS_MAP.get(normalized(v))||'');const recognized=new Set(mapped.filter(Boolean)).size;
      if(recognized>best&&recognized>=3){best=recognized;headerIndex=i;mappedHeaders=mapped;}
    }
    if(headerIndex<0)continue;
    for(let i=headerIndex+1;i<matrix.length&&result.length<2000;i++){
      const row=Array.isArray(matrix[i])?matrix[i]:[];const item:any={__sheet:sheetName,__row:i+1};let meaningful=false;
      for(let c=0;c<mappedHeaders.length;c++){const key=mappedHeaders[c];if(!key)continue;const value=row[c]??'';item[key]=value;if(String(value).trim())meaningful=true;}
      if(meaningful)result.push(item);
    }
  }
  if(!result.length)throw new BadRequestException('No se encontraron productos importables. Verifica los encabezados del Excel.');
  return result;
}
function excelBuffer(rows:any[], headers?:string[]){
  const ws=XLSX.utils.json_to_sheet(rows.length?rows:[Object.fromEntries((headers||[]).map(h=>[h,'']))],headers?{header:headers}:undefined);
  if(headers)ws['!cols']=headers.map(h=>({wch:Math.max(14,h.length+2)}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Productos');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
function numOrNull(v:any){if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;}

@Roles('WAREHOUSE','STOREKEEPER')
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly db:PrismaService, private readonly audit:AuditService, private readonly storage:StorageService){}

  @Get('dashboard')
  async dashboard(){
    const [activeProducts,outOfStock,pendingOrders,preparingOrders,readyOrders,recent]=await Promise.all([
      this.db.product.findMany({where:{active:true},select:{stock:true,minimumStock:true}}),
      this.db.product.count({where:{active:true,stock:0}}),
      this.db.purchase.count({where:{status:'PAID',OR:[{warehouseStatus:null},{warehouseStatus:'PENDING'}]}}),
      this.db.purchase.count({where:{warehouseStatus:{in:['PREPARING','STOCK_SHORTAGE']}}}),
      this.db.purchase.count({where:{warehouseStatus:'READY'}}),
      this.db.inventoryMovement.findMany({include:{product:true},orderBy:{createdAt:'desc'},take:8}),
    ]);
    const lowStock=activeProducts.filter(p=>p.stock<=p.minimumStock).length;
    return {products:activeProducts.length,lowStock,outOfStock,pendingOrders,preparingOrders,readyOrders,recentMovements:recent};
  }

  @Get('products')
  products(@Query('q')q?:string,@Query('stock')stock?:string){
    const term=(q||'').trim();const stockMode=String(stock||'').toUpperCase();
    return this.db.product.findMany({
      where:{active:true,...(term?{OR:[{name:{contains:term,mode:'insensitive'}},{brand:{contains:term,mode:'insensitive'}},{category:{contains:term,mode:'insensitive'}}]}:{}),...(stockMode==='OUT'?{stock:0}:{})},
      orderBy:[{stock:'asc'},{name:'asc'}],take:500
    });
  }

  @Post('products')
  async createProduct(@CurrentUser()u:any,@Body()b:any){
    if(!String(b.name||'').trim()||!String(b.category||'').trim()) throw new BadRequestException('Nombre y categoría son obligatorios');
    const price=Number(b.priceUsd); if(!Number.isFinite(price)||price<0) throw new BadRequestException('Precio inválido');
    const minimumStock=Number(b.minimumStock??5);if(!Number.isInteger(minimumStock)||minimumStock<0)throw new BadRequestException('Existencia mínima inválida');
    const pricingMode=String(b.pricingMode||'UNIT').trim().toUpperCase();if(!['UNIT','KG'].includes(pricingMode))throw new BadRequestException('Forma de precio inválida');
    const p=await this.db.product.create({data:{
      storeId:b.storeId?Number(b.storeId):null,name:String(b.name).trim(),description:b.description||null,category:String(b.category).trim(),
      classification:b.classification||null,brand:b.brand||null,unit:pricingMode==='KG'?'kg':(b.unit||null),priceUsd:price,pricingMode,minimumStock,stock:0,active:b.active!==false,imageUrl:b.imageUrl||null
    }});
    await this.audit.write(u.sub,'WAREHOUSE_PRODUCT_CREATE','Product',String(p.id),{name:p.name,priceUsd:Number(p.priceUsd),stock:0,minimumStock},b.reason);
    return p;
  }

  @Patch('products/:id')
  async updateProduct(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){
    const current=await this.db.product.findUnique({where:{id:Number(id)}}); if(!current) throw new BadRequestException('Producto no encontrado');
    const data:any={};
    for(const k of ['name','description','category','classification','brand','unit','active','imageUrl','storeId']) if(b[k]!==undefined)data[k]=b[k];
    if(b.priceUsd!==undefined){const p=Number(b.priceUsd);if(!Number.isFinite(p)||p<0)throw new BadRequestException('Precio inválido');data.priceUsd=p;}
    if(b.minimumStock!==undefined){const n=Number(b.minimumStock);if(!Number.isInteger(n)||n<0)throw new BadRequestException('Existencia mínima inválida');data.minimumStock=n;}
    if(b.pricingMode!==undefined){const mode=String(b.pricingMode).trim().toUpperCase();if(!['UNIT','KG'].includes(mode))throw new BadRequestException('Forma de precio inválida');data.pricingMode=mode;if(mode==='KG')data.unit='kg';}
    const out=await this.db.product.update({where:{id:Number(id)},data});
    await this.audit.write(u.sub,'WAREHOUSE_PRODUCT_UPDATE','Product',id,{...data,stockIgnored:b.stock!==undefined},b.reason);
    return out;
  }

  @Post('products/:id/image')
  @UseInterceptors(FileInterceptor('image',{limits:{fileSize:8*1024*1024}}))
  async productImage(@CurrentUser()u:any,@Param('id')id:string,@UploadedFile()file:Express.Multer.File){
    if(!file?.buffer)throw new BadRequestException('Selecciona una imagen');
    if(!String(file.mimetype||'').startsWith('image/'))throw new BadRequestException('El archivo debe ser una imagen');
    const product=await this.db.product.findUnique({where:{id:Number(id)}});if(!product)throw new BadRequestException('Producto no encontrado');
    const uploaded=await this.storage.uploadBuffer(u.sub,'product_image',file.buffer,file.mimetype||'image/jpeg');
    const updated=await this.db.product.update({where:{id:Number(id)},data:{imageUrl:uploaded.publicUrl}});
    await this.audit.write(u.sub,'WAREHOUSE_PRODUCT_IMAGE','Product',id,{imageUrl:uploaded.publicUrl},'Imagen de producto actualizada');
    return updated;
  }

  @Get('movements')
  movements(@Query('productId')productId?:string){
    const id=productId?Number(productId):undefined;if(productId&&(!Number.isInteger(id)||!id))throw new BadRequestException('Producto inválido');
    return this.db.inventoryMovement.findMany({where:id?{productId:id}:{},include:{product:true},orderBy:{createdAt:'desc'},take:500});
  }

  @Post('products/:id/movements')
  async movement(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){
    const productId=Number(id); const type=String(b.type||'').trim().toUpperCase(); const reason=String(b.reason||'').trim();
    if(!Number.isInteger(productId)||productId<=0)throw new BadRequestException('Producto inválido');
    if(!['ENTRY','EXIT','ADJUSTMENT'].includes(type)) throw new BadRequestException('Tipo de movimiento inválido');
    if(reason.length<3) throw new BadRequestException('Indica el motivo del movimiento');
    const result=await this.db.$transaction(async tx=>{
      const p=await tx.product.findUnique({where:{id:productId}}); if(!p)throw new BadRequestException('Producto no encontrado');
      let next=p.stock; let quantity=Number(b.quantity||0);
      if(type==='ENTRY'){if(!Number.isInteger(quantity)||quantity<=0)throw new BadRequestException('Cantidad de entrada inválida');next=p.stock+quantity;}
      if(type==='EXIT'){if(!Number.isInteger(quantity)||quantity<=0)throw new BadRequestException('Cantidad de salida inválida');if(quantity>p.stock)throw new BadRequestException('La salida supera la existencia');next=p.stock-quantity;}
      if(type==='ADJUSTMENT'){next=Number(b.newStock);if(!Number.isInteger(next)||next<0)throw new BadRequestException('Existencia final inválida');quantity=Math.abs(next-p.stock);}
      const updated=await tx.product.update({where:{id:productId},data:{stock:next}});
      const inventoryMovement=await tx.inventoryMovement.create({data:{productId,type,quantity,previousStock:p.stock,newStock:next,reason,actorUserId:u.sub}});
      return {product:updated,movement:inventoryMovement};
    });
    await this.audit.write(u.sub,'WAREHOUSE_STOCK_MOVEMENT','Product',id,{type,quantity:result.movement.quantity,previousStock:result.movement.previousStock,newStock:result.movement.newStock},reason);
    return result;
  }

  @Get('orders')
  orders(@Query('fairId')fairId?:string,@Query('warehouseStatus')warehouseStatus?:string){
    const fair= fairId?Number(fairId):undefined;if(fairId&&(!Number.isInteger(fair)||!fair))throw new BadRequestException('Jornada inválida');
    const status=String(warehouseStatus||'').trim().toUpperCase();
    return this.db.purchase.findMany({where:{status:{in:['PAID','PENDING']},...(fair?{fairId:fair}:{}),...(status?{warehouseStatus:status}:{})},include:{user:true,store:true,items:{include:{product:true}}},orderBy:{createdAt:'desc'},take:300});
  }

  @Patch('orders/:id/status')
  async orderStatus(@CurrentUser()u:any,@Param('id')id:string,@Body()b:any){
    const next=String(b.status||'').trim().toUpperCase().replace(/\s+/g,'_');
    const allowed=['PREPARING','READY','DELIVERED','STOCK_SHORTAGE','RETURNED','CANCELLED'];
    if(!allowed.includes(next)) throw new BadRequestException('Estado de almacén inválido');
    const notes=String(b.notes||'').trim()||null;
    const orderId=Number(id);if(!Number.isInteger(orderId)||orderId<=0)throw new BadRequestException('Pedido inválido');
    const out=await this.db.$transaction(async tx=>{
      const current=await tx.purchase.findUnique({where:{id:orderId}});if(!current)throw new BadRequestException('Pedido no encontrado');
      const wh=String(current.warehouseStatus||'PENDING').toUpperCase();
      let transitions:string[]=[];
      if(wh==='PENDING'){
        if(current.status!=='PAID')throw new BadRequestException('El pago debe estar verificado antes de preparar el pedido.');
        transitions=['PREPARING','CANCELLED'];
      }else if(['PREPARING','STOCK_SHORTAGE'].includes(wh))transitions=['PREPARING','READY','STOCK_SHORTAGE','CANCELLED'];
      else if(wh==='READY')transitions=['DELIVERED','RETURNED','CANCELLED'];
      else if(wh==='DELIVERED')transitions=['RETURNED'];
      if(!transitions.includes(next))throw new BadRequestException(`La transición de ${wh} a ${next} no está permitida.`);
      const updated=await tx.purchase.update({where:{id:orderId},data:{warehouseStatus:next,warehouseNotes:notes,warehouseUpdatedBy:u.sub,warehouseUpdatedAt:new Date()}});
      const body=next==='PREPARING'?`Tu pedido #${orderId} está en preparación.`:next==='READY'?`Tu pedido #${orderId} está listo para entregar.`:next==='DELIVERED'?`La entrega del pedido #${orderId} fue confirmada.`:next==='STOCK_SHORTAGE'?`El pedido #${orderId} presenta una existencia incompleta.`:next==='RETURNED'?`El pedido #${orderId} fue registrado como devuelto.`:`El pedido #${orderId} fue cancelado.`;
      await tx.notification.create({data:{userId:current.userId,type:'WAREHOUSE_ORDER_STATUS',title:'Actualización de tu pedido',body,data:{destination:'purchases',purchaseId:orderId,status:next}}});
      return updated;
    });
    await this.audit.write(u.sub,'WAREHOUSE_ORDER_STATUS','Purchase',id,{warehouseStatus:next},notes||undefined);
    return out;
  }

  @Get('fairs')
  async fairs(){
    const fairs=await this.db.fair.findMany({where:{published:true,finalized:false},orderBy:{startsAt:'asc'},take:100});
    return Promise.all(fairs.map(async fair=>{
      const [pending,preparing,ready]=await Promise.all([
        this.db.purchase.count({where:{fairId:fair.id,status:'PAID',OR:[{warehouseStatus:null},{warehouseStatus:'PENDING'}]}}),
        this.db.purchase.count({where:{fairId:fair.id,warehouseStatus:{in:['PREPARING','STOCK_SHORTAGE']}}}),
        this.db.purchase.count({where:{fairId:fair.id,warehouseStatus:'READY'}}),
      ]);
      return {...fair,pendingOrders:pending,preparingOrders:preparing,readyOrders:ready};
    }));
  }

  @Get('combos')
  async combos(){
    const combos=await this.db.combo.findMany({where:{active:true},include:{items:{include:{product:true}}},orderBy:{name:'asc'}});
    return combos.map(combo=>{
      const shortages=combo.items.filter(i=>i.product.stock<i.quantity).map(i=>({productId:i.productId,name:i.product.name,required:i.quantity,stock:i.product.stock,missing:Math.max(0,i.quantity-i.product.stock)}));
      const maxBuildable=combo.items.length?Math.min(...combo.items.map(i=>Math.floor(i.product.stock/Math.max(1,i.quantity)))):0;
      return {...combo,available:shortages.length===0,maxBuildable,shortages};
    });
  }

  @Get('products/import-format.xlsx')
  format(@Res()res:Response){
    const headers=['Producto','Categoría','Clasificación','Marca','Unidad','Forma de precio','Precio USD','Existencia mínima','Tienda ID'];
    const b=excelBuffer([{'Producto':'Arroz 1kg','Categoría':'Alimentos','Clasificación':'Granos','Marca':'Ejemplo','Unidad':'kg','Forma de precio':'UNIT','Precio USD':2.30,'Existencia mínima':5,'Tienda ID':''}],headers);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=KrediPlus_Productos_Precios.xlsx'); res.send(b);
  }

  @Get('products/export.xlsx')
  async export(@Res()res:Response){
    const products=await this.db.product.findMany({orderBy:{name:'asc'}});
    const rows=products.map(p=>({id:p.id,nombre:p.name,categoria:p.category,clasificacion:p.classification||'',marca:p.brand||'',unidad:p.unit||'',formaPrecio:p.pricingMode,existencia:p.stock,existenciaMinima:p.minimumStock,precioIndividualUsd:Number(p.priceUsd),activo:p.active?'Sí':'No'}));
    const b=excelBuffer(rows);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=KrediPlus_Productos_Exportados.xlsx'); res.send(b);
  }

  @Post('products/import')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024}}))
  async import(@CurrentUser()u:any,@UploadedFile()file:Express.Multer.File,@Body()body:any,@Query('confirm')queryConfirm?:string){
    const confirm=String(body?.confirm??queryConfirm??'false')==='true';
    const data=readRows(file).map((r:any)=>(()=>{
      const price=numOrNull(r.priceUsd);const minimum=numOrNull(r.minimumStock);const mode=String(r.pricingMode||'UNIT').trim().toUpperCase();const store=numOrNull(r.storeId);
      return {row:r.__row,sheet:r.__sheet,name:String(r.name||'').trim(),category:String(r.category||'').trim(),classification:String(r.classification||'').trim()||null,brand:String(r.brand||'').trim()||null,unit:String(r.unit||'').trim()||null,pricingMode:mode,priceUsd:price,minimumStock:minimum===null?null:Number(minimum),storeId:store===null?null:Number(store)};
    })());
    const errors:any[]=[];
    for(const r of data){
      const rowErrors:string[]=[];
      if(!r.name)rowErrors.push('Producto obligatorio');if(!r.category)rowErrors.push('Categoría obligatoria');if(r.priceUsd===null||r.priceUsd<0)rowErrors.push('Precio individual inválido');if(!['UNIT','KG'].includes(r.pricingMode))rowErrors.push('Forma de precio debe ser UNIT o KG');if(r.pricingMode==='UNIT'&&!r.unit)rowErrors.push('Unidad obligatoria');if(r.minimumStock!==null&&(!Number.isInteger(r.minimumStock)||r.minimumStock<0))rowErrors.push('Existencia mínima inválida');
      if(rowErrors.length)errors.push({sheet:r.sheet,row:r.row,error:rowErrors.join(' · ')});
    }
    const preview=[] as any[];
    for(const r of data.slice(0,300)){
      const old=await this.db.product.findFirst({where:{name:{equals:r.name,mode:'insensitive'},storeId:r.storeId}});
      preview.push({...r,action:old?(r.priceUsd!==null&&Number(old.priceUsd)!==r.priceUsd?'ACTUALIZAR_PRECIO':'SIN_CAMBIO'):'CREAR_STOCK_0',currentPriceUsd:old?Number(old.priceUsd):null,currentStock:old?.stock??0});
    }
    if(!confirm||errors.length)return{confirm:false,total:data.length,valid:data.length-new Set(errors.map(e=>`${e.sheet}:${e.row}`)).size,errors,preview};
    let created=0,updated=0,unchanged=0;
    for(const r of data){
      const price=r.priceUsd as number;const old=await this.db.product.findFirst({where:{name:{equals:r.name,mode:'insensitive'},storeId:r.storeId}});
      if(old){
        if(Number(old.priceUsd)!==price){
          await this.db.product.update({where:{id:old.id},data:{priceUsd:price}});updated++;
          await this.audit.write(u.sub,'WAREHOUSE_EXCEL_PRICE_UPDATE','Product',String(old.id),{priceUsd:price,stockPreserved:old.stock},'Importación Excel de precios');
        }else unchanged++;
      } else {
        await this.db.product.create({data:{storeId:r.storeId,name:r.name,category:r.category,classification:r.classification,brand:r.brand,unit:r.pricingMode==='KG'?'kg':r.unit,pricingMode:r.pricingMode,minimumStock:r.minimumStock??5,stock:0,priceUsd:price}});created++;
      }
    }
    return{confirm:true,total:data.length,created,updated,unchanged,stockUpdated:0};
  }
}

@Module({imports:[StorageModule],controllers:[WarehouseController]})
export class WarehouseModule{}
