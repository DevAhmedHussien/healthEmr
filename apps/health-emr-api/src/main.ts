import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG } from './shared/config/config.module';
import type { AppConfig } from './shared/config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('bootstrap');

  app.use(helmet({ crossOriginEmbedderPolicy: false }));

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Internal API is versioned; the partner surface pins its version in the path
  // so a tenant's integration is never moved by our routing decisions.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  if (config.nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('HealthEMR API')
        .setDescription(
          [
            'Multi-tenant telehealth EMR platform.',
            '',
            '**Two ways in.** Staff and patients authenticate with a session bearer token',
            'from `POST /v1/auth/login`. A tenant business authenticates its server with a',
            'tenant API key on the `/partner/v1/*` routes.',
            '',
            '**Pagination.** Lists are keyset-paginated: pass the `nextCursor` from the',
            'previous page rather than an offset. Cursors are opaque — never build one.',
            '',
            '**Errors.** `4xx` responses carry `{ statusCode, message, details[], requestId }`.',
            'Quote the `requestId` when reporting a problem; it correlates to the server logs.',
          ].join('\n'),
        )
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'session',
        )
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', description: 'Tenant API key (hemr_…)' },
          'tenant-api-key',
        )
        // Partner first: it is the only surface written against by people who
        // are not us, and the first question every integrator has is where the
        // visit endpoint is.
        .addTag(
          'partner',
          'The integration surface. Authenticate with a tenant API key (Authorize → tenant-api-key), ' +
            'then POST a visit to /partner/v1/visit/createNoPayPhotos.',
        )
        .addTag('auth', 'Sessions and tokens')
        .addTag('clinic', 'Provider queue, review and signing')
        .addTag('portal', 'What a patient sees about themselves')
        .addTag('system: pharmacies', 'Pharmacies and their catalogues')
        .addTag('system: onboarding', 'Application review')
        .addTag('public: onboarding', 'Landing-page application forms')
        .addTag('health', 'Liveness and readiness')
        .build(),
    );

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        // Every operation listed, not just the tag headings. Collapsed by tag,
        // the one endpoint an integrator needs was a line of text they had to
        // know to click.
        docExpansion: 'list',
        filter: true,
        // Not alphabetical. The declared order puts `partner` first because it
        // is the only surface people outside this company write against, and
        // alphabetising buries it behind our own internal consoles.

        operationsSorter: 'alpha',
      },
      customSiteTitle: 'HealthEMR API',
    });

    logger.log(`Swagger at http://localhost:${config.port}/docs`);
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`HealthEMR API listening on ${config.port} (${config.nodeEnv})`);
}

bootstrap().catch((error) => {
  console.error('Failed to start HealthEMR API', error);
  process.exit(1);
});
