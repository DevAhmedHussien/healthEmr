/**
 * Roles sit at three altitudes, and the altitude decides what `tenantId` means
 * on a User row:
 *
 *   platform  OWNER, SUPER_ADMIN, PROVIDER, PHARMACY   tenantId is null
 *   tenant    ADMIN                                    tenantId is required
 *   person    PATIENT                                  tenantId is null;
 *                                                      reachability comes from
 *                                                      TenantPatient rows
 */
export const Role = {
  OWNER: 'OWNER',
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
export const PLATFORM_ROLES: readonly Role[] = [
  Role.OWNER,
  Role.SUPER_ADMIN,
  Role.PROVIDER,
  Role.PHARMACY,
];

/**
 * Roles that stand in for another.
 *
 * An owner is a super admin with more, not a different job — so every endpoint
 * a super admin may call, an owner may call too. Expressed once here rather
 * than by adding `Role.OWNER` beside `Role.SUPER_ADMIN` at each of a hundred
 * decorators, where the one that got missed would be found by a user.
 */
export const ROLE_SATISFIES: Partial<Record<Role, readonly Role[]>> = {
  [Role.OWNER]: [Role.SUPER_ADMIN],
};

/** Whether `held` is accepted where `required` is asked for. */
export function roleSatisfies(held: Role, required: Role): boolean {
  return held === required || (ROLE_SATISFIES[held]?.includes(required) ?? false);
}

/**
 * What a super admin may do, granted individually by an owner.
 *
 * Reading is governed by role and recorded in the audit trail. These are the
 * actions that cannot be undone by clicking again, which is why each is a
 * separate grant rather than one "can administer" flag.
 */
export const PlatformPermission = {
  // Accounts
  ACCOUNTS_ARCHIVE: 'ACCOUNTS_ARCHIVE',
  ACCOUNTS_DELETE: 'ACCOUNTS_DELETE',
  ONBOARDING_DECIDE: 'ONBOARDING_DECIDE',
  // The business
  FINANCE_VIEW: 'FINANCE_VIEW',
  FINANCE_MANAGE: 'FINANCE_MANAGE',
  CATALOGUE_MANAGE: 'CATALOGUE_MANAGE',
  // Records and oversight
  BREAK_THE_GLASS: 'BREAK_THE_GLASS',
  RECORDS_DELETE: 'RECORDS_DELETE',
  AUDIT_READ: 'AUDIT_READ',
  WORKFORCE_VIEW: 'WORKFORCE_VIEW',
  DATA_EXPORT: 'DATA_EXPORT',
  // Integrations
  WEBHOOKS_MANAGE: 'WEBHOOKS_MANAGE',
  API_KEYS_MANAGE: 'API_KEYS_MANAGE',
} as const;

/**
 * The areas grants are grouped under.
 *
 * Twelve tickboxes in one column is a list nobody reads to the bottom of. The
 * groups are the four questions an owner is actually deciding between: may this
 * person change who we work with, see what we earn, read patient records, or
 * connect other systems to us.
 */
export const PERMISSION_GROUPS = [
  { key: 'accounts', label: 'Accounts and onboarding' },
  { key: 'business', label: 'The business' },
  { key: 'records', label: 'Records and oversight' },
  { key: 'integrations', label: 'Integrations' },
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number]['key'];

export type PlatformPermission = (typeof PlatformPermission)[keyof typeof PlatformPermission];

export const ALL_PERMISSIONS: readonly PlatformPermission[] = Object.values(PlatformPermission);


/**
 * What each grant means, in the words the owner granting it will read.
 *
 * `weight` is how much damage the grant can do, and it drives nothing but the
 * order things are listed in — the consequential ones first, so an owner
 * skimming the list meets the decisions that matter before the routine ones.
 */
export const PERMISSION_LABELS: Record<
  PlatformPermission,
  { label: string; detail: string; group: PermissionGroup; weight: number }
> = {
  ACCOUNTS_DELETE: {
    group: 'accounts',
    weight: 3,
    label: 'Delete accounts permanently',
    detail:
      'Erase a record for good. Refused while anything clinical refers to it, and cannot be undone when it is allowed.',
  },
  ACCOUNTS_ARCHIVE: {
    group: 'accounts',
    weight: 1,
    label: 'Archive and restore accounts',
    detail:
      'Take a client business, clinician or pharmacy out of use, and put it back. Reversible, and nothing is lost.',
  },
  ONBOARDING_DECIDE: {
    group: 'accounts',
    weight: 2,
    label: 'Approve applications',
    detail: 'Accept or refuse clinicians and pharmacies applying to join the platform.',
  },

  FINANCE_MANAGE: {
    group: 'business',
    weight: 3,
    label: 'Bill clients and set prices',
    detail:
      'Issue and void invoices, record payments, and set what each client is charged and what clinicians are paid.',
  },
  FINANCE_VIEW: {
    group: 'business',
    weight: 2,
    label: 'See revenue, cost and margin',
    detail:
      'What the platform earns, what it pays, and the profit on each client and product. This is the business model in a page.',
  },
  CATALOGUE_MANAGE: {
    group: 'business',
    weight: 2,
    label: 'Manage the catalogue',
    detail: 'Add and change products, categories and platform pricing across every client.',
  },

  RECORDS_DELETE: {
    group: 'records',
    weight: 3,
    label: 'Delete and withdraw visits and prescriptions',
    detail:
      'Mark a visit or prescription as entered in error, and erase one that never reached a ' +
      'clinician. A signed prescription can only ever be withdrawn — it is a medical record and ' +
      'stays, marked, for as long as the retention period runs.',
  },
  BREAK_THE_GLASS: {
    group: 'records',
    weight: 3,
    label: 'Open any patient chart',
    detail:
      'Read a record without being part of that patient’s care. Every access is recorded against them.',
  },
  DATA_EXPORT: {
    group: 'records',
    weight: 3,
    label: 'Export records',
    detail:
      'Download patients, visits or reports as a file. Once exported the data is outside every control on this page.',
  },
  AUDIT_READ: {
    group: 'records',
    weight: 1,
    label: 'Read the audit log',
    detail: 'See who did what, including what other administrators did.',
  },
  WORKFORCE_VIEW: {
    group: 'records',
    weight: 1,
    label: 'See clinician activity',
    detail: 'Hours worked and decisions made, per clinician. Information about people, not patients.',
  },

  WEBHOOKS_MANAGE: {
    group: 'integrations',
    weight: 3,
    label: 'Manage outbound webhooks',
    detail:
      'Decide where a client’s patient events are sent. This is a decision about disclosing PHI.',
  },
  API_KEYS_MANAGE: {
    group: 'integrations',
    weight: 2,
    label: 'Issue and revoke API keys',
    detail: 'The credentials a client business uses to send us visits.',
  },
};

/**
 * Starting points, so assigning a new administrator is one click rather than
 * twelve decisions.
 *
 * Each is a real job rather than a tier: "operations" runs the day to day and
 * has no reason to see margin; "finance" has every reason to see margin and no
 * reason to open a chart. An owner can adjust any of them afterwards, and most
 * will.
 */
export const PERMISSION_PRESETS: Array<{
  key: string;
  label: string;
  detail: string;
  permissions: PlatformPermission[];
}> = [
  {
    key: 'read-only',
    label: 'Read-only',
    detail: 'Can see the console and change nothing. A safe place to start.',
    permissions: [],
  },
  {
    key: 'operations',
    label: 'Operations',
    detail: 'Runs the day to day: onboarding, accounts, stuck work. Does not see the money.',
    permissions: [
      PlatformPermission.ACCOUNTS_ARCHIVE,
      PlatformPermission.ONBOARDING_DECIDE,
      PlatformPermission.WORKFORCE_VIEW,
      PlatformPermission.AUDIT_READ,
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    detail: 'Bills clients and sets prices. No access to patient records.',
    permissions: [
      PlatformPermission.FINANCE_VIEW,
      PlatformPermission.FINANCE_MANAGE,
      PlatformPermission.CATALOGUE_MANAGE,
      PlatformPermission.AUDIT_READ,
    ],
  },
  {
    key: 'full',
    label: 'Everything except deletion',
    detail: 'A trusted administrator. Permanent deletion stays with the owner.',
    permissions: ALL_PERMISSIONS.filter(
      (key) =>
        key !== PlatformPermission.ACCOUNTS_DELETE && key !== PlatformPermission.RECORDS_DELETE,
    ),
  },
];

/**
 * Whether somebody holds a permission.
 *
 * An owner holds everything by virtue of the role — the grants exist to divide
 * an owner's authority among super admins, so requiring an owner to grant it to
 * themselves first would be a step that only ever produces a lockout.
 */
export function hasPermission(
  user: { role: Role; permissions?: readonly PlatformPermission[] | null },
  permission: PlatformPermission,
): boolean {
  if (user.role === Role.OWNER) return true;
  return (user.permissions ?? []).includes(permission);
}

export const ROLE_HOME_ROUTE: Record<Role, string> = {
  // An owner works in the same console; the extra powers appear within it
  // rather than in a separate area, because they are exercised on the same
  // records and splitting them would mean two places to look.
  OWNER: '/super-admin',
  SUPER_ADMIN: '/super-admin',
  ADMIN: '/admin',
  PROVIDER: '/clinic',
  PHARMACY: '/dispensary',
  PATIENT: '/portal',
};
