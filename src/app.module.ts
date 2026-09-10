import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthGuard, RolesGuard } from './common/auth';
import { CoreModule } from './common/core.module';
import { PermissionsGuard } from './common/permissions';
import { AuthModule } from './modules/auth.module';
import { HealthModule } from './modules/health.module';
import { ProfileModule } from './modules/profile.module';
import { CatalogsModule } from './modules/catalogs.module';
import { MobileModule } from './modules/mobile.module';
import { CatalogModule } from './modules/catalog.module';
import { CreditModule } from './modules/credit.module';
import { PurchasesModule } from './modules/purchases.module';
import { PaymentsModule } from './modules/payments.module';
import { LoyaltyModule } from './modules/loyalty.module';
import { ReferralsModule } from './modules/referrals.module';
import { NotificationsModule } from './modules/notifications.module';
import { CaptureModule } from './modules/capture.module';
import { AdminModule } from './modules/admin.module';
import { AccountantModule } from './modules/accountant.module';
import { QueueModule } from './modules/queue.module';
import { StorageModule } from './modules/storage.module';
import { ExcelModule } from './modules/excel.module';
import { LegacyCompatModule } from './modules/legacy-compat.module';
import { ServicesModule } from './modules/services.module';
import { WarehouseModule } from './modules/warehouse.module';
@Module({
  imports:[ConfigModule.forRoot({isGlobal:true}),CoreModule,AuthModule,HealthModule,ProfileModule,CatalogsModule,MobileModule,CatalogModule,CreditModule,PurchasesModule,PaymentsModule,LoyaltyModule,ReferralsModule,NotificationsModule,CaptureModule,AdminModule,AccountantModule,QueueModule,StorageModule,ExcelModule,ServicesModule,WarehouseModule,LegacyCompatModule],
  providers:[{provide:APP_GUARD,useClass:JwtAuthGuard},{provide:APP_GUARD,useClass:RolesGuard},{provide:APP_GUARD,useClass:PermissionsGuard}]
})
export class AppModule {}
