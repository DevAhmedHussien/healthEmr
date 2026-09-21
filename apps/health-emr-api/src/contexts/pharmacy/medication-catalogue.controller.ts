import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Role, listQuerySchema } from '@health-emr/types';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { createZodDto } from '@/shared/http/zod-dto';
import { ApiStandardErrors } from '@/shared/http/api-docs';
import { PrismaService } from '@/shared/prisma/prisma.service';
import {
  buildOrderBy,
  listResponse,
  offsetSkipTake,
  safeSort,
  searchAcross,
} from '@/shared/http/list-query';
import {
  columnFilterShape,
  columnFilterWhere,
  type ColumnFilterMap,
} from '@/shared/http/column-filters';

const SORT = ['favouriteName', 'medicationName', 'createdAt', 'costOfGoodsCents'] as const;

/**
 * Filterable columns of the catalogue table, keyed by the column id.
 *
 * `pharmacy` and `category` are text here even though the endpoint also takes
 * `pharmacyId`/`categoryId`: the header box is for typing a name, the panel
 * filter is for picking one from a list, and both are useful.
 */
const CATALOGUE_FILTERS = {
  favouriteName: { path: 'favouriteName', kind: 'text' },
  pharmacy: { path: 'pharmacy.name', kind: 'text' },
  category: { path: 'pharmacyCategory.name', kind: 'text' },
  strength: { path: 'concentration', kind: 'text' },
  dispense: { path: 'dispenseQuantity', kind: 'text' },
  medId: { path: 'medication.medId', kind: 'text' },
  kitCode: { path: 'kitCode', kind: 'text' },
  defaultSig: { path: 'defaultSig', kind: 'text' },
  daysSupply: { path: 'daysSupply', kind: 'number' },
  costOfGoodsCents: { path: 'costOfGoodsCents', kind: 'number' },
  sell: { path: 'sellPriceCents', kind: 'number' },
  refills: { path: 'refills', kind: 'number' },
  notes: { path: 'pharmacyNotes', kind: 'text' },
  visitType: { path: 'pharmacyCategory.clinicalCategory.slug', kind: 'text' },
  // `form` is absent for the same reason as `pharmacyId` and `problem`: the
  // endpoint already accepts it as a validated enum. A key matching a column id
  // gets a header box whether or not it comes from this map.
  createdAt: { path: 'createdAt', kind: 'date' },
  updatedAt: { path: 'updatedAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

const querySchema = listQuerySchema
  .extend({
    pharmacyId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    form: z.enum(['INJECTABLE', 'ORAL', 'TOPICAL', 'NASAL', 'OTHER']).optional(),
    /** Products with a pricing problem, which is the list worth acting on. */
    problem: z.enum(['UNPRICED', 'BELOW_COST']).optional(),
    ...columnFilterShape(CATALOGUE_FILTERS),
  })
  .strict();

class CatalogueQueryDto extends createZodDto(querySchema) {}

/**
 * Every medication every pharmacy stocks, in one table.
 *
 * The per-pharmacy catalogue answers "what does First Choice carry"; this
 * answers "who carries semaglutide, at what price, and where are the gaps" —
 * which is the question behind sourcing, pricing and rerouting. Same rows, read
 * across pharmacies instead of within one.
 */
@ApiTags('system: pharmacies')
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'super-admin/medications', version: '1' })
export class MedicationCatalogueController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Every product across every pharmacy',
    description:
      'The whole dispensing catalogue: kit code, the medId a client orders by, directions, what is ' +
      'dispensed, what it costs us and what we charge. Filter by pharmacy, category or form, or by ' +
      '`problem` to see only the rows that are unpriced or priced below cost.',
  })
  @ApiStandardErrors()
  async list(@Query() query: CatalogueQueryDto) {
    const mine: Prisma.PharmacyProductWhereInput = { isActive: true };

    const where: Prisma.PharmacyProductWhereInput = {
      ...mine,
      ...(query.pharmacyId ? { pharmacyId: query.pharmacyId } : {}),
      ...(query.categoryId ? { pharmacyCategoryId: query.categoryId } : {}),
      ...(query.form ? { form: query.form } : {}),
      ...(query.problem === 'UNPRICED' ? { sellPriceCents: null } : {}),
      ...(searchAcross(query.q, [
        'favouriteName',
        'medicationName',
        'kitCode',
        'defaultSig',
        'medication.medId',
      ]) ?? {}),
      ...columnFilterWhere(query, CATALOGUE_FILTERS),
    };

    const sort = safeSort(query.sort, SORT, 'favouriteName');

    const [rows, total] = await Promise.all([
      this.prisma.raw.pharmacyProduct.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        include: {
          pharmacy: { select: { id: true, name: true } },
          pharmacyCategory: {
            select: {
              id: true,
              name: true,
              clinicalCategory: { select: { slug: true, name: true } },
            },
          },
          medication: { select: { medId: true, isCompounded: true } },
        },
      }),
      this.prisma.raw.pharmacyProduct.count({ where }),
    ]);

    const data = rows
      .map((row) => {
        const margin =
          row.sellPriceCents !== null && row.costOfGoodsCents !== null
            ? row.sellPriceCents - row.costOfGoodsCents
            : null;

        return {
          id: row.id,
          pharmacyId: row.pharmacy.id,
          pharmacy: row.pharmacy.name,
          categoryId: row.pharmacyCategory.id,
          category: row.pharmacyCategory.name,
          visitType: row.pharmacyCategory.clinicalCategory?.slug ?? null,
          favouriteName: row.favouriteName,
          /** What a client business sends on an intake to order this. */
          medId: row.medication?.medId ?? null,
          medicationName: row.medicationName,
          type: row.medication?.isCompounded ? 'compound' : 'med',
          concentration: row.concentration,
          form: row.form,
          defaultSig: row.defaultSig,
          dispenseQuantity: row.dispenseQuantity,
          dispenseUnit: row.dispenseUnit,
          refills: row.refills,
          daysSupply: row.daysSupply,
          vialSize: row.vialSize,
          pharmacyNotes: row.pharmacyNotes,
          kitCode: row.kitCode,
          costOfGoodsCents: row.costOfGoodsCents,
          sellPriceCents: row.sellPriceCents,
          marginCents: margin,
          // Null, not zero: a margin on no price is undefined, and 0% reads as
          // "we make nothing on it" rather than "nobody has priced it".
          marginPercent:
            margin !== null && row.sellPriceCents ? Math.round((margin / row.sellPriceCents) * 100) : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
      // Below-cost cannot be expressed as a Prisma filter without raw SQL, so it
      // is applied here. Filtered after paging would give a wrong count, so this
      // one narrows the page it was given and says so in the docs.
      .filter((row) =>
        query.problem === 'BELOW_COST'
          ? row.marginCents !== null && row.marginCents < 0
          : true,
      );

    return listResponse(data, total, query, SORT);
  }

  @Get('filters')
  @ApiOperation({
    summary: 'The pharmacies and categories to filter by',
    description: 'Small, bounded lists for the dropdowns — deliberately unpaginated.',
  })
  @ApiStandardErrors()
  async filters() {
    const [pharmacies, categories] = await Promise.all([
      this.prisma.raw.pharmacy.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.raw.pharmacyCategory.findMany({
        where: { isActive: true },
        orderBy: [{ pharmacy: { name: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, pharmacy: { select: { name: true } } },
      }),
    ]);

    return {
      pharmacies,
      // Named with their pharmacy: three pharmacies each have a "Weight
      // management", and a bare list of names cannot be chosen between.
      categories: categories.map((row) => ({
        id: row.id,
        name: `${row.pharmacy.name} · ${row.name}`,
      })),
    };
  }
}
