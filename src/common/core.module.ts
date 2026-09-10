import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { BootstrapService } from './bootstrap.service';
@Global()
@Module({providers:[PrismaService,AuditService,BootstrapService],exports:[PrismaService,AuditService]})
export class CoreModule {}
