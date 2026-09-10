import { Body, Controller, Injectable, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
@Injectable()
export class StorageService {
  private client?:S3Client;
  private getClient(){
    const endpoint=process.env.S3_ENDPOINT, region=process.env.S3_REGION||'auto', accessKeyId=process.env.S3_ACCESS_KEY_ID, secretAccessKey=process.env.S3_SECRET_ACCESS_KEY;
    if(!endpoint||!accessKeyId||!secretAccessKey) throw new ServiceUnavailableException('Almacenamiento S3/R2 no configurado');
    return this.client ||= new S3Client({endpoint,region,forcePathStyle:false,credentials:{accessKeyId,secretAccessKey}});
  }

  async uploadBuffer(userId:number,kind:string,buffer:Buffer,contentType='image/jpeg'){
    const bucket=process.env.S3_BUCKET||'krediplus';
    const safe=kind.replace(/[^a-z0-9_-]/gi,'_').toLowerCase();
    const key=`verification/${userId}/${Date.now()}_${safe}.jpg`;
    await this.getClient().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:buffer,ContentType:contentType}));
    const publicBase=(process.env.S3_PUBLIC_BASE_URL||'').replace(/\/$/,'');
    return {key,publicUrl:publicBase?`${publicBase}/${key}`:`s3://${bucket}/${key}`};
  }
  async presign(userId:number,kind:string,contentType:string){
    const bucket=process.env.S3_BUCKET||'krediplus';
    const safe=kind.replace(/[^a-z0-9_-]/gi,'_').toLowerCase();
    const key=`verification/${userId}/${Date.now()}_${safe}.jpg`;
    const uploadUrl=await getSignedUrl(this.getClient(),new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType||'image/jpeg'}),{expiresIn:600});
    const publicBase=(process.env.S3_PUBLIC_BASE_URL||'').replace(/\/$/,'');
    return {key,uploadUrl,expiresIn:600,publicUrl:publicBase?`${publicBase}/${key}`:`s3://${bucket}/${key}`};
  }
}
@Controller('uploads') class StorageController{constructor(private s:StorageService){} @Post('presign') presign(@CurrentUser()u:any,@Body()b:any){return this.s.presign(u.sub,String(b.kind||'capture'),String(b.contentType||'image/jpeg'))}}
@Module({controllers:[StorageController],providers:[StorageService],exports:[StorageService]}) export class StorageModule{}
