import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadConfiguration } from './configuration';

export const APP_CONFIG = 'APP_CONFIG';

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, cache: true })],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfiguration }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
