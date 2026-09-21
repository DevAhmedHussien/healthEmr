import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedUser } from '@health-emr/types';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { ApiListOk, ApiStandardErrors, ApiZodOk } from '@/shared/http/api-docs';
import { NotificationsService } from './notifications.service';

const notificationRow = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * In-app notifications, for every role.
 *
 * This is the only channel that renders the full text, because it is the only
 * one that sits behind authentication.
 */
@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications',
    description: 'Newest first. Full content, because the caller is authenticated.',
  })
  @ApiListOk(notificationRow)
  @ApiStandardErrors()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return { data: await this.notifications.listForUser(user.id, take) };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many I have not read', description: 'For the badge on the bell.' })
  @ApiZodOk(z.object({ unread: z.number().int() }))
  @ApiStandardErrors()
  async unread(@CurrentUser() user: AuthenticatedUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Mark one as read',
    description: 'Scoped to the caller — marking someone else\'s notification read is a no-op, not an error.',
  })
  @ApiZodOk(z.object({ updated: z.number().int() }))
  @ApiStandardErrors()
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
