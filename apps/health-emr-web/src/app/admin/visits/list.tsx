"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { VisitStage } from "@health-emr/types";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { StageBadge, STAGE_OPTIONS } from "@/components/portal/stage-badge";
import {
  Empty,
  Long,
  Num,
  Stacked,
  Status,
  Tracking,
  When,
} from "@/components/table/cells";

interface Row extends Record<string, unknown> {
  id: string;
  masterId: string;
  stage: VisitStage;
  requestStatus: string;
  category: { slug: string; name: string };
  patient: { id: string; mrn: string; name: string };
  patientState: string;
  provider: string | null;
  submittedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  refusedReason: string | null;
  items: { name: string; decision: string }[];
  shipment: {
    pharmacy: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: string | null;
    error: string | null;
  } | null;
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "stage",
    column: "status",
    label: "Status",
    type: "select",
    options: STAGE_OPTIONS,
  },
  { key: "masterId", label: "Master ID", type: "text" },
  { key: "patient", label: "Patient", type: "text" },
  { key: "category", label: "Category", type: "text" },
  {
    key: "requestStatus",
    label: "Status",
    type: "select",
    options: [
      "PENDING_ASSIGNMENT",
      "ASSIGNED",
      "IN_REVIEW",
      "INFO_REQUESTED",
      "APPROVED",
      "DENIED",
      "EXPIRED",
    ].map((value) => ({
      value,
      label: value.replace(/_/g, " ").toLowerCase(),
    })),
  },
  { key: "provider", label: "Provider", type: "text" },
  { key: "patientState", label: "State", type: "text" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "createdAt", label: "Submitted", type: "dateRange" },
  { key: "decidedAt", label: "Decided", type: "dateRange" },
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
  { key: "updatedAt", label: "Updated", type: "dateRange" },
];

/** On by default: who, what, where it got to. The rest on request. */
const HIDDEN = [
  "masterId",
  "requestStatus",
  "decidedAt",
  "updatedAt",
  "tracking",
  "reason",
] as const;

export function VisitList() {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "patient",
        header: "Patient",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.patient.name}
            secondary={row.original.patient.mrn}
          />
        ),
      },
      {
        id: "category",
        header: "Treatment",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.category.name}
            secondary={
              row.original.items.map((item) => item.name).join(", ") ||
              undefined
            }
            strong={false}
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <StageBadge stage={row.original.stage} />
            {row.original.stage === "STUCK" && row.original.shipment?.error ? (
              <span className="text-[0.72rem] text-[var(--ar-danger)]">
                <Long value={row.original.shipment.error} />
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "requestStatus",
        header: "Record status",
        cell: ({ row }) => <Status value={row.original.requestStatus} />,
      },
      {
        id: "reason",
        header: "Reason refused",
        cell: ({ row }) => <Long value={row.original.refusedReason} />,
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
        id: "provider",
        header: "Clinician",
        cell: ({ row }) =>
          row.original.provider ?? <Empty label="unassigned" />,
      },
      { id: "patientState", header: "State", accessorKey: "patientState" },
      {
        id: "masterId",
        header: "Order id",
        cell: ({ row }) => <Num value={row.original.masterId} />,
      },
      {
        id: "createdAt",
        header: "Submitted",
        cell: ({ row }) => <When value={row.original.submittedAt} />,
      },
      {
        id: "decidedAt",
        header: "Decided",
        cell: ({ row }) => <When value={row.original.decidedAt} />,
      },
      {
        id: "updatedAt",
        header: "Last updated",
        cell: ({ row }) => <When value={row.original.updatedAt} />,
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/admin/visits"
      columns={columns}
      sortable={["createdAt", "decidedAt", "status"]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="admin-visits"
      searchPlaceholder="Search patient, record number, email or order id…"
      emptyTitle="No visits yet"
      emptyHint="A visit appears here the moment a patient submits one of your intake forms."
      onRowClick={(row) => router.push(`/admin/visits/${row.id}`)}
    />
  );
}
