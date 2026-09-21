import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
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

      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.jwt.accessSecret,
      });

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

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket disconnected: ${client.data?.userId ?? 'anonymous'}`);
  }

  @OnEvent(DomainEvent.ChatMessageSent)
  broadcast(envelope: DomainEventEnvelope<{ threadId: string }>): void {
    const { threadId } = envelope.payload;
    this.server?.to(`thread:${threadId}`).emit('chat.message', envelope.payload);
  }
}
