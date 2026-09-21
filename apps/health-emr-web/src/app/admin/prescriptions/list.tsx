"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { VisitStage } from "@health-emr/types";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { StageBadge } from "@/components/portal/stage-badge";
import {
  Empty,
  Long,
  Money,
  Num,
  Stacked,
  Status,
  Tracking,
  When,
} from "@/components/table/cells";

interface Row extends Record<string, unknown> {
  id: string;
  visitId: string;
  masterId: string;
  medication: string;
  dose: string;
  quantity: string;
  refills: number;
  status: string;
  stage: VisitStage;
  signedAt: string;
  createdAt: string;
  updatedAt: string;
  prescriber: string;
  licence: string;
  patient: { id: string; mrn: string; name: string };
  shipment: {
    pharmacy: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    error: string | null;
  } | null;
  invoice: {
    id: string;
    number: string;
    status: string;
    totalCents: number;
  } | null;
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "status",
    // The column shows a derived stage; the parameter that filters it is the
    // prescription's own status.
    column: "stage",
    label: "Prescription",
    type: "select",
    options: [
      "SIGNED",
      "TRANSMITTED",
      "DISPENSED",
      "SHIPPED",
      "DELIVERED",
      "VOIDED",
    ].map((value) => ({ value, label: value.toLowerCase() })),
  },
  { key: "medication", label: "Medication", type: "text" },
  { key: "patient", label: "Patient", type: "text" },
  { key: "prescriber", label: "Prescriber", type: "text" },
  { key: "licence", label: "Licence", type: "text" },
  { key: "masterId", label: "Master ID", type: "text" },
  { key: "signedAt", label: "Signed", type: "dateRange" },
  { key: "createdAt", label: "Created", type: "dateRange" },
  {
    key: "shipment",
    label: "Shipment",
    type: "select",
    options: [
      "QUEUED",
      "SUBMITTED",
      "ACKNOWLEDGED",
      "IN_FULFILMENT",
      "SHIPPED",
      "DELIVERED",
      "REJECTED",
      "CANCELLED",
    ].map((value) => ({
      value,
      label: value.replace(/_/g, " ").toLowerCase(),
    })),
  },
  { key: "tracking", label: "Tracking", type: "text" },
  {
    key: "invoice",
    label: "Invoice",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  { key: "invoiceNumber", label: "Invoice no.", type: "text" },
  { key: "updatedAt", label: "Updated", type: "dateRange" },
];

const HIDDEN = [
  "masterId",
  "status",
  "licence",
  "tracking",
  "invoiceNumber",
  "createdAt",
  "updatedAt",
] as const;

export function PrescriptionList() {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "medication",
        header: "Medication",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.medication}
            secondary={`${row.original.dose} · qty ${row.original.quantity} · ${row.original.refills} refills`}
          />
        ),
      },
      {
        id: "patient",
        header: "Patient",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.patient.name}
            secondary={row.original.patient.mrn}
            strong={false}
          />
        ),
      },
      {
        id: "stage",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <StageBadge stage={row.original.stage} />
            {row.original.shipment?.error ? (
              <span className="text-[0.72rem] text-[var(--ar-danger)]">
                <Long value={row.original.shipment.error} />
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        header: "Record status",
        cell: ({ row }) => <Status value={row.original.status} />,
      },
      {
        id: "shipment",
        header: "Pharmacy",
        cell: ({ row }) =>
          row.original.shipment ? (
            <Stacked primary={row.original.shipment.pharmacy} strong={false} />
          ) : (
            <Empty label="not sent" />
          ),
      },
      {
        id: "tracking",
        header: "Tracking",
        cell: ({ row }) => (
          <Tracking
            carrier={row.original.shipment?.carrier}
            trackingNumber={row.original.shipment?.trackingNumber}
          />
        ),
      },
      {
        id: "prescriber",
        header: "Prescriber",
        cell: ({ row }) => (
          <Stacked primary={row.original.prescriber} strong={false} />
        ),
      },
      {
        id: "licence",
        header: "Licence",
        cell: ({ row }) => <Long value={row.original.licence} />,
      },
      {
        id: "signedAt",
        header: "Signed",
        cell: ({ row }) => <When value={row.original.signedAt} />,
      },
      {
        id: "createdAt",
        header: "Written",
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
      {
        id: "updatedAt",
        header: "Last updated",
        cell: ({ row }) => <When value={row.original.updatedAt} />,
      },
      {
        id: "invoice",
        header: "Billed",
        cell: ({ row }) => <Money cents={row.original.invoice?.totalCents} />,
      },
      {
        id: "invoiceNumber",
        header: "Invoice",
        cell: ({ row }) =>
          row.original.invoice ? (
            <Stacked
              primary={<Num value={row.original.invoice.number} />}
              secondary={row.original.invoice.status.toLowerCase()}
              strong={false}
            />
          ) : (
            <Empty label="not invoiced" />
          ),
      },
      {
        id: "masterId",
        header: "Order id",
        cell: ({ row }) => <Num value={row.original.masterId} />,
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/admin/prescriptions"
      columns={columns}
      sortable={["signedAt", "status"]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="admin-prescriptions"
      searchPlaceholder="Search record number, surname or medication…"
      emptyTitle="No prescriptions yet"
      emptyHint="One appears here the moment a clinician signs."
      onRowClick={(row) => router.push(`/admin/visits/${row.visitId}`)}
    />
  );
}
