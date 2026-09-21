"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { US_STATES } from "@health-emr/types";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import {
  Email,
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

/**
 * Everything the record holds is a column here.
 *
 * The ones a support desk reaches for daily are on by default; the rest are a
 * click away in the Columns menu and remembered per person. Putting all eleven
 * on screen at once would make none of them readable, and hiding the others
 * entirely means the data may as well not exist.
 */
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
      endpoint="v1/admin/patients"
      columns={columns}
      sortable={["createdAt", "lastName", "mrn", "residenceState"]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="admin-patients"
      searchPlaceholder="Search name, record number, email or phone…"
      emptyTitle="No patients yet"
      emptyHint="A patient appears here once they complete one of your intake forms."
      onRowClick={(row) =>
        router.push(`/admin/visits?q=${encodeURIComponent(row.mrn)}`)
      }
    />
  );
}
