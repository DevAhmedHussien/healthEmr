"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { VisitStage } from "@health-emr/types";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { StageBadge, STAGE_OPTIONS } from "@/components/portal/stage-badge";
import {
  Email,
  Empty,
  Long,
  Money,
  Num,
  Phone,
  Stacked,
  Status,
  Tracking,
  When,
} from "@/components/table/cells";
import { Badge } from "@/components/ui/primitives";
import { RecordRowActions } from "@/components/admin/record-row-actions";

interface Row extends Record<string, unknown> {
  id: string;
  masterId: string;
  stage: VisitStage;
  requestStatus: string;
  voidedAt: string | null;
  voidedReason: string | null;
  tenant: { id: string; slug: string; name: string };
  category: { slug: string; name: string };
  patient: {
    id: string;
    mrn: string;
    name: string;
    email: string;
    phone: string;
  };
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
    error: string | null;
  } | null;
  money: {
    sellPriceCents: number | null;
    costOfGoodsCents: number | null;
  } | null;
}

/** The raw workflow status on the visit record, as opposed to the derived stage. */
const REQUEST_STATUS_OPTIONS = [
  "PENDING_ASSIGNMENT",
  "ASSIGNED",
  "IN_REVIEW",
  "INFO_REQUESTED",
  "APPROVED",
  "DENIED",
  "EXPIRED",
].map((value) => ({ value, label: value.replace(/_/g, " ").toLowerCase() }));

/**
 * Declared once, rendered twice.
 *
 * A filter keyed to a column id appears in a box under that column's header;
 * one that is not — `stage`, which is derived from several fields rather than
 * being a column — stays in the Filters panel. Every key here must be a column
 * the endpoint declares filterable, or the request is refused.
 */
const filters: FilterDef[] = [
  {
    key: "stage",
    column: "status",
    label: "Status",
    type: "select",
    options: STAGE_OPTIONS,
  },
  { key: "patient", label: "Patient", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "tenant", label: "Client", type: "text" },
  { key: "category", label: "Category", type: "text" },
  {
    key: "requestStatus",
    label: "Status",
    type: "select",
    options: REQUEST_STATUS_OPTIONS,
  },
  { key: "provider", label: "Provider", type: "text" },
  { key: "patientState", label: "State", type: "text" },
  { key: "reason", label: "Reason", type: "text" },
  { key: "masterId", label: "Master ID", type: "text" },
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
  { key: "charge", label: "Charge", type: "text" },
  { key: "updatedAt", label: "Updated", type: "dateRange" },
];

/**
 * On by default: who, from whom, what, where it got to.
 *
 * The rest is a column away in the Columns menu. A platform-wide list that
 * opened with twenty columns would be read by nobody.
 */
const HIDDEN = [
  "requestStatus",
  "masterId",
  "decidedAt",
  "updatedAt",
  "tracking",
  "reason",
  "cost",
  "charge",
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
        id: "email",
        header: "Email",
        cell: ({ row }) => <Email value={row.original.patient.email} />,
      },
      {
        id: "phone",
        header: "Phone",
        cell: ({ row }) => <Phone value={row.original.patient.phone} />,
      },
      {
        id: "tenant",
        header: "Client",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.tenant.name}
            secondary={row.original.tenant.slug}
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
            {/* Withdrawn beats every other state: it is the reason this visit
                counts toward nothing, and a stage badge alone would imply it
                still does. */}
            {row.original.voidedAt ? (
              <Badge tone="neutral">withdrawn</Badge>
            ) : (
              <StageBadge stage={row.original.stage} />
            )}
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
        cell: ({ row }) => (
          <Long
            value={row.original.voidedReason ?? row.original.refusedReason}
          />
        ),
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
        id: "charge",
        header: "We charge",
        cell: ({ row }) => <Money cents={row.original.money?.sellPriceCents} />,
      },
      {
        id: "cost",
        header: "Cost",
        cell: ({ row }) => (
          <Money cents={row.original.money?.costOfGoodsCents} />
        ),
      },
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
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        // Last and right-aligned, as in every other table.
        cell: ({ row }) => (
          <RecordRowActions
            kind="visit"
            id={row.original.id}
            label={row.original.masterId}
            archived={row.original.voidedAt !== null}
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/visits"
      columns={columns}
      sortable={["createdAt", "decidedAt", "status"]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="super-admin-visits"
      searchPlaceholder="Search name, email, phone, record number or order id…"
      emptyTitle="No visits yet"
      emptyHint="A visit appears here the moment any client business submits one."
      onRowClick={(row) =>
        router.push(`/super-admin/visits/${row.id}/questionnaire`)
      }
    />
  );
}
