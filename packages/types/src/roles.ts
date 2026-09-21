/**
 * Roles sit at three altitudes, and the altitude decides what `tenantId` means
 * on a User row:
 *
 *   platform  SUPER_ADMIN, PROVIDER, PHARMACY   tenantId is null
 *   tenant    ADMIN                             tenantId is required
 *   person    PATIENT                           tenantId is null; reachability
 *                                               comes from TenantPatient rows
 */
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  PROVIDER: 'PROVIDER',
  PHARMACY: 'PHARMACY',
  PATIENT: 'PATIENT',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Roles whose users must carry a tenantId. */
export const TENANT_SCOPED_ROLES: readonly Role[] = [Role.ADMIN];

/** Roles that may read across every tenant. */
export const PLATFORM_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.PROVIDER, Role.PHARMACY];

export const ROLE_HOME_ROUTE: Record<Role, string> = {
  SUPER_ADMIN: '/super-admin',
  ADMIN: '/admin',
  PROVIDER: '/clinic',
  PHARMACY: '/dispensary',
  PATIENT: '/portal',
};
