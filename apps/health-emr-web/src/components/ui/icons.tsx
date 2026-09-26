import * as React from 'react';

/**
 * The icon set, drawn inline.
 *
 * AscendRehab uses react-feather; these are the same 24×24 stroke geometry, so
 * the console reads as part of the same family. They are hand-drawn rather than
 * imported for two reasons: a published page is served under a strict CSP that
 * forbids external assets, and pulling a whole icon package to use thirty of its
 * glyphs costs far more than it returns.
 *
 * Every icon is `aria-hidden` and inherits `currentColor`. An icon never carries
 * meaning on its own — the button it sits in has the label, and an icon-only
 * control must supply its own `aria-label`.
 */

export interface IconProps {
  /** 16 inside a button, 18 alongside a heading, matching the source design. */
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Svg({
  size = 16,
  strokeWidth = 2,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// ── actions ────────────────────────────────────────────────────────────────

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

/** The overflow affordance: the row's actions, collapsed on a narrow screen. */
export const MoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Svg>
);

export const EditIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Svg>
);

export const ArchiveIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" rx="1" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </Svg>
);

export const RestoreIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </Svg>
);

export const SaveIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const XIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const SendIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);

export const UploadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);

/** A funnel — narrowing a list down, which is what the panel below it does. */
export const FilterIcon = (props: IconProps) => (
  <Svg {...props}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </Svg>
);

/** Three uprights, for choosing which columns are on screen. */
export const ColumnsIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="4" width="5.5" height="16" rx="1" />
    <rect x="9.25" y="4" width="5.5" height="16" rx="1" />
    <rect x="15.5" y="4" width="5.5" height="16" rx="1" />
  </Svg>
);

/** A paperclip, for sending a photograph or a document into a conversation. */
export const PaperclipIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const RefreshIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Svg>
);

export const LogInIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </Svg>
);

export const EyeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </Svg>
);

export const LogOutIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Svg>
);

// ── navigation ─────────────────────────────────────────────────────────────

export const ArrowLeftIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </Svg>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </Svg>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const MenuIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </Svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>
);

// ── the domain ─────────────────────────────────────────────────────────────
//
// These carry the vocabulary of the business rather than generic shapes: a
// stethoscope for a clinician, a mortar for a pharmacy, a pulse for a patient's
// chart. An operator scanning a sidebar recognises the object before they read
// the word, which is the only reason an icon earns its place.

export const HomeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </Svg>
);

export const BriefcaseIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </Svg>
);

export const InboxIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </Svg>
);

export const StethoscopeIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 3v6a5 5 0 0 0 10 0V3" />
    <line x1="4" y1="3" x2="8" y2="3" />
    <line x1="14" y1="3" x2="18" y2="3" />
    <path d="M11 14v2a5 5 0 0 0 10 0v-1" />
    <circle cx="21" cy="12" r="2" />
  </Svg>
);

/** A capsule — prescriptions, medications, the catalogue. */
export const PillIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)" />
    <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
  </Svg>
);

/** Mortar and pestle — a dispensing pharmacy. */
export const MortarIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 9h16v1a8 8 0 0 1-5 7.4V21H9v-3.6A8 8 0 0 1 4 10Z" />
    <line x1="6" y1="21" x2="18" y2="21" />
    <path d="M14.5 8 18 3.5a1.8 1.8 0 0 1 2.6 2.5L18 9" />
  </Svg>
);

/** A pulse trace — a patient chart, and anything clinical in aggregate. */
export const PulseIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="22 12 18 12 15 20 9 4 6 12 2 12" />
  </Svg>
);

/** A prescription pad — a written script, a visit's outcome. */
export const RxPadIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M8 7h3.2a2 2 0 0 1 0 4H8V7Zm0 4v6" />
    <line x1="11.5" y1="11" x2="16" y2="17" />
  </Svg>
);

/** A building — a client telehealth business. */
export const BuildingIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 21V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15" />
    <path d="M15 11h4a2 2 0 0 1 2 2v8" />
    <line x1="1" y1="21" x2="23" y2="21" />
    <line x1="7" y1="8" x2="11" y2="8" />
    <line x1="7" y1="12" x2="11" y2="12" />
    <line x1="7" y1="16" x2="11" y2="16" />
  </Svg>
);

/** A medical cross in a shield — the clinical safety rail. */

/** A package in transit — a pharmacy order on its way to a patient. */
export const PackageIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
    <polyline points="3 7 12 12 21 7" />
    <line x1="12" y1="12" x2="12" y2="22" />
  </Svg>
);

export const UserIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);

export const UsersIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const UserPlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="20" y1="8" x2="20" y2="14" />
    <line x1="23" y1="11" x2="17" y2="11" />
  </Svg>
);

export const BarChartIcon = (props: IconProps) => (
  <Svg {...props}>
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="10" />
  </Svg>
);

export const TrendingUpIcon = (props: IconProps) => (
  <Svg {...props}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </Svg>
);

export const ShieldIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <polyline points="9 12 11 14 15 10" />
  </Svg>
);

export const BellIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Svg>
);

export const MessageIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.2A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z" />
  </Svg>
);

export const CreditCardIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </Svg>
);

export const ClipboardIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </Svg>
);

export const AlertTriangleIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

export const CheckCircleIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const KeyIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
  </Svg>
);

export const CalendarIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Svg>
);
