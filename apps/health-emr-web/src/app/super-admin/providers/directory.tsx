"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { US_STATES } from "@health-emr/types";
import { Badge, statusTone } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { StateList } from "@/components/portal/state-list";
import { Email } from "@/components/table/cells";
import { AccountRowActions } from "@/components/admin/account-row-actions";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  credentials: string;
  npi: string | null;
  licensedStates: string[];
  categories: string[];
  assignedAdmin: string | null;
  status: string;
  approved: number;
  refused: number;
  approvalRate: number | null;
  avgDecisionMinutes: number | null;
  earningsCents: number;
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "SUSPENDED", label: "Suspended" },
    ],
  },
  {
    key: "state",
    label: "Licensed in",
    type: "select",
    options: US_STATES.map((state) => ({ value: state, label: state })),
  },
  { key: "lastName", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "npi", label: "NPI", type: "text" },
  { key: "states", label: "States", type: "text" },
  { key: "categories", label: "Categories", type: "text" },
  { key: "assignedAdmin", label: "Account", type: "text" },
];

const duration = (minutes: number | null) => {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 6) / 10}h`;
  return `${Math.round(minutes / 144) / 10}d`;
};

export function ProviderDirectory() {
  const router = useRouter();
  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "lastName",
        header: "Clinician",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.name}
            </span>
            <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
              {row.original.credentials}
            </span>
          </div>
        ),
      },
      {
        id: "email",
        header: "Email",
        cell: ({ row }) => <Email value={row.original.email} />,
      },
      {
        id: "npi",
        header: "NPI / licence",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.npi ?? "—"}</span>
        ),
      },
      {
        id: "states",
        header: "States",
        cell: ({ row }) => <StateList states={row.original.licensedStates} />,
      },
      {
        id: "categories",
        header: "Categories",
        cell: ({ row }) => (
          <span className="text-[0.8rem]">
            {row.original.categories.length}
          </span>
        ),
      },
      {
        id: "assignedAdmin",
        header: "Admin account",
        cell: ({ row }) =>
          row.original.assignedAdmin ?? (
            <span className="text-[var(--ar-text-faint)]">—</span>
          ),
      },
      {
        id: "approved",
        header: "Approved",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.approved}</span>
        ),
      },
      {
        id: "refused",
        header: "Refused",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.refused}</span>
        ),
      },
      {
        id: "approvalRate",
        header: "Rate",
        cell: ({ row }) =>
          row.original.approvalRate === null ? (
            // No decisions yet is not a rate of zero.
            <span className="text-[var(--ar-text-faint)]">—</span>
          ) : (
            <span className="tabular-nums">{row.original.approvalRate}%</span>
          ),
      },
      {
        id: "avgDecision",
        header: "Avg decision",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {duration(row.original.avgDecisionMinutes)}
          </span>
        ),
      },
      {
        id: "earnings",
        header: "Earned",
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">
            ${(row.original.earningsCents / 100).toFixed(2)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={statusTone(row.original.status)}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: "actions",
        // Named, and named the same in every table. A blank header saves a
        // little width and costs the column its place in the row a screen
        // reader announces — and leaves sighted readers to work out from the
        // icons what the column is for.
        header: "Actions",
        enableSorting: false,
        // Last and right-aligned: an action column that sorts or takes width
        // from a header is a column pretending to be data.
        cell: ({ row }) => (
          <AccountRowActions
            kind="provider"
            id={row.original.id}
            name={row.original.name}
            archived={row.original.status === "ARCHIVED"}
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/providers"
      columns={columns}
      sortable={["lastName", "createdAt", "npi", "status"]}
      filters={filters}
      hiddenByDefault={["email", "avgDecision"]}
      storageKey="sa-providers"
      searchPlaceholder="Search name, email or NPI…"
      emptyTitle="No providers yet"
      emptyHint="Approve a provider application to add one."
      onRowClick={(row) => router.push(`/super-admin/providers/${row.id}`)}
    />
  );
}
