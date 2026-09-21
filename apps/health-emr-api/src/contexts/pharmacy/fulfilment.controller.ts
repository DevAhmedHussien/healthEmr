import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '@health-emr/types';
import {
  Role,
  flagOrderIssueSchema,
  pharmacyOrderTableQuerySchema,
  pharmacyQueueQuerySchema,
  shipOrderSchema,
} from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import {
  ApiKeysetOk,
  ApiKeysetQuery,
  ApiStandardErrors,
  ApiZodBody,
  ApiZodOk,
} from '@/shared/http/api-docs';
import { FulfilmentService, ORDER_FILTERS } from './fulfilment.service';
import { columnFilterShape } from '@/shared/http/column-filters';

class ShipDto extends createZodDto(shipOrderSchema) {}
class FlagIssueDto extends createZodDto(flagOrderIssueSchema) {}
class QueueQueryDto extends createZodDto(pharmacyQueueQuerySchema) {}
const orderTableSchema = pharmacyOrderTableQuerySchema.extend(columnFilterShape(ORDER_FILTERS));
class OrderTableQueryDto extends createZodDto(orderTableSchema) {}

const queueRow = z.object({
  orderId: z.string().uuid(),
  status: z.string(),
  queuedAt: z.string(),
  prescription: z.object({
    medication: z.string(),
    dose: z.string(),
    quantity: z.string(),
    refills: z.number().int(),
    directions: z.string(),
    prescriber: z.string(),
    licence: z.string(),
  }),
  patient: z.object({
    mrn: z.string(),
    name: z.string(),
    shipTo: z.object({
      line1: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
    }),
    allergies: z.array(z.object({ substance: z.string(), severity: z.string() })),
  }),
});

/**
 * The pharmacy's workspace.
 *
 * Minimum necessary, deliberately: a pharmacy sees what it needs to dispense
 * safely — drug, directions, prescriber, allergies, ship-to — and nothing about
 * why the patient sought care. The questionnaire, the provider's notes and the
 * clinical images are not theirs to read.
 */
@ApiTags('dispensary')
@Roles(Role.PHARMACY)
@Controller({ path: 'dispensary', version: '1' })
export class FulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get('orders')
  @ApiOperation({
    summary: 'The fill queue, as a table',
    description:
      'Offset-paginated with page numbers, a sortable column and filters that survive in the URL. ' +
      'Search covers every field on the row — order id, pharmacy Rx number, tracking number, ' +
      'carrier, medication, directions, prescriber, patient name, MRN, city and state — because ' +
      'somebody looking an order up has whatever the caller gave them.',
  })
  @ApiStandardErrors()
  async orders(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderTableQueryDto) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    return this.fulfilment.listOrders(pharmacyId, query);
  }

  @Get('queue')
  @ApiOperation({
    summary: 'Orders waiting to be filled',
    description:
      'Keyset-paginated, oldest first. Carries the prescription, the ship-to address and the ' +
      "patient's active allergies. Does not carry the questionnaire or provider notes.",
  })
  @ApiKeysetQuery()
  @ApiKeysetOk(queueRow)
  @ApiStandardErrors()
  async queue(@CurrentUser() user: AuthenticatedUser, @Query() query: QueueQueryDto) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    return this.fulfilment.queue(pharmacyId, query);
  }

  @Post('orders/:id/ship')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Pharmacy order id' })
  @ApiOperation({
    summary: 'Record carrier and tracking, and mark shipped',
    description:
      'Tracking numbers are shape-checked against the carrier so a transposed digit is caught at ' +
      'entry. On success the patient is notified in-app with full detail, and by email and SMS ' +
      'with a content-free nudge — a text naming the medication would disclose it to anyone ' +
      'looking at the lock screen.',
  })
  @ApiZodBody(ShipDto)
  @ApiZodOk(
    z.object({
      id: z.string().uuid(),
      carrier: z.string(),
      trackingNumber: z.string(),
      shippedAt: z.string(),
    }),
  )
  @ApiStandardErrors()
  async ship(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ShipDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    return this.fulfilment.ship(pharmacyId, id, user.id, body);
  }

  @Post('orders/:id/issue')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Pharmacy order id' })
  @ApiOperation({
    summary: 'Raise a problem with an order',
    description:
      'Opens a support thread with Super Admin, attached to this order and patient, and notifies ' +
      'them. Use for out-of-stock, an address problem, an unclear prescription, or a clinical concern.',
  })
  @ApiZodBody(FlagIssueDto)
  @ApiZodOk(z.object({ threadId: z.string().uuid(), orderId: z.string().uuid() }))
  @ApiStandardErrors()
  async flag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FlagIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const pharmacyId = await this.fulfilment.pharmacyIdForUser(user.id);
    return this.fulfilment.flagIssue(pharmacyId, id, user.id, body);
  }
}
