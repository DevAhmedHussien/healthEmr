import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/shared/auth/decorators/public.decorator';
import { PrismaService } from '@/shared/prisma/prisma.service';

@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('healthz')
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Is the process up? Touches nothing external, so it never fails because a dependency is slow. ' +
      'Point the container restart probe here.',
  })
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  @ApiOperation({
    summary: 'Readiness',
    description:
      'Can this instance serve traffic? Checks the database. Point the load balancer here so an ' +
      'instance that has lost its database stops receiving requests without being killed.',
  })
  async readiness() {
    try {
      await this.prisma.raw.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
