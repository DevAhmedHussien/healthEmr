import { z } from 'zod';

/**
 * Minting an integration credential.
 *
 * The name is required and is the only thing that distinguishes one key from
 * another in the console afterwards — "production", "staging", "the old Zapier
 * one" — because the key itself is never shown again. An unnamed key is one
 * nobody dares revoke.
 */
export const issueApiKeySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Give the key a name so you can tell it apart later')
      .max(120)
      .describe('What this key is for, e.g. "production backend"'),
    /**
     * Optional expiry. Absent means the key lives until it is withdrawn, which
     * is what a production integration wants; a date is for a contractor or a
     * migration window that should stop working on its own.
     */
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe('ISO 8601. Omit for a key that does not expire.'),
  })
  .strict();

export type IssueApiKeyInput = z.infer<typeof issueApiKeySchema>;

export const API_KEY_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];
