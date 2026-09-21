import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '@/shared/storage/upload.validation';
import { z } from 'zod';
import type { AuthenticatedUser } from '@health-emr/types';
import { openThreadSchema, sendMessageSchema, threadListQuerySchema } from '@health-emr/types';
import { createZodDto } from '@/shared/http/zod-dto';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import {
  ApiKeysetOk,
  ApiKeysetQuery,
  ApiListOk,
  ApiStandardErrors,
  ApiZodBody,
  ApiZodOk,
} from '@/shared/http/api-docs';
import { MessagingService } from './messaging.service';

class SendMessageDto extends createZodDto(sendMessageSchema) {}
class OpenThreadDto extends createZodDto(openThreadSchema) {}
class ThreadQueryDto extends createZodDto(threadListQuerySchema) {}

const threadRow = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  subject: z.string().nullable(),
  status: z.string(),
  participantCount: z.number().int(),
  lastMessageAt: z.string().nullable(),
  unread: z.boolean(),
});

const messageRow = z.object({
  id: z.string().uuid(),
  author: z.string(),
  authorRole: z.string(),
  content: z.string(),
  sentAt: z.string(),
  mine: z.boolean(),
});

/**
 * Secure messaging, available to every role.
 *
 * Access is by membership, not by role: you can read a thread if you are in it,
 * full stop. That is much harder to get wrong than a role matrix, and it means a
 * conversation cannot widen by accident — somebody has to be added.
 *
 * Message bodies are encrypted at rest and every read is audited as a PHI
 * access, because a clinician-patient exchange is among the most sensitive
 * content the system holds.
 */
@ApiTags('chat')
@Controller({ path: 'chat', version: '1' })
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('threads')
  @ApiOperation({
    summary: 'My conversations',
    description: 'Only threads I am a participant in. Newest activity first, with unread state.',
  })
  @ApiKeysetQuery()
  @ApiKeysetOk(threadRow)
  @ApiStandardErrors()
  threads(@CurrentUser() user: AuthenticatedUser, @Query() query: ThreadQueryDto) {
    return this.messaging.listThreads(user, query);
  }

  @Post('threads')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a conversation',
    description:
      'Implied participants are added by kind: PATIENT_PROVIDER pulls in the patient, the support ' +
      'kinds pull in Super Admin. A thread naming a patient must be a case thread, not GENERAL — ' +
      'so that it is retained and audited as clinical.',
  })
  @ApiZodBody(OpenThreadDto)
  @ApiZodOk(z.object({ threadId: z.string().uuid(), kind: z.string(), participants: z.number().int() }))
  @ApiStandardErrors()
  open(@CurrentUser() user: AuthenticatedUser, @Body() body: OpenThreadDto) {
    return this.messaging.openThread(user, body);
  }

  @Get('threads/:id/messages')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read a conversation',
    description: 'Oldest first. Marks the thread read for me, and records a PHI access entry.',
  })
  @ApiListOk(messageRow)
  @ApiStandardErrors()
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.messaging.messages(user, id, Number(limit) || 50) };
  }

  @Post('threads/:id/messages')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Post a message',
    description:
      'Encrypted at rest. Other participants get an in-app notification; nothing is emailed or ' +
      'texted, because the content of a clinical message never leaves authenticated surfaces.',
  })
  @ApiZodBody(SendMessageDto)
  @ApiZodOk(z.object({ id: z.string().uuid(), sentAt: z.string() }))
  @ApiStandardErrors()
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messaging.send(user, id, body);
  }

  @Post('threads/:id/attachments')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Send a photograph',
    description:
      'This is the answer to "send me a picture of the injection site". The image goes into the ' +
      'conversation, which means it goes into the chart — the clinician prescribes against it and ' +
      'it stays with the record.\n\n' +
      'PDF, PNG and JPEG only, checked by magic bytes rather than by the browser\'s claim about ' +
      'the type, and 15MB at most.',
  })
  @ApiStandardErrors()
  attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    if (!file) throw new BadRequestException('Choose a file to send');
    return this.messaging.attach(user, id, file, caption);
  }

  @Get('threads/:id/attachments/:attachmentId')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Open an attachment',
    description:
      'Streamed to a participant of the conversation, never served from a public URL. Scoped ' +
      'through the thread, so an attachment id on its own opens nothing — and recorded, because ' +
      'looking at a patient\'s photograph is a look at their chart.',
  })
  @ApiStandardErrors()
  async openAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ) {
    const file = await this.messaging.attachment(user, id, attachmentId);

    response.setHeader('Content-Type', file.mime);
    // `inline` so a clinician sees the photograph rather than downloading it,
    // and nosniff so a crafted file cannot be re-interpreted as script.
    response.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.body);
  }
}
