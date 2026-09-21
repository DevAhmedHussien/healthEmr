import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, ApiZodBody } from '@/shared/http/api-docs';
import {
  Role,
  pharmacyCategoryInputSchema,
  pharmacyCategoryUpdateSchema,
  pharmacyInputSchema,
  pharmacyProductInputSchema,
  pharmacyProductUpdateSchema,
  pharmacyUpdateSchema,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { PharmacyCatalogService } from './pharmacy-catalog.service';

class PharmacyDto extends createZodDto(pharmacyInputSchema) {}
class PharmacyPatchDto extends createZodDto(pharmacyUpdateSchema) {}
class CategoryDto extends createZodDto(pharmacyCategoryInputSchema) {}
class CategoryPatchDto extends createZodDto(pharmacyCategoryUpdateSchema) {}
class ProductDto extends createZodDto(pharmacyProductInputSchema) {}
class ProductPatchDto extends createZodDto(pharmacyProductUpdateSchema) {}

/**
 * Pharmacy and catalogue administration.
 *
 * Super Admin only. Pharmacies and their products are platform assets — a tenant
 * admin may choose between the pharmacies contracted to them, but cannot invent
 * one or change what it stocks.
 */
@ApiStandardErrors()
@ApiParam({ name: 'pharmacyId', format: 'uuid', required: false })
@ApiTags('system: pharmacies')
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'super-admin/pharmacies', version: '1' })
export class PharmacyCatalogController {
  constructor(private readonly catalog: PharmacyCatalogService) {}

  @Get()
  @ApiOperation({
    summary: 'All pharmacies',
    description:
      'Includes how many catalogue categories, products and contracted tenants each one has. ' +
      'Small, bounded set — deliberately unpaginated.',
  })
  async list() {
    return { data: await this.catalog.listPharmacies() };
  }

  @Post()
  @ApiOperation({
    summary: 'Add a pharmacy',
    description:
      'Capability flags matter: a branded medication cannot be routed to a compounding-only ' +
      'pharmacy, and intake rejects that combination before a visit is created.',
  })
  @ApiZodBody(PharmacyDto)
  create(@Body() body: PharmacyDto) {
    return this.catalog.createPharmacy(body);
  }

  @Patch(':pharmacyId')
  @ApiOperation({
    summary: 'Update a pharmacy',
    description: 'Partial update. Setting `isActive: false` removes it from tenant-facing lookups.',
  })
  @ApiZodBody(PharmacyPatchDto)
  update(@Param('pharmacyId', ParseUUIDPipe) pharmacyId: string, @Body() body: PharmacyPatchDto) {
    return this.catalog.updatePharmacy(pharmacyId, body);
  }

  // ── categories ─────────────────────────────────────────────────────────

  @Get(':pharmacyId/categories')
  @ApiOperation({
    summary: 'Categories this pharmacy groups its stock into',
    description: 'Ordered by `sortOrder`, then name. Includes the product count in each.',
  })
  async categories(@Param('pharmacyId', ParseUUIDPipe) pharmacyId: string) {
    return { data: await this.catalog.listCategories(pharmacyId) };
  }

  @Post(':pharmacyId/categories')
  @ApiOperation({
    summary: 'Add a category to a pharmacy',
    description:
      "A pharmacy's own grouping of its stock. Distinct from the clinical category that drives " +
      'questionnaires and provider qualification — two pharmacies routinely group the same drug ' +
      'differently. Link one with `clinicalCategorySlug` when the mapping is meaningful.',
  })
  @ApiZodBody(CategoryDto)
  createCategory(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Body() body: CategoryDto,
  ) {
    return this.catalog.createCategory(pharmacyId, body);
  }

  @Patch(':pharmacyId/categories/:categoryId')
  @ApiOperation({ summary: 'Update a category', description: 'Partial update.' })
  @ApiZodBody(CategoryPatchDto)
  updateCategory(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: CategoryPatchDto,
  ) {
    return this.catalog.updateCategory(pharmacyId, categoryId, body);
  }

  @Delete(':pharmacyId/categories/:categoryId')
  @ApiOperation({
    summary: 'Remove a category',
    description:
      'Deactivates rather than deletes when the category still holds products: a kit code that has ' +
      'appeared on a dispensed order should stop being orderable, not stop having existed.',
  })
  removeCategory(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.catalog.removeCategory(pharmacyId, categoryId);
  }

  // ── products ───────────────────────────────────────────────────────────

  @Get(':pharmacyId/categories/:categoryId/products')
  @ApiOperation({
    summary: 'Products inside a category',
    description: 'Each carries kit code, favourite name, medication, concentration, vial size and cost of goods.',
  })
  async products(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return { data: await this.catalog.listProducts(pharmacyId, categoryId) };
  }

  @Post(':pharmacyId/categories/:categoryId/products')
  @ApiOperation({
    summary: 'Add a product to a category',
    description:
      'Fields: `kitCode` is the code the pharmacy\'s own system expects on an order; ' +
      '`favouriteName` is the internal shorthand staff recognise; plus medication name, ' +
      'concentration, dosage form, vial size, days supply and cost of goods in whole cents.',
  })
  @ApiZodBody(ProductDto)
  createProduct(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: ProductDto,
  ) {
    return this.catalog.createProduct(pharmacyId, categoryId, body);
  }

  @Patch(':pharmacyId/products/:productId')
  @ApiOperation({
    summary: 'Update a product',
    description: 'Partial update. `costOfGoodsCents` is whole cents, never a decimal.',
  })
  @ApiZodBody(ProductPatchDto)
  updateProduct(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: ProductPatchDto,
  ) {
    return this.catalog.updateProduct(pharmacyId, productId, body);
  }

  @Delete(':pharmacyId/products/:productId')
  @ApiOperation({
    summary: 'Remove a product',
    description:
      'Retires rather than deletes if the product has ever been ordered, so dispensing history ' +
      'keeps its referent.',
  })
  removeProduct(
    @Param('pharmacyId', ParseUUIDPipe) pharmacyId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.catalog.removeProduct(pharmacyId, productId);
  }
}
