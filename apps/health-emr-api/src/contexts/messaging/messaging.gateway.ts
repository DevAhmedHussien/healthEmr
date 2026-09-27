import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenClaims } from '@health-emr/types';
import { APP_CONFIG } from '@/shared/config/config.module';
import type { AppConfig } from '@/shared/config/configuration';
import { Inject } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { DomainEvent, type DomainEventEnvelope } from '@/shared/events/domain-events';
import type { ChatTicketClaims } from './chat-ticket';

/**
 * Real-time delivery for chat.
 *
 * The socket authenticates from the handshake rather than a cookie, and every
 * client is placed only in rooms for threads it actually participates in — so
 * broadcasting to a thread cannot reach anyone who was not already entitled to
 * read it.
 *
 * This is also the concrete reason the API is a long-running container rather
 * than a function: holding a socket open is not something a request-scoped
 * runtime can do.
 */
@WebSocketGateway({ path: '/v1/chat/ws', cors: { origin: true, credentials: true } })
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MessagingGateway.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = String(client.handshake.auth?.token ?? '');
      if (!token) throw new Error('No token');

      /**
       * Either an access token or a chat ticket opens this.
       *
       * A browser cannot send the access token — it is held server-side on
       * purpose — so it presents a ticket minted for it, good for a minute and
       * good for nothing else. A server-side caller may still use the access
       * token directly.
       */
      const claims = await this.jwt.verifyAsync<AccessTokenClaims & Partial<ChatTicketClaims>>(
        token,
        { secret: this.config.jwt.accessSecret },
      );

      if (!claims.sub) throw new Error('No subject');

      // Which threads, read now rather than trusted from the token: membership
      // is the authorisation model, and a token cannot vouch for it.
      const memberships = await this.prisma.raw.chatParticipant.findMany({
        where: { userId: claims.sub, leftAt: null },
        select: { threadId: true },
      });

      client.data.userId = claims.sub;
      for (const membership of memberships) {
        await client.join(`thread:${membership.threadId}`);
      }

      client.emit('connected', { threads: memberships.length });
    } catch {
      // Say nothing about why — an unauthenticated socket gets no information.
      client.disconnect(true);
    }
  }

  /**
   * Joins a conversation opened after the socket connected.
   *
   * A clinician asking a patient a question creates the thread there and then,
   * and without this their socket would not be in the room until they next
   * reloaded — which is the reload this whole mechanism exists to remove.
   * Membership is re-checked here; the client naming a room does not grant it.
   */
  @SubscribeMessage('thread.watch')
  async watch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { threadId?: string },
  ): Promise<void> {
    const userId = client.data?.userId as string | undefined;
    const threadId = body?.threadId;
    if (!userId || !threadId) return;

    const participant = await this.prisma.raw.chatParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
      select: { leftAt: true },
    });
    if (!participant || participant.leftAt) return;

    await client.join(`thread:${threadId}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket disconnected: ${client.data?.userId ?? 'anonymous'}`);
  }

  @OnEvent(DomainEvent.ChatMessageSent)
  broadcast(envelope: DomainEventEnvelope<{ threadId: string }>): void {
    const { threadId } = envelope.payload;
    this.server?.to(`thread:${threadId}`).emit('chat.message', envelope.payload);
  }
}
