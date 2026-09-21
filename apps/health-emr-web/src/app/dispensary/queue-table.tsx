"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { US_STATES } from "@health-emr/types";
import { Badge, statusTone } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { formatDateShort } from "@/lib/format";
import { OrderRowActions, type QueueRow } from "./order-row-actions";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Long,
  Num,
  Phone,
  Stacked,
  Tracking,
  When,
} from "@/components/table/cells";

interface Row extends Record<string, unknown> {
  id: string;
  status: string;
  queuedAt: string;
  submittedAt: string | null;
  externalOrderId: string | null;
  externalRxNumber: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  reachedYourSystem: boolean;
  transmissionError: string | null;
  medication: string;
  strength: string | null;
  dose: string;
  quantity: string;
  refills: number;
  daysSupply: number | null;
  directions: string;
  prescriber: string;
  signedAt: string;
  patient: {
    name: string;
    mrn: string;
    phone: string;
    shipTo: string;
    state: string | null;
    allergies: string[];
  };
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "status",
    label: "Status",
    type: "multi",
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
  {
    key: "scope",
    label: "Show",
    type: "select",
    options: [
      { value: "open", label: "Still to fill" },
      { value: "all", label: "Everything" },
    ],
  },
  {
    key: "carrier",
    label: "Carrier",
    type: "multi",
    options: ["FEDEX", "UPS", "USPS", "DHL", "COURIER", "OTHER"].map(
      (value) => ({
        value,
        label: value,
      }),
    ),
  },
  {
    key: "state",
    label: "Ships to",
    type: "multi",
    options: US_STATES.map((state) => ({ value: state, label: state })),
  },
  { key: "medication", label: "Medication", type: "text" },
  { key: "patient", label: "Patient", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "prescriber", label: "Prescriber", type: "text" },
  { key: "directions", label: "Directions", type: "text" },
  { key: "orderId", label: "Order ID", type: "text" },
  { key: "tracking", label: "Tracking", type: "text" },
  { key: "createdAt", label: "Received", type: "dateRange" },
  { key: "submittedAt", label: "Submitted", type: "dateRange" },
  { key: "signedAt", label: "Signed", type: "dateRange" },
  { key: "shipTo", label: "Ship to", type: "text" },
  { key: "patientState", label: "State", type: "text" },
  { key: "daysSupply", label: "Days", type: "text" },
  { key: "dose", label: "Dose", type: "text" },
];

/**
 * The fill queue.
 *
 * A table rather than cards because this is a worklist: a pharmacist filters to
 * what is theirs to do, finds one order by whatever identifier they were given,
 * and acts on it without leaving the row. Allergies stay visible on the row for
 * the same reason they are in the dialog — they are the one thing that should
 * never need a click.
 */
export function QueueTable() {
  const [refreshKey, setRefreshKey] = React.useState(0);

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "medication",
        header: "Medication",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.medication}
            </span>
            <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
              {[
                row.original.strength,
                `qty ${row.original.quantity}`,
                `${row.original.refills} refills`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ),
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
            {row.original.patient.allergies.length ? (
              <Tooltip
                content={`Allergies: ${row.original.patient.allergies.join(", ")}`}
              >
                <span className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--ar-on-warning)]">
                  <AlertTriangleIcon size={12} />
                  {row.original.patient.allergies.join(", ")}
                </span>
              </Tooltip>
            ) : null}
          </div>
        ),
      },
      {
        id: "shipTo",
        header: "Ship to",
        cell: ({ row }) => (
          <Tooltip content={row.original.patient.shipTo}>
            <span className="text-[0.82rem] text-[var(--ar-text-muted)]">
              {row.original.patient.shipTo}
            </span>
          </Tooltip>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div>
            <Badge tone={statusTone(row.original.status)}>
              {row.original.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
            {row.original.externalOrderId ? (
              <span className="mt-1 block text-[0.72rem] tabular-nums text-[var(--ar-text-faint)]">
                {row.original.externalOrderId}
                {row.original.externalRxNumber
                  ? ` · ${row.original.externalRxNumber}`
                  : ""}
              </span>
            ) : null}
            {row.original.transmissionError ? (
              <Tooltip content={row.original.transmissionError}>
                <span className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--ar-danger)]">
                  <AlertTriangleIcon size={12} className="flex-none" />
                  {row.original.transmissionError}
                </span>
              </Tooltip>
            ) : !row.original.reachedYourSystem ? (
              <span
                className="mt-1 block text-[0.72rem] text-[var(--ar-text-faint)]"
                title="It is in this queue and can be filled. It has not been sent to your own system, so do not go looking for it there."
              >
                not in your system yet
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "shipment",
        header: "Shipment",
        cell: ({ row }) =>
          row.original.trackingNumber ? (
            <div className="text-[0.8rem]">
              <span>{row.original.carrier}</span>
              <span className="block tabular-nums text-[var(--ar-text-faint)]">
                {row.original.trackingNumber}
              </span>
            </div>
          ) : (
            <span className="text-[var(--ar-text-faint)]">—</span>
          ),
      },
      {
        id: "createdAt",
        header: "Queued",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-[0.8rem]">
            {formatDateShort(row.original.queuedAt)}
          </span>
        ),
      },
      {
        id: "directions",
        header: "Directions",
        cell: ({ row }) => <Long value={row.original.directions} />,
      },
      {
        id: "daysSupply",
        header: "Days supply",
        cell: ({ row }) => <Num value={row.original.daysSupply} />,
      },
      {
        id: "dose",
        header: "Dose",
        cell: ({ row }) => <Long value={row.original.dose} />,
      },
      {
        id: "prescriber",
        header: "Prescriber",
        cell: ({ row }) => (
          <Stacked primary={row.original.prescriber} strong={false} />
        ),
      },
      {
        id: "signedAt",
        header: "Signed",
        cell: ({ row }) => <When value={row.original.signedAt} />,
      },
      {
        id: "phone",
        header: "Patient phone",
        cell: ({ row }) => <Phone value={row.original.patient.phone} />,
      },
      {
        id: "patientState",
        header: "State",
        cell: ({ row }) => row.original.patient.state ?? "—",
      },
      {
        id: "orderId",
        header: "Your order id",
        cell: ({ row }) => (
          <Stacked
            primary={<Num value={row.original.externalOrderId} />}
            secondary={row.original.externalRxNumber ?? undefined}
            strong={false}
          />
        ),
      },
      {
        id: "tracking",
        header: "Tracking",
        cell: ({ row }) => (
          <Tracking
            carrier={row.original.carrier}
            trackingNumber={row.original.trackingNumber}
          />
        ),
      },
      {
        id: "submittedAt",
        header: "Sent to you",
        cell: ({ row }) => <When value={row.original.submittedAt} />,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <OrderRowActions
            row={row.original as unknown as QueueRow}
            onDone={() => setRefreshKey((value) => value + 1)}
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      key={refreshKey}
      endpoint="v1/dispensary/orders"
      columns={columns}
      sortable={["createdAt", "status", "submittedAt"]}
      filters={filters}
      // A dispensing worklist holds far more than fits: the label details, the
      // prescriber, your own order ids, tracking. On by default is what is
      // needed to pick and pack; the rest is one click away and remembered.
      hiddenByDefault={[
        "directions",
        "daysSupply",
        "dose",
        "prescriber",
        "signedAt",
        "phone",
        "patientState",
        "orderId",
        "tracking",
        "submittedAt",
      ]}
      storageKey="dispensary-queue"
      searchPlaceholder="Search medication, patient, MRN, tracking, order id, prescriber, city…"
      emptyTitle="Nothing to fill"
      emptyHint="Orders arrive here the moment a provider approves a prescription."
    />
  );
}
