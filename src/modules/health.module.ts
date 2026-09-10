import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../common/auth';
@Controller('health') class HealthController { @Public() @Get() health(){ return {ok:true,service:'krediplus-api-v2',version:'2.2.0',time:new Date().toISOString()}; } }
@Module({controllers:[HealthController]}) export class HealthModule {}
