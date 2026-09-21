import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiStandardErrors, ApiZodBody, ApiZodOk } from '@/shared/http/api-docs';
import type { Request } from 'express';
import type { AuthenticatedUser } from '@health-emr/types';
import { Public } from '@/shared/auth/decorators/public.decorator';
import { CurrentUser } from '@/shared/auth/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { InviteService } from './invite.service';
import { AcceptInviteDto, LoginDto, RefreshDto } from './dto';

const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  refreshExpiresIn: z.number().int(),
});

const authenticatedUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'PROVIDER', 'PHARMACY', 'PATIENT']),
  tenantId: z.string().uuid().nullable(),
});

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invites: InviteService,
  ) {}

  /**
   * Rate limiting for this route lives in the service, counted per account.
   *
   * A `@Throttle` here would have applied to the global guard as well, which
   * counts per address — so ten guesses at one account also locked out every
   * colleague behind the same office address.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange email and password for a token pair',
    description:
      'Access tokens are short-lived (15 minutes). Refresh tokens are opaque, single-use and ' +
      'rotated on every refresh, so a stolen one is usable at most once and its reuse surfaces as ' +
      'a revoked session.',
  })
  @ApiZodBody(LoginDto)
  @ApiZodOk(z.object({ user: authenticatedUser, tokens: tokenPair }), 'Signed in')
  @ApiStandardErrors()
  async login(@Body() body: LoginDto, @Req() req: Request) {
    return this.auth.login(body.email, body.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate a refresh token for a new pair',
    description: 'The presented token is revoked in the same transaction that issues its replacement.',
  })
  @ApiZodBody(RefreshDto)
  @ApiZodOk(tokenPair, 'New token pair')
  @ApiStandardErrors()
  async refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke a refresh session',
    description: 'Idempotent, and returns 204 even for an unknown token so it cannot be used as an oracle.',
  })
  @ApiZodBody(RefreshDto)
  @ApiStandardErrors()
  async logout(@Body() body: RefreshDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redeem an invitation and set a password',
    description:
      'Single use. Every failure — expired, already used, revoked, unknown — returns the same ' +
      'message, because telling someone holding a stolen link which it is would be a gift.',
  })
  @ApiZodBody(AcceptInviteDto)
  @ApiZodOk(z.object({ email: z.string(), role: z.string() }), 'Password set')
  @ApiStandardErrors()
  acceptInvite(@Body() body: AcceptInviteDto) {
    return this.invites.accept(body.token, body.password);
  }

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in user',
    description:
      'Read from the database on every call, not from the token, so a deactivated account or a ' +
      'changed role takes effect immediately rather than at the next refresh.',
  })
  @ApiZodOk(authenticatedUser)
  @ApiStandardErrors()
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('profile')
  @ApiOperation({
    summary: 'My own record',
    description:
      'What the platform holds about the signed-in person. Separate from /me, which is the identity ' +
      'the rest of the app runs on and is kept deliberately small.',
  })
  @ApiStandardErrors()
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.profileFor(user.id);
  }
}
