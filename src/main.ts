import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  const origins = process.env.CORS_ORIGINS || '*';
  app.enableCors({ origin: origins === '*' ? true : origins.split(',').map(v => v.trim()), credentials: true });
  app.setGlobalPrefix('api/v2');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  const config = new DocumentBuilder().setTitle('Kredi+ API 2.2').setDescription('API móvil y administrativa independiente del backend Kotlin legacy').setVersion('2.2.0').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
bootstrap();
