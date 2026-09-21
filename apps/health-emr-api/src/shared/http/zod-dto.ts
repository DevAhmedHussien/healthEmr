import { BadRequestException } from '@nestjs/common';
import type { ZodSchema, ZodTypeDef } from 'zod';

export interface ZodDtoStatic<T> {
  new (): T;
  zodSchema: ZodSchema<T, ZodTypeDef, unknown>;
  parse(input: unknown): T;
}

/**
 * Turns a Zod schema into a Nest DTO class.
 *
 * One schema in `packages/types` therefore drives client-side form validation,
 * the partner API contract and the server DTO at once — which is how the web app
 * and the API stay in agreement about field names without anyone remembering to
 * update two places.
 */
export function createZodDto<T>(schema: ZodSchema<T, ZodTypeDef, unknown>): ZodDtoStatic<T> {
  class ZodDto {
    static zodSchema = schema;

    static parse(input: unknown): T {
      const result = schema.safeParse(input);
      if (!result.success) {
        throw new BadRequestException({
          statusCode: 400,
          error: result.error.issues[0]?.message ?? 'Validation failed',
          details: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      return result.data;
    }
  }

  return ZodDto as unknown as ZodDtoStatic<T>;
}
