"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, statusTone } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { Num, When } from "@/components/table/cells";
import { formatDateShort, formatMoney } from "@/lib/format";

interface Row extends Record<string, unknown> {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  tenant: { id: string; name: string };
  patient: { id: string; name: string; mrn: string };
  lines: number;
  payments: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
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
    options: ["DRAFT", "ISSUED", "PAID", "VOID", "REFUNDED"].map((value) => ({
      value,
      label: value.toLowerCase(),
    })),
  },
  { key: "number", label: "Number", type: "text" },
  { key: "tenant", label: "Account", type: "text" },
  { key: "patient", label: "Patient", type: "text" },
  { key: "totalCents", label: "Total", type: "text" },
  { key: "issuedAt", label: "Issued", type: "dateRange" },
  { key: "dueAt", label: "Due", type: "dateRange" },
  { key: "paidAt", label: "Paid", type: "dateRange" },
  { key: "createdAt", label: "Created", type: "dateRange" },
  {
    key: "lines",
    label: "Lines",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "payments",
    label: "Payments",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
];

export function InvoiceList() {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Invoice",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums">
            {row.original.number}
          </span>
        ),
      },
      {
        id: "tenant",
        header: "Account",
        cell: ({ row }) => row.original.tenant.name,
      },
      {
        id: "patient",
        header: "Patient",
        cell: ({ row }) => (
          <div>
            <span>{row.original.patient.name}</span>
            <span className="block text-[0.75rem] tabular-nums text-[var(--ar-text-faint)]">
              {row.original.patient.mrn}
            </span>
          </div>
        ),
      },
      {
        id: "totalCents",
        header: "Total",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(row.original.totalCents)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div>
            <Badge tone={statusTone(row.original.status)}>
              {row.original.status.toLowerCase()}
            </Badge>
            {row.original.dueAt && row.original.status === "ISSUED" ? (
              <span className="mt-1 block text-[0.72rem] text-[var(--ar-text-faint)]">
                due {formatDateShort(row.original.dueAt)}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "issuedAt",
        header: "Issued",
        cell: ({ row }) => <When value={row.original.issuedAt} />,
      },
      {
        id: "dueAt",
        header: "Due",
        cell: ({ row }) => <When value={row.original.dueAt} />,
      },
      {
        id: "paidAt",
        header: "Paid",
        cell: ({ row }) => <When value={row.original.paidAt} />,
      },
      {
        id: "lines",
        header: "Lines",
        cell: ({ row }) => <Num value={row.original.lines} />,
      },
      {
        id: "payments",
        header: "Payments",
        cell: ({ row }) => <Num value={row.original.payments} />,
      },
      {
        id: "createdAt",
        header: "Raised",
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/invoices"
      columns={columns}
      sortable={["createdAt", "issuedAt", "totalCents", "status"]}
      filters={filters}
      hiddenByDefault={["dueAt", "paidAt", "lines", "payments", "createdAt"]}
      storageKey="sa-invoices"
      searchPlaceholder="Search invoice number, account or patient…"
      emptyTitle="No invoices yet"
      emptyHint="Raise one from a prescription — it is built from the price the client quoted at intake."
      onRowClick={(row) => router.push(`/super-admin/invoices/${row.id}`)}
    />
  );
}
