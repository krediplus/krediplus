import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

function mergeQuality(previous: unknown, key: string, value: unknown) {
  const base = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
  return { ...base, [key]: value ?? {} };
}

@Controller()
export class CaptureController {
  constructor(private readonly db: PrismaService) {}

  @Get('capture/config/:type')
  config(@Param('type') type: string) {
    const selfie = type.toLowerCase().includes('selfie');
    return selfie ? {
      captureType: 'SELFIE',
      autoCapture: true,
      stableMs: Number(process.env.CAPTURE_SELFIE_STABLE_MS || 800),
      minStability: Number(process.env.CAPTURE_SELFIE_MIN_STABILITY || 0.90),
      minSharpness: Number(process.env.CAPTURE_SELFIE_MIN_SHARPNESS || 0.58),
      maxGlare: Number(process.env.CAPTURE_SELFIE_MAX_GLARE || 0.20),
      faceCoverage: {
        min: Number(process.env.CAPTURE_SELFIE_MIN_COVERAGE || 0.10),
        max: Number(process.env.CAPTURE_SELFIE_MAX_COVERAGE || 0.32),
      },
      oneFaceOnly: true,
      distanceMode: 'estimated_coverage_band',
      messages: { far: 'Acércate', near: 'Aléjate', unstable: 'Mantén el teléfono quieto' },
      liveness: { enabled: false, note: 'Preparado para proveedor KYC/liveness especializado.' },
    } : {
      captureType: type.toUpperCase(),
      autoCapture: true,
      stableMs: Number(process.env.CAPTURE_ID_STABLE_MS || 750),
      minStability: Number(process.env.CAPTURE_ID_MIN_STABILITY || 0.92),
      minSharpness: Number(process.env.CAPTURE_ID_MIN_SHARPNESS || 0.72),
      maxGlare: Number(process.env.CAPTURE_ID_MAX_GLARE || 0.18),
      frameCoverage: {
        min: Number(process.env.CAPTURE_ID_MIN_FRAME_COVERAGE || 0.40),
        max: Number(process.env.CAPTURE_ID_MAX_FRAME_COVERAGE || 0.82),
      },
      documentSignals: ['guided_frame', 'ocr_text_bounds', 'sharpness', 'glare', 'stability'],
      distanceMode: 'estimated_coverage_band',
      messages: { far: 'Acerca la cédula', near: 'Aleja la cédula', unstable: 'Mantén el teléfono quieto' },
    };
  }

  @Get('verification/me')
  async me(@CurrentUser() u: any) {
    const verification = await this.db.verification.findFirst({
      where: { userId: u.sub, type: 'IDENTITY' },
      orderBy: { createdAt: 'desc' },
    });
    return verification ?? { type: 'IDENTITY', status: 'PENDING', frontUrl: null, backUrl: null, selfieUrl: null, quality: null };
  }

  @Post('verification/:kind')
  async submit(@CurrentUser() u: any, @Param('kind') kind: string, @Body() body: any) {
    const normalized = kind.toLowerCase();
    const current = await this.db.verification.findFirst({
      where: { userId: u.sub, type: 'IDENTITY' },
      orderBy: { createdAt: 'desc' },
    });
    const data: any = { status: 'PENDING' };
    if (normalized.includes('selfie')) data.selfieUrl = body.selfieUrl || body.url || null;
    else if (normalized.includes('back') || normalized.includes('reverse') || normalized.includes('reverso')) data.backUrl = body.backUrl || body.url || null;
    else data.frontUrl = body.frontUrl || body.url || null;
    data.quality = mergeQuality(current?.quality, normalized, body.quality);

    const saved = current
      ? await this.db.verification.update({ where: { id: current.id }, data })
      : await this.db.verification.create({ data: { userId: u.sub, type: 'IDENTITY', ...data } });

    const complete = Boolean(saved.selfieUrl && saved.frontUrl && saved.backUrl);
    const finalRecord = complete && saved.status !== 'APPROVED'
      ? await this.db.verification.update({ where: { id: saved.id }, data: { status: 'REVIEWING' } })
      : saved;

    if (complete) {
      const exists = await this.db.notification.findFirst({ where: { userId: u.sub, type: 'IDENTITY_SUBMITTED', readAt: null } });
      if (!exists) await this.db.notification.create({ data: {
        userId: u.sub,
        type: 'IDENTITY_SUBMITTED',
        title: 'Verificación enviada',
        body: 'Recibimos tu selfie y ambos lados de la cédula. Te avisaremos cuando termine la revisión.',
        data: { destination: 'identityVerification' },
      }});
    }
    return finalRecord;
  }
}

@Module({ controllers: [CaptureController] })
export class CaptureModule {}
