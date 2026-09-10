import { Injectable, Module, OnModuleDestroy } from '@nestjs/common'; import IORedis from 'ioredis';
@Injectable() export class QueueService implements OnModuleDestroy { private redis?:IORedis; connection(){if(!process.env.REDIS_URL)return null;if(!this.redis)this.redis=new IORedis(process.env.REDIS_URL,{maxRetriesPerRequest:null});return this.redis} async onModuleDestroy(){if(this.redis)await this.redis.quit()} }
@Module({providers:[QueueService],exports:[QueueService]}) export class QueueModule {}
