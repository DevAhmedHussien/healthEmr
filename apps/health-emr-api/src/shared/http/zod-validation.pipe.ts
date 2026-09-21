import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodDtoStatic } from './zod-dto';

/**
 * Validates a body against the Zod schema attached to its DTO class.
 *
 * Every schema is `.strict()`, so an unexpected field is rejected rather than
 * silently dropped — the same posture as `forbidNonWhitelisted` on the class
 * validator, and what the partner contract requires.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const target = metadata.metatype as unknown as ZodDtoStatic<unknown> | undefined;
    if (!target?.zodSchema) return value;
    return target.parse(value);
  }
}
