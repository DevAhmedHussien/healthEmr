import { z } from 'zod';
import { Role } from './roles';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

/**
 * Claiming an invited account.
 *
 * The password rules live here so the form and the API enforce exactly the same
 * thing. Length does more for resistance than symbol classes do, so the floor is
 * twelve characters rather than a menu of character types.
 */
export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(10, 'That invitation link looks incomplete'),
    password: z
      .string()
      .min(12, 'Use at least 12 characters')
      .max(200, 'That is longer than we can store'),
    confirmPassword: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Both passwords must match',
      });
    }
  });

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

/** Shape of the JWT access-token payload, shared by the API and the web BFF. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
  /** Present only for ADMIN. Platform roles carry null. */
  tenantId: string | null;
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  tenantId: string | null;
}
