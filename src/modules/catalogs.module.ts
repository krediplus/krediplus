import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly db: PrismaService) {}

  @Get('states')
  states() { return this.db.state.findMany({ orderBy: { name: 'asc' } }); }

  @Get('states/:id/municipalities')
  municipalities(@Param('id') id: string) {
    return this.db.municipality.findMany({ where: { stateId: Number(id) }, orderBy: { name: 'asc' } });
  }

  @Get('municipalities/:id/parishes')
  parishes(@Param('id') id: string) {
    return this.db.parish.findMany({ where: { municipalityId: Number(id) }, orderBy: { name: 'asc' } });
  }

  @Get('parishes/:id/communities')
  communities(@Param('id') id: string) {
    return this.db.community.findMany({ where: { parishId: Number(id), active: true }, orderBy: { name: 'asc' } });
  }

  // Registro Flutter usa nombres porque municipios/parroquias provienen del catálogo territorial
  // oficial consultado por la app. Esto evita forzar IDs locales incompletos.
  @Get('registration-communities')
  async registrationCommunities(
    @Query('state') state?: string,
    @Query('municipality') municipality?: string,
    @Query('parish') parish?: string,
  ) {
    if (!parish?.trim()) return [];
    const rows = await this.db.community.findMany({
      where: {
        active: true,
        parish: {
          name: { equals: parish.trim(), mode: 'insensitive' },
          municipality: {
            ...(municipality?.trim() ? { name: { equals: municipality.trim(), mode: 'insensitive' } } : {}),
            ...(state?.trim() ? { state: { name: { equals: state.trim(), mode: 'insensitive' } } } : {}),
          },
        },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return rows;
  }

  @Get('banks')
  banks() { return this.db.bank.findMany({ where: { active: true }, orderBy: { name: 'asc' } }); }

  @Get('product-taxonomy')
  async taxonomy() {
    const products = await this.db.product.findMany({ select: { category: true, classification: true, brand: true } });
    return {
      categories: [...new Set(products.map(x => x.category).filter(Boolean))].sort(),
      classifications: [...new Set(products.map(x => x.classification).filter(Boolean))].sort(),
      brands: [...new Set(products.map(x => x.brand).filter(Boolean))].sort(),
    };
  }
}

@Module({ controllers: [CatalogsController] })
export class CatalogsModule {}
