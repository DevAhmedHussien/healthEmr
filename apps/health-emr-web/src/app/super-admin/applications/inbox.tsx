"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { US_STATES } from "@health-emr/types";
import { Badge, statusTone } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/format";

interface ProviderRow extends Record<string, unknown> {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  credentials: string;
  npi: string;
  status: string;
  source: string;
  createdAt: string;
  licenses: Array<{
    state: string;
    licenseNumber: string;
    verifiedAt: string | null;
  }>;
  requestedCategorySlugs: string[];
  _count: { documents: number };
}

interface PharmacyRow extends Record<string, unknown> {
  id: string;
  legalName: string;
  tradingName: string | null;
  contactEmail: string;
  state: string;
  statesServed: string[];
  categorySlugs: string[];
  integrationType: string;
  status: string;
  createdAt: string;
  _count: { documents: number };
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a picker spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const shared: FilterDef[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "pending", label: "Pending" },
      { value: "needs_info", label: "Needs info" },
      { value: "approved", label: "Approved" },
      { value: "rejected", label: "Rejected" },
    ],
  },
  {
    key: "state",
    label: "State",
    type: "select",
    options: US_STATES.map((state) => ({ value: state, label: state })),
  },
  { key: "submitted", label: "Submitted", type: "dateRange" },
  {
    key: "source",
    label: "Source",
    type: "select",
    options: [
      { value: "SELF_SERVE", label: "Applied online" },
      { value: "SUPER_ADMIN", label: "Entered by us" },
    ],
  },
  // Provider columns.
  { key: "lastName", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "npi", label: "NPI", type: "text" },
  // Pharmacy columns. Both tabs share this list; only the keys matching the
  // rendered table's columns become boxes, so each tab shows its own.
  { key: "legalName", label: "Legal name", type: "text" },
  { key: "contactEmail", label: "Contact", type: "text" },
  {
    key: "integrationType",
    label: "Integration",
    type: "select",
    options: [
      { value: "LIFEFILE", label: "LifeFile" },
      { value: "GENERIC_HTTP", label: "Generic HTTP" },
    ],
  },
  { key: "createdAt", label: "Received", type: "dateRange" },
  { key: "states", label: "States", type: "text" },
  { key: "categories", label: "Categories", type: "text" },
  {
    key: "documents",
    label: "Documents",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  { key: "statesServed", label: "States served", type: "text" },
  { key: "categorySlugs", label: "Categories", type: "text" },
];

export function ApplicationsInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "pharmacies" ? "pharmacies" : "providers";

  // Column definitions are memoised: TanStack rebuilds its internal model
  // whenever the array identity changes, so an inline literal re-creates the
  // table on every render.
  const providerColumns = React.useMemo<ColumnDef<ProviderRow, unknown>[]>(
    () => [
      {
        id: "lastName",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.firstName} {row.original.lastName}
            </span>
            <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
              {row.original.credentials}
            </span>
          </div>
        ),
      },
      { id: "email", header: "Email", accessorKey: "email" },
      {
        id: "npi",
        header: "NPI",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.npi}</span>
        ),
      },
      {
        id: "states",
        header: "Licensed states",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.licenses.map((licence) => (
              <Badge
                key={licence.state}
                tone={licence.verifiedAt ? "success" : "neutral"}
              >
                {licence.state}
              </Badge>
            ))}
            {row.original.licenses.length === 0 ? (
              <span className="text-[var(--ar-text-faint)]">—</span>
            ) : null}
          </div>
        ),
      },
      {
        id: "categories",
        header: "Categories",
        cell: ({ row }) => (
          <span className="text-[0.8rem]">
            {row.original.requestedCategorySlugs.join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "documents",
        header: "Docs",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original._count.documents}</span>
        ),
      },
      {
        id: "createdAt",
        header: "Submitted",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDateShort(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={statusTone(row.original.status)}>
            {row.original.status.replace(/_/g, " ").toLowerCase()}
          </Badge>
        ),
      },
    ],
    [],
  );

  const pharmacyColumns = React.useMemo<ColumnDef<PharmacyRow, unknown>[]>(
    () => [
      {
        id: "legalName",
        header: "Business",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.legalName}
            </span>
            {row.original.tradingName ? (
              <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                trading as {row.original.tradingName}
              </span>
            ) : null}
          </div>
        ),
      },
      { id: "contactEmail", header: "Contact", accessorKey: "contactEmail" },
      {
        id: "statesServed",
        header: "States served",
        cell: ({ row }) => (
          <span className="text-[0.8rem]">
            {row.original.statesServed.length > 6
              ? `${row.original.statesServed.slice(0, 6).join(", ")} +${row.original.statesServed.length - 6}`
              : row.original.statesServed.join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "categorySlugs",
        header: "Categories",
        cell: ({ row }) => (
          <span className="text-[0.8rem]">
            {row.original.categorySlugs.join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "integrationType",
        header: "Integration",
        cell: ({ row }) => (
          <Badge tone="primary">{row.original.integrationType}</Badge>
        ),
      },
      {
        id: "documents",
        header: "Docs",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original._count.documents}</span>
        ),
      },
      {
        id: "createdAt",
        header: "Submitted",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDateShort(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={statusTone(row.original.status)}>
            {row.original.status.replace(/_/g, " ").toLowerCase()}
          </Badge>
        ),
      },
    ],
    [],
  );

  const switchTab = (next: "providers" | "pharmacies") => {
    // Changing tab clears the table state: a filter that made sense for
    // providers usually does not apply to pharmacies.
    router.replace(`/super-admin/applications?tab=${next}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex gap-1 border-b border-[var(--ar-border)]"
      >
        {(["providers", "pharmacies"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => switchTab(value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-[0.9rem] font-medium capitalize transition",
              tab === value
                ? "border-[var(--ar-primary)] text-[var(--ar-primary)]"
                : "border-transparent text-[var(--ar-text-muted)] hover:text-[var(--ar-body-color)]",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === "providers" ? (
        <DataTable<ProviderRow>
          key="providers"
          endpoint="v1/super-admin/onboarding/providers"
          columns={providerColumns}
          sortable={["createdAt", "lastName", "email", "npi", "status"]}
          filters={shared}
          searchPlaceholder="Search name, email, phone or NPI…"
          emptyTitle="No provider applications"
          emptyHint="Applications from the public form land here."
          onRowClick={(row) =>
            router.push(`/super-admin/applications/provider/${row.id}`)
          }
        />
      ) : (
        <DataTable<PharmacyRow>
          key="pharmacies"
          endpoint="v1/super-admin/onboarding/pharmacies"
          columns={pharmacyColumns}
          sortable={[
            "createdAt",
            "legalName",
            "contactEmail",
            "state",
            "status",
          ]}
          filters={shared}
          searchPlaceholder="Search business name, email or phone…"
          emptyTitle="No pharmacy applications"
          emptyHint="Applications from the public form land here."
          onRowClick={(row) =>
            router.push(`/super-admin/applications/pharmacy/${row.id}`)
          }
        />
      )}
    </div>
  );
}
