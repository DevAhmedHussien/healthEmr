import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  Role,
  pharmacyCategoryInputSchema,
  pharmacyCategoryUpdateSchema,
  dispensaryProductInputSchema,
  dispensaryProductUpdateSchema,
} from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiStandardErrors, ApiZodBody } from '@/shared/http/api-docs';
import { PharmacyCatalogService } from './pharmacy-catalog.service';
import { FulfilmentService } from './fulfilment.service';

class CategoryDto extends createZodDto(pharmacyCategoryInputSchema) {}
class CategoryPatchDto extends createZodDto(pharmacyCategoryUpdateSchema) {}
// Deliberately the narrowed schemas: a pharmacy states what a product costs us,
// and never what we charge for it. The schemas are `.strict()`, so a pharmacy
// that sends `sellPriceCents` is rejected rather than quietly ignored.
class ProductDto extends createZodDto(dispensaryProductInputSchema) {}
class ProductPatchDto extends createZodDto(dispensaryProductUpdateSchema) {}

/**
 * A pharmacy's own catalogue.
 *
 * The same operations Super Admin has, with one difference that matters: the
 * pharmacy is never a parameter. It is resolved from the signed-in account, so
 * there is no id a pharmacy could change to reach somebody else's stock — the
 * isolation is structural rather than a check somebody has to remember to write.
 *
 * A pharmacy knowing its own kit codes, vial sizes and costs is the point: they
 * are the only party who actually knows them, and a catalogue maintained by
 * relaying spreadsheets to the platform owner is a catalogue that is out of date.
 */
@ApiTags('dispensary')
@Roles(Role.PHARMACY)
@ApiStandardErrors()
@Controller({ path: 'dispensary/catalog', version: '1' })
export class DispensaryCatalogController {
  constructor(
    private readonly catalog: PharmacyCatalogService,
    private readonly fulfilment: FulfilmentService,
  ) {}

  private mine(user: AuthenticatedUser): Promise<string> {
    return this.fulfilment.pharmacyIdForUser(user.id);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'My categories',
    description: 'Every category this pharmacy groups its stock into, with how many products each holds.',
  })
  async categories(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.catalog.listCategories(await this.mine(user)) };
  }

  @Post('categories')
  @ApiOperation({
    summary: 'Add a category',
    description:
      '`defaultDaysSupply` is the length of a normal course here; products added to the category ' +
      'inherit it unless they state their own.',
  })
  @ApiZodBody(CategoryDto)
  async createCategory(@CurrentUser() user: AuthenticatedUser, @Body() body: CategoryDto) {
    return this.catalog.createCategory(await this.mine(user), body);
  }

  @Patch('categories/:categoryId')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOperation({ summary: 'Update a category' })
  @ApiZodBody(CategoryPatchDto)
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: CategoryPatchDto,
  ) {
    return this.catalog.updateCategory(await this.mine(user), categoryId, body);
  }

  @Delete('categories/:categoryId')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove a category',
    description:
      'Deleted outright only while empty. A category holding products is deactivated instead, along ' +
      'with its products — a kit code that has appeared on a dispensed order is history, and should ' +
      'stop being orderable rather than stop having existed.',
  })
  async removeCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return this.catalog.removeCategory(await this.mine(user), categoryId);
  }

  @Get('categories/:categoryId/products')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOperation({ summary: 'Products in one of my categories' })
  async products(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ) {
    return { data: await this.catalog.listProducts(await this.mine(user), categoryId) };
  }

  @Post('categories/:categoryId/products')
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOperation({
    summary: 'Add a product',
    description:
      'Kit ID, favourite name, medication, concentration, form, vial size, days supply and cost of ' +
      'goods. The kit ID is the identifier a client orders by — unique within this pharmacy, and the ' +
      'visit already names the pharmacy. `costOfGoodsCents` is whole cents and is what every margin ' +
      'figure on the platform is built from.',
  })
  @ApiZodBody(ProductDto)
  async createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: ProductDto,
  ) {
    return this.catalog.createProduct(await this.mine(user), categoryId, body);
  }

  @Patch('products/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({ summary: 'Update a product' })
  @ApiZodBody(ProductPatchDto)
  async updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: ProductPatchDto,
  ) {
    return this.catalog.updateProduct(await this.mine(user), productId, body);
  }

  @Delete('products/:productId')
  @ApiParam({ name: 'productId', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove a product',
    description:
      'Deleted if it has never been dispensed. If it has, it is deactivated instead and the response ' +
      'says so — it carries the cost basis of prescriptions already filled.',
  })
  async removeProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.catalog.removeProduct(await this.mine(user), productId);
  }

}
