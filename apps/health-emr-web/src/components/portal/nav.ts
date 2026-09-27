import type { ComponentType } from 'react';
import type { Role } from '@health-emr/types';
import {
  AlertTriangleIcon,
  BarChartIcon,
  BriefcaseIcon,
  BuildingIcon,
  CheckCircleIcon,
  CreditCardIcon,
  HomeIcon,
  InboxIcon,
  KeyIcon,
  MessageIcon,
  MortarIcon,
  PackageIcon,
  PillIcon,
  PulseIcon,
  RxPadIcon,
  ShieldIcon,
  StethoscopeIcon,
  TrendingUpIcon,
  UsersIcon,
} from '@/components/ui/icons';

export interface NavItem {
  label: string;
  href: string;
  group?: string;
  /**
   * The glyph beside the label. Drawn from the business — a stethoscope for
   * clinicians, a mortar for pharmacies — so the sidebar is recognisable at a
   * glance rather than a column of identical shapes.
   */
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/**
 * What each role's sidebar contains.
 *
 * Kept as data rather than JSX per portal so the navigation and the middleware's
 * route-ownership map can be read side by side and checked against each other.
 */
export const NAV: Record<Role, NavItem[]> = {
  PATIENT: [
    { label: 'My health', href: '/portal', group: 'My care', icon: PulseIcon },
    { label: 'My visits', href: '/portal/visits', group: 'My care', icon: StethoscopeIcon },
    { label: 'Prescriptions', href: '/portal/prescriptions', group: 'My care', icon: PillIcon },
    { label: 'Messages', href: '/portal/messages', group: 'My care', icon: MessageIcon },
  ],
  PROVIDER: [
    { label: 'My queue', href: '/clinic', group: 'Clinical', icon: RxPadIcon },
    { label: 'My decisions', href: '/clinic/decisions', group: 'Clinical', icon: CheckCircleIcon },
    { label: 'Messages', href: '/clinic/messages', group: 'Clinical', icon: MessageIcon },
    { label: 'Work and pay', href: '/clinic/earnings', group: 'Clinical', icon: TrendingUpIcon },
    { label: 'My hours', href: '/clinic/hours', group: 'Clinical', icon: TrendingUpIcon },
    { label: 'My licences', href: '/clinic/licences', group: 'Clinical', icon: BriefcaseIcon },
    { label: 'My signature', href: '/clinic/signature', group: 'Clinical', icon: RxPadIcon },
  ],
  PHARMACY: [
    { label: 'Fill queue', href: '/dispensary', group: 'Dispensing', icon: MortarIcon },
    { label: 'My catalogue', href: '/dispensary/catalog', group: 'Dispensing', icon: PillIcon },
    { label: 'Messages', href: '/dispensary/messages', group: 'Dispensing', icon: MessageIcon },
    {
      label: 'My pharmacy',
      href: '/dispensary/settings',
      group: 'Dispensing',
      icon: BriefcaseIcon,
    },
  ],
  ADMIN: [
    { label: 'Overview', href: '/admin', group: 'Operations', icon: HomeIcon },

    { label: 'Patients', href: '/admin/patients', group: 'Clinical', icon: UsersIcon },
    { label: 'Visits', href: '/admin/visits', group: 'Clinical', icon: PackageIcon },
    { label: 'Prescriptions', href: '/admin/prescriptions', group: 'Clinical', icon: PillIcon },

    { label: 'Messages', href: '/admin/messages', group: 'Operations', icon: MessageIcon },
    { label: 'API access', href: '/admin/integration', group: 'Operations', icon: KeyIcon },
  ],
  SUPER_ADMIN: [
    { label: 'Overview', href: '/super-admin', group: 'Platform', icon: HomeIcon },
    {
      label: 'Client accounts',
      href: '/super-admin/admins',
      group: 'Platform',
      icon: BuildingIcon,
    },
    {
      label: 'Applications',
      href: '/super-admin/applications',
      group: 'Platform',
      icon: InboxIcon,
    },

    {
      label: 'Providers',
      href: '/super-admin/providers',
      group: 'Directory',
      icon: StethoscopeIcon,
    },
    {
      label: 'Clinician activity',
      href: '/super-admin/providers/activity',
      group: 'Directory',
      icon: PulseIcon,
    },
    { label: 'Pharmacies', href: '/super-admin/pharmacies', group: 'Directory', icon: MortarIcon },
    { label: 'Medications', href: '/super-admin/medications', group: 'Directory', icon: PillIcon },

    { label: 'Patients', href: '/super-admin/patients', group: 'Clinical', icon: UsersIcon },
    { label: 'Visits', href: '/super-admin/visits', group: 'Clinical', icon: PackageIcon },
    {
      label: 'Prescriptions',
      href: '/super-admin/prescriptions',
      group: 'Clinical',
      icon: PillIcon,
    },

    { label: 'Invoices', href: '/super-admin/invoices', group: 'Billing', icon: CreditCardIcon },
    { label: 'Reports', href: '/super-admin/reports', group: 'Billing', icon: BarChartIcon },
    { label: 'Analytics', href: '/super-admin/analytics', group: 'Billing', icon: TrendingUpIcon },

    {
      label: 'Stuck orders',
      href: '/super-admin/stuck',
      group: 'Governance',
      icon: AlertTriangleIcon,
    },
    { label: 'Activity log', href: '/super-admin/activity', group: 'Governance', icon: ShieldIcon },
    { label: 'Messages', href: '/super-admin/messages', group: 'Governance', icon: MessageIcon },
  ],

  /**
   * Filled in below, from the super admin's own list.
   *
   * An owner does the same work in the same place — the difference is what they
   * are allowed to do, not where they go to do it. Duplicating twenty entries
   * here would guarantee the two drift.
   */
  OWNER: [],
};

NAV.OWNER = [
  ...NAV.SUPER_ADMIN,
  {
    label: 'Super admins',
    href: '/super-admin/team',
    group: 'Owner',
    icon: KeyIcon,
  },
];

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Platform',
  PATIENT: 'Patient portal',
  PROVIDER: 'Clinic',
  PHARMACY: 'Dispensary',
  ADMIN: 'Operations',
  SUPER_ADMIN: 'Platform',
};
