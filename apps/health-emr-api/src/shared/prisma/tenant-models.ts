/**
 * Models that carry a `tenantId` column and are therefore auto-scoped.
 *
 * Adding a tenant-scoped model to the schema without adding it here is the one
 * way to create a leak, so `tenant-models.spec.ts` asserts this list matches the
 * Prisma DMMF and fails the build if they drift.
 */
export const TENANT_SCOPED_MODELS = [
  'TenantApiKey',
  'TenantWebhook',
  'TenantCategory',
  'TenantMedication',
  'TenantPharmacy',
  'TenantProvider',
  'TenantPatient',
  'Encounter',
  'QaSubmission',
  'PrescriptionRequest',
  'Prescription',
  'PharmacyOrder',
  'ChatThread',
  'Invoice',
  // Scoped as defence in depth. What we pay providers is platform money and no
  // tenant endpoint should read it at all — RolesGuard is what actually stops
  // them. But if one ever does, being scoped means it sees only its own share
  // rather than the whole payout ledger. Super Admin runs unscoped, so a payout
  // report still sums a provider's work across every client.
  'ProviderEarning',
  'AuditLog',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

/**
 * Models that carry a `tenantId` column but are deliberately NOT auto-scoped,
 * with the reason. Anything here is a considered exception; anything missing
 * from both lists fails `tenant-models.spec.ts`.
 */
export const TENANT_SCOPE_EXEMPT: Readonly<Record<string, string>> = {
  Notification:
    'Always queried by userId, which is strictly tighter than tenant scope. Auto-scoping would ' +
    'actively break it: a system notification carries tenantId null, and injecting an admin\'s ' +
    'tenantId into the where clause would filter their own notification out. The tenantId column ' +
    'here is provenance — which tenant the event concerned — not an access boundary.',

  User:
    'Login resolves a user before any tenant is known, and platform roles ' +
    '(SUPER_ADMIN, PROVIDER, PHARMACY, PATIENT) carry a null tenantId. ' +
    'Auto-scoping would make every provider unfindable. Tenant confinement for ' +
    'admins is applied by TenantGuard from the authenticated session instead.',
};

const lookup = new Set<string>(TENANT_SCOPED_MODELS);

export function isTenantScoped(model: string | undefined): model is TenantScopedModel {
  return model !== undefined && lookup.has(model);
}
