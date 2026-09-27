"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/table/data-table";
import { OrderPayloadButton } from "@/components/admin/order-payload";
import type { FilterDef } from "@/components/table/table-toolbar";
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
import Link from "next/link";
import { RerouteSelected, type SelectedPrescription } from "./reroute-selected";
import { RecordRowActions } from "@/components/admin/record-row-actions";

interface Row extends Record<string, unknown> {
  id: string;
  visitId: string;
  masterId: string;
  medication: string;
  dose: string;
  quantity: string;
  refills: number;
  status: string;
  signedAt: string;
  createdAt: string;
  updatedAt: string;
  prescriber: string;
  licence: string;
  patient: {
    id: string;
    mrn: string;
    name: string;
    email: string;
    phone: string;
    state: string;
  };
  tenant: string;
  invoice: {
    id: string;
    number: string;
    status: string;
    totalCents: number;
  } | null;
  shipment: {
    orderId: string;
    pharmacy: string;
    status: string;
    carrier: string | null;
    trackingNumber: string | null;
  } | null;
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
      "SIGNED",
      "TRANSMITTED",
      "DISPENSED",
      "SHIPPED",
      "DELIVERED",
      "VOIDED",
    ].map((value) => ({
      value,
      label: value.toLowerCase(),
    })),
  },
  { key: "medication", label: "Medication", type: "text" },
  { key: "patient", label: "Patient", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "patientState", label: "State", type: "text" },
  { key: "tenant", label: "Account", type: "text" },
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
        id: "patientState",
        header: "State",
        cell: ({ row }) => row.original.patient.state,
      },
      { id: "tenant", header: "Account", accessorKey: "tenant" },
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
        id: "shipment",
        header: "Pharmacy",
        cell: ({ row }) =>
          row.original.shipment ? (
            <Stacked
              primary={row.original.shipment.pharmacy}
              secondary={row.original.shipment.status
                .replace(/_/g, " ")
                .toLowerCase()}
              strong={false}
            />
          ) : (
            <Empty label="not sent" />
          ),
      },
      {
        id: "payload",
        header: "Sent",
        // What actually went to the pharmacy for this fill. Hidden by default:
        // it is an integration question, not a clinical one, and the people who
        // need it know to turn it on.
        cell: ({ row }) =>
          row.original.shipment ? (
            <OrderPayloadButton orderId={row.original.shipment.orderId} label="View" />
          ) : (
            <Empty label="—" />
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
        id: "status",
        header: "Status",
        cell: ({ row }) => <Status value={row.original.status} />,
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
            <Link
              href={`/super-admin/invoices/${row.original.invoice.id}`}
              className="whitespace-nowrap font-medium tabular-nums"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.invoice.number}
            </Link>
          ) : (
            <Empty label="not invoiced" />
          ),
      },
      {
        id: "masterId",
        header: "Order id",
        cell: ({ row }) => <Num value={row.original.masterId} />,
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
        id: "actions",
        header: "Actions",
        enableSorting: false,
        // The delete icon here is permanently disabled and says why: a
        // prescription exists only because a clinician signed it, so
        // withdrawing is the whole of what can happen to one.
        cell: ({ row }) => (
          <RecordRowActions
            kind="prescription"
            id={row.original.id}
            label={row.original.masterId}
            archived={row.original.status === "VOIDED"}
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/prescriptions"
      columns={columns}
      sortable={["signedAt", "status"]}
      hiddenByDefault={[
        "licence",
        "tracking",
        "masterId",
        "invoiceNumber",
        "createdAt",
        "updatedAt",
        "payload",
        // Email is on by default because it is how a support desk finds a
        // person; phone and state are a column away when they need them.
        "phone",
        "patientState",
      ]}
      storageKey="sa-prescriptions"
      // Selection with select-all, and the one bulk action that matters here:
      // when a pharmacy goes down, everything routed to it is stuck at once.
      bulkActions={(chosen, clear) => (
        <RerouteSelected
          selected={chosen as unknown as SelectedPrescription[]}
          clear={clear}
        />
      )}
      filters={filters}
      searchPlaceholder="Search name, email, phone, record number or medication…"
      emptyTitle="No prescriptions yet"
      emptyHint="They appear once a provider signs."
      onRowClick={(row) =>
        router.push(`/super-admin/visits/${row.visitId}/questionnaire`)
      }
    />
  );
}
