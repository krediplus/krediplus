import IORedis from 'ioredis';
import { Worker } from 'bullmq';
const url=process.env.REDIS_URL;
if(!url){console.error('REDIS_URL requerido para el worker');process.exit(1);}
const connection=new IORedis(url,{maxRetriesPerRequest:null});
const worker=new Worker('kredi-jobs',async job=>{
  switch(job.name){
    case 'notification': console.log('notification',job.data); return {ok:true};
    case 'document-processing': console.log('document-processing',job.data); return {ok:true};
    case 'reconciliation': console.log('reconciliation',job.data); return {ok:true};
    default: console.log('job',job.name,job.data); return {ok:true};
  }
},{connection});
worker.on('completed',job=>console.log(`job ${job.id} completed`));
worker.on('failed',(job,err)=>console.error(`job ${job?.id} failed`,err));
process.on('SIGTERM',async()=>{await worker.close();await connection.quit();process.exit(0)});
