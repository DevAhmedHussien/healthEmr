import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSION_PRESETS,
  Role,
  createSuperAdminSchema,
  removeSuperAdminSchema,
  setSuperAdminActiveSchema,
  updateSuperAdminSchema,
} from '@health-emr/types';
import type { AuthenticatedUser } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { Roles } from '@/shared/auth/decorators/roles.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiStandardErrors, ApiZodBody } from '@/shared/http/api-docs';
import { OwnerService } from './owner.service';

class CreateSuperAdminDto extends createZodDto(createSuperAdminSchema) {}
class UpdateSuperAdminDto extends createZodDto(updateSuperAdminSchema) {}
class SetActiveDto extends createZodDto(setSuperAdminActiveSchema) {}
class RemoveSuperAdminDto extends createZodDto(removeSuperAdminSchema) {}

/**
 * Who administers the platform, and what each of them may do.
 *
 * OWNER only — and note that this is the one controller where the role is
 * asked for exactly rather than as a superset. Everywhere else an owner stands
 * in for a super admin; here a super admin must not stand in for an owner, or
 * the division of authority would be one request deep.
 */
@ApiTags('owner')
@Roles(Role.OWNER)
@ApiStandardErrors()
@Controller({ path: 'owner', version: '1' })
export class OwnerController {
  constructor(private readonly owner: OwnerService) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'The grants that exist',
    description:
      'Each with the wording shown to whoever is granting it, so the console and the API cannot ' +
      'describe the same permission differently.',
  })
  permissions() {
    return {
      // Ordered by area, then by how much damage each can do, so an owner
      // reading down the list meets the consequential decisions first.
      data: ALL_PERMISSIONS.map((key) => ({ key, ...PERMISSION_LABELS[key] })).sort(
        (a, b) =>
          PERMISSION_GROUPS.findIndex((group) => group.key === a.group) -
            PERMISSION_GROUPS.findIndex((group) => group.key === b.group) ||
          b.weight - a.weight ||
          a.label.localeCompare(b.label),
      ),
      groups: PERMISSION_GROUPS,
      presets: PERMISSION_PRESETS,
    };
  }

  @Get('super-admins')
  @ApiOperation({
    summary: 'Everyone who administers the platform',
    description: 'Owners and super admins, with the grants each holds and when they last signed in.',
  })
  list() {
    return this.owner.list();
  }

  @Post('super-admins')
  @ApiOperation({
    summary: 'Add a super admin',
    description:
      'Created with no usable password and an invitation to set one, so the account cannot be ' +
      'used by whoever created it. The invitation link is returned once — email delivery is not ' +
      'yet connected, and pretending otherwise would leave somebody waiting for nothing.',
  })
  @ApiZodBody(CreateSuperAdminDto)
  create(@Body() body: CreateSuperAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.owner.create(body, user.id);
  }

  @Patch('super-admins/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Change what a super admin may do',
    description:
      'Grants take effect immediately — they are read when an action is attempted rather than ' +
      'carried in the token, so revoking one does not wait for a session to expire.',
  })
  @ApiZodBody(UpdateSuperAdminDto)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSuperAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owner.update(id, body, user.id);
  }

  @Post('super-admins/:id/active')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Suspend or restore a super admin',
    description:
      'The usual answer when somebody leaves: access stops at once and everything they did stays ' +
      'attributed to them. Reversible, unlike deleting.',
  })
  @ApiZodBody(SetActiveDto)
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetActiveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owner.setActive(id, body.isActive, user.id, body.reason);
  }

  @Delete('super-admins/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Remove a super admin permanently',
    description:
      'The account is erased. What they did is not: attribution is copied into each audit entry ' +
      'as text when it is written, so the history survives the account.',
  })
  @ApiZodBody(RemoveSuperAdminDto)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RemoveSuperAdminDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.owner.remove(id, body.reason, user.id);
  }
}
