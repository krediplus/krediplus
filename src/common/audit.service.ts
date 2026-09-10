import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Injectable()
export class AuditService {
  constructor(private db: PrismaService) {}
  async write(actorUserId:number|undefined, action:string, entityType:string, entityId?:string, next?:any, reason?:string) {
    return this.db.auditLog.create({data:{actorUserId,action,entityType,entityId,next,reason}});
  }
}
