import { z, type ZodTypeAny } from 'zod';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Converts a Zod schema to an OpenAPI schema object.
 *
 * The point is a single source of truth: one schema in `packages/types` produces
 * the runtime validator, the TypeScript type, and the Swagger documentation. The
 * alternative — hand-written `@ApiProperty` decorators beside the Zod schema —
 * is two descriptions of the same contract that drift within a sprint, and the
 * documentation is always the half that goes stale.
 *
 * Covers the constructs this codebase actually uses. Anything unrecognised
 * degrades to an untyped object rather than throwing, because a slightly vague
 * doc is better than an API that will not boot.
 */
export function zodToOpenApi(schema: ZodTypeAny): SchemaObject {
  const def = schema._def;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: SchemaObject = { type: 'string' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minLength = check.value;
        if (check.kind === 'max') out.maxLength = check.value;
        if (check.kind === 'email') out.format = 'email';
        if (check.kind === 'url') out.format = 'uri';
        if (check.kind === 'uuid') out.format = 'uuid';
        if (check.kind === 'regex') out.pattern = check.regex.source;
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const out: SchemaObject = { type: 'number' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min') out.minimum = check.value;
        if (check.kind === 'max') out.maximum = check.value;
        if (check.kind === 'int') out.type = 'integer';
      }
      return out;
    }

    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: 'boolean' };

    case z.ZodFirstPartyTypeKind.ZodDate:
      return { type: 'string', format: 'date-time' };

    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { type: typeof def.value === 'number' ? 'number' : 'string', enum: [def.value] };

    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: 'string', enum: [...def.values] };

    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return { type: 'string', enum: Object.values(def.values as Record<string, string>) };

    case z.ZodFirstPartyTypeKind.ZodArray:
      return { type: 'array', items: zodToOpenApi(def.type) };

    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, SchemaObject> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToOpenApi(value);
        if (!value.isOptional()) required.push(key);
      }

      return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      };
    }

    // Wrappers that do not change the documented shape.
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable:
    case z.ZodFirstPartyTypeKind.ZodEffects:
    case z.ZodFirstPartyTypeKind.ZodBranded:
    case z.ZodFirstPartyTypeKind.ZodReadonly:
      return zodToOpenApi(def.innerType ?? def.schema ?? def.type);

    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const inner = zodToOpenApi(def.innerType);
      try {
        inner.default = def.defaultValue();
      } catch {
        // A default that throws is not documentable; omit rather than fail.
      }
      return inner;
    }

    case z.ZodFirstPartyTypeKind.ZodUnion:
      return { oneOf: (def.options as ZodTypeAny[]).map(zodToOpenApi) };

    case z.ZodFirstPartyTypeKind.ZodRecord:
      return { type: 'object', additionalProperties: zodToOpenApi(def.valueType) };

    default:
      return { type: 'object' };
  }
}
