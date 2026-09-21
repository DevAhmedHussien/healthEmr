import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import type { ZodDtoStatic } from './zod-dto';
import { zodToOpenApi } from './zod-openapi';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination';

/**
 * Swagger decorators driven from the Zod schemas the routes already validate
 * against.
 *
 * The schema is the single source of truth. Describing a response by hand is a
 * second definition of the same thing, and the documentation is always the copy
 * nobody notices has drifted.
 */

/** The error envelope every route shares, as `AllExceptionsFilter` writes it. */
const errorSchema = {
  type: 'object' as const,
  properties: {
    statusCode: { type: 'integer' as const },
    message: { type: 'string' as const },
    details: {
      type: 'array' as const,
      items: { type: 'object' as const },
      description: 'Field-level problems, when the failure was a validation one.',
    },
    requestId: {
      type: 'string' as const,
      description: 'Quote this when reporting a problem — it finds the request in the logs.',
    },
  },
  required: ['statusCode', 'message', 'requestId'],
};

/**
 * The failures every authenticated route can produce.
 *
 * Declared once rather than per route: they come from the guards and the
 * exception filter, which no individual handler knows about — so leaving them to
 * each route means most routes forget.
 */
export function ApiStandardErrors() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Malformed, or failed validation',
      schema: errorSchema,
    }),
    ApiResponse({
      status: 401,
      description: 'No credentials, or they have expired',
      schema: errorSchema,
    }),
    ApiResponse({
      status: 403,
      description: 'Authenticated, but not permitted to do this',
      schema: errorSchema,
    }),
    ApiResponse({
      status: 404,
      description: 'No such record — or not one you may see',
      schema: errorSchema,
    }),
    ApiResponse({ status: 429, description: 'Rate limited', schema: errorSchema }),
    ApiResponse({ status: 500, description: 'Something broke on our side', schema: errorSchema }),
  );
}

/** A 200 whose body is exactly this schema. */
export function ApiZodOk(schema: ZodTypeAny, description = 'Success') {
  return ApiOkResponse({ description, schema: zodToOpenApi(schema) });
}

/** The request body, described from the DTO's own schema. */
export function ApiZodBody<T>(dto: ZodDtoStatic<T>) {
  return ApiBody({ schema: zodToOpenApi(dto.zodSchema as unknown as ZodTypeAny) });
}

/** A plain `{ data: [...] }` envelope for genuinely small, unpaginated lists. */
export function ApiListOk(itemSchema: ZodTypeAny, description = 'Success') {
  return ApiOkResponse({
    description,
    schema: {
      type: 'object',
      properties: { data: { type: 'array', items: zodToOpenApi(itemSchema) } },
      required: ['data'],
    },
  });
}

/**
 * A keyset page: the rows, and the cursor for the next one.
 *
 * Shaped to match `toKeysetPage`, so a client reading these docs and a client
 * reading the response see the same thing.
 */
export function ApiKeysetOk(itemSchema: ZodTypeAny, description = 'Success') {
  return ApiOkResponse({
    description,
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: zodToOpenApi(itemSchema) },
        pageInfo: {
          type: 'object',
          properties: {
            nextCursor: {
              type: 'string',
              nullable: true,
              description: 'Pass back as `cursor` for the next page. Null on the last one.',
            },
            hasMore: { type: 'boolean' },
            limit: { type: 'integer' },
          },
          required: ['nextCursor', 'hasMore', 'limit'],
        },
      },
      required: ['data', 'pageInfo'],
    },
  });
}

/** The query parameters a keyset-paginated route accepts. */
export function ApiKeysetQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: { type: 'string' },
      description: 'Opaque. Pass back what the previous page returned; never construct one.',
    }),
    ApiQuery({
      name: 'order',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    }),
  );
}

export { ApiExtraModels, getSchemaPath, Type };
