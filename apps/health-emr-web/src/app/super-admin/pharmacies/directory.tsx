"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, statusTone } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { Num } from "@/components/table/cells";
import { AccountRowActions } from "@/components/admin/account-row-actions";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string;
  integrationType: string;
  assignedAdmin: string | null;
  categories: string[];
  medicationCount: number;
  tenantCount: number;
  ordersThisMonth: number;
  avgFulfilmentHours: number | null;
  status: string;
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
  { key: "name", label: "Name", type: "text" },
  { key: "slug", label: "Slug", type: "text" },
  {
    key: "integrationType",
    label: "Integration",
    type: "select",
    options: [
      { value: "LIFEFILE", label: "LifeFile" },
      { value: "GENERIC_HTTP", label: "Generic HTTP" },
    ],
  },
  { key: "assignedAdmin", label: "Account", type: "text" },
  { key: "categories", label: "Categories", type: "text" },
  {
    key: "medicationCount",
    label: "Products",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "tenantCount",
    label: "Accounts",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
];

export function PharmacyDirectory() {
  const router = useRouter();
  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Pharmacy",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.name}
            </span>
            <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
              {row.original.slug}
            </span>
          </div>
        ),
      },
      {
        id: "slug",
        header: "Slug",
        cell: ({ row }) => <Num value={row.original.slug} />,
      },
      {
        id: "assignedAdmin",
        header: "Account manager",
        cell: ({ row }) => row.original.assignedAdmin ?? "—",
      },
      {
        id: "integrationType",
        header: "Integration",
        cell: ({ row }) => (
          <Badge tone="primary">{row.original.integrationType}</Badge>
        ),
      },
      {
        id: "categories",
        header: "Categories",
        cell: ({ row }) => (
          <span className="text-[0.8rem]">
            {row.original.categories.join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "medicationCount",
        header: "Products",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.medicationCount}</span>
        ),
      },
      {
        id: "ordersThisMonth",
        header: "Orders (month)",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.ordersThisMonth}</span>
        ),
      },
      {
        id: "avgFulfilmentHours",
        header: "Fulfilment",
        cell: ({ row }) =>
          row.original.avgFulfilmentHours === null ? (
            <span className="text-[var(--ar-text-faint)]">—</span>
          ) : (
            <span className="tabular-nums">
              {row.original.avgFulfilmentHours}h
            </span>
          ),
      },
      {
        id: "tenantCount",
        header: "Accounts",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.tenantCount}</span>
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
            kind="pharmacy"
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
      endpoint="v1/super-admin/pharmacies/directory"
      columns={columns}
      sortable={["name", "slug", "createdAt", "status"]}
      filters={filters}
      hiddenByDefault={["slug", "assignedAdmin"]}
      storageKey="sa-pharmacies"
      searchPlaceholder="Search name, slug or NCPDP…"
      emptyTitle="No pharmacies yet"
      emptyHint="Approve a pharmacy application to add one."
      onRowClick={(row) => router.push(`/super-admin/pharmacies/${row.id}`)}
    />
  );
}
