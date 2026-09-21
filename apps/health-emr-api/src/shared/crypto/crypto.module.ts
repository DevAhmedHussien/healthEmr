import { Global, Module } from '@nestjs/common';
import { PhiCryptoService } from './phi-crypto.service';

@Global()
@Module({ providers: [PhiCryptoService], exports: [PhiCryptoService] })
export class CryptoModule {}
