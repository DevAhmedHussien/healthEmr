"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { US_STATES } from "@health-emr/types";
import { Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import {
  Email,
  Empty,
  Flag,
  Num,
  Phone,
  Stacked,
  When,
} from "@/components/table/cells";

interface Row extends Record<string, unknown> {
  id: string;
  mrn: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  sexAtBirth: string;
  accounts: string[];
  visits: number;
  prescriptions: number;
  allergies: number;
  createdAt: string;
}

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "state",
    label: "State",
    type: "select",
    options: US_STATES.map((state) => ({ value: state, label: state })),
  },
  { key: "mrn", label: "MRN", type: "text" },
  { key: "lastName", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "residenceState", label: "State", type: "text" },
  {
    key: "sexAtBirth",
    label: "Sex",
    type: "select",
    options: [
      { value: "MALE", label: "Male" },
      { value: "FEMALE", label: "Female" },
    ],
  },
  { key: "createdAt", label: "Added", type: "dateRange" },
  { key: "accounts", label: "Accounts", type: "text" },
  {
    key: "visits",
    label: "Visits",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "prescriptions",
    label: "Prescriptions",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "allergies",
    label: "Allergies",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
];

const HIDDEN = ["sexAtBirth", "createdAt"] as const;

export function PatientList() {
  const router = useRouter();

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "mrn",
        header: "Record",
        cell: ({ row }) => <Num value={row.original.mrn} />,
      },
      {
        id: "lastName",
        header: "Patient",
        cell: ({ row }) => <Stacked primary={row.original.name} />,
      },
      {
        id: "email",
        header: "Email",
        cell: ({ row }) => <Email value={row.original.email} />,
      },
      {
        id: "phone",
        header: "Phone",
        cell: ({ row }) => <Phone value={row.original.phone} />,
      },
      { id: "residenceState", header: "State", accessorKey: "state" },
      {
        id: "sexAtBirth",
        header: "Sex at birth",
        cell: ({ row }) => (row.original.sexAtBirth ?? "").toLowerCase() || "—",
      },
      {
        id: "accounts",
        header: "Accounts",
        cell: ({ row }) =>
          row.original.accounts.length ? (
            // One person may buy from several client businesses. The platform is
            // the only role that sees that — each tenant sees its own link only.
            <span className="inline-flex gap-1">
              {row.original.accounts.map((account) => (
                <Badge key={account} tone="primary">
                  {account}
                </Badge>
              ))}
            </span>
          ) : (
            <Empty />
          ),
      },
      {
        id: "visits",
        header: "Visits",
        cell: ({ row }) => <Num value={row.original.visits} />,
      },
      {
        id: "prescriptions",
        header: "Prescriptions",
        cell: ({ row }) => <Num value={row.original.prescriptions} />,
      },
      {
        id: "allergies",
        header: "Allergies",
        cell: ({ row }) => <Flag count={row.original.allergies} />,
      },
      {
        id: "createdAt",
        header: "First seen",
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/patients"
      columns={columns}
      sortable={["createdAt", "lastName", "mrn", "residenceState"]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="sa-patients"
      searchPlaceholder="Search name, record number, email or phone…"
      emptyTitle="No patients yet"
      emptyHint="Patients arrive when a client business submits an intake."
      onRowClick={(row) => router.push(`/super-admin/patients/${row.id}`)}
    />
  );
}
