import { z } from 'zod';

export const CHAT_THREAD_KINDS = [
  'PATIENT_PROVIDER',
  'PHARMACY_SUPPORT',
  'PROVIDER_SUPPORT',
  'GENERAL',
] as const;
export type ChatThreadKindValue = (typeof CHAT_THREAD_KINDS)[number];

export const sendMessageSchema = z
  .object({
    content: z.string().trim().min(1, 'Write something').max(5000),
  })
  .strict();

export const openThreadSchema = z
  .object({
    kind: z.enum(CHAT_THREAD_KINDS),
    /** Required for every kind except GENERAL. */
    patientId: z.string().uuid().optional(),
    prescriptionId: z.string().uuid().optional(),
    subject: z.string().trim().max(250).optional(),
    /** Extra people to add beyond the implied participants. */
    participantUserIds: z.array(z.string().uuid()).max(20).default([]),
    message: z.string().trim().min(1).max(5000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind !== 'GENERAL' && !value.patientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patientId'],
        message: 'A case thread must be about a patient',
      });
    }
    if (value.kind === 'GENERAL' && value.patientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message:
          'A thread about a patient is a case thread, not a general one — so it is retained and ' +
          'audited as clinical. Use PROVIDER_SUPPORT or PHARMACY_SUPPORT.',
      });
    }
  });

export const threadListQuerySchema = z
  .object({
    kind: z.enum(CHAT_THREAD_KINDS).optional(),
    patientId: z.string().uuid().optional(),
    unreadOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().max(500).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type OpenThreadInput = z.infer<typeof openThreadSchema>;
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;
