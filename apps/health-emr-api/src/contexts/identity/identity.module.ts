import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AccessTokenStrategy } from '@/shared/auth/strategies/access-token.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { InviteService } from './invite.service';

/**
 * Bounded context: identity.
 *
 * Owns users, credentials and sessions. Nothing outside it reads the `users`
 * table directly — other contexts receive an AuthenticatedUser or a userId.
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokensService, AccessTokenStrategy, InviteService],
  exports: [AuthService, TokensService, InviteService],
})
export class IdentityModule {}
