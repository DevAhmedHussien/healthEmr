"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import {
  Empty,
  Long,
  Money,
  Num,
  Stacked,
  When,
} from "@/components/table/cells";
import { api } from "@/lib/api";

interface Row extends Record<string, unknown> {
  id: string;
  pharmacyId: string;
  pharmacy: string;
  categoryId: string;
  category: string;
  visitType: string | null;
  favouriteName: string;
  medId: string | null;
  medicationName: string;
  type: "compound" | "med";
  concentration: string | null;
  form: string;
  defaultSig: string | null;
  dispenseQuantity: string | null;
  dispenseUnit: string | null;
  refills: number;
  daysSupply: number | null;
  vialSize: string | null;
  pharmacyNotes: string | null;
  kitCode: string;
  costOfGoodsCents: number | null;
  sellPriceCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Filters {
  pharmacies: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

/**
 * On by default: what it is, who stocks it, and the money.
 *
 * The identifiers and the label text are what you reach for when an order goes
 * wrong, not when you are browsing — so they are a click away rather than in the
 * way of the sixteen rows you are scanning.
 */
const HIDDEN = [
  "medId",
  "kitCode",
  "defaultSig",
  "dispense",
  "refills",
  "notes",
  "visitType",
  "createdAt",
  "updatedAt",
] as const;

export function MedicationCatalogue() {
  const router = useRouter();
  const [options, setOptions] = React.useState<Filters | null>(null);

  React.useEffect(() => {
    api<Filters>("v1/super-admin/medications/filters")
      .then(setOptions)
      // The table still works unfiltered; a failed dropdown is not a failed page.
      .catch(() => setOptions({ pharmacies: [], categories: [] }));
  }, []);

  // A filter keyed to a column id is drawn in a box under that column's header;
  // one that is not — a derived status, a picker spanning several fields — stays
  // in the Filters panel. Each key must be a column the endpoint declares
  // filterable, or the request is refused.
  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        key: "pharmacyId",
        label: "Pharmacy",
        type: "select",
        options: (options?.pharmacies ?? []).map((row) => ({
          value: row.id,
          label: row.name,
        })),
      },
      {
        key: "categoryId",
        label: "Category",
        type: "select",
        options: (options?.categories ?? []).map((row) => ({
          value: row.id,
          label: row.name,
        })),
      },
      {
        key: "form",
        label: "Form",
        type: "select",
        options: ["INJECTABLE", "ORAL", "TOPICAL", "NASAL", "OTHER"].map(
          (value) => ({
            value,
            label: value.toLowerCase(),
          }),
        ),
      },
      {
        key: "problem",
        label: "Pricing",
        type: "select",
        options: [
          { value: "UNPRICED", label: "Not priced" },
          { value: "BELOW_COST", label: "Below cost" },
        ],
      },
      { key: "favouriteName", label: "Product", type: "text" },
      { key: "pharmacy", label: "Pharmacy", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "strength", label: "Strength", type: "text" },
      { key: "dispense", label: "Dispense", type: "text" },
      { key: "medId", label: "Med ID", type: "text" },
      { key: "kitCode", label: "Kit ID", type: "text" },
      { key: "defaultSig", label: "Directions", type: "text" },
      { key: "daysSupply", label: "Days", type: "text" },
      { key: "costOfGoodsCents", label: "Cost", type: "text" },
      { key: "createdAt", label: "Added", type: "dateRange" },
      { key: "sell", label: "We charge", type: "text" },
      { key: "refills", label: "Refills", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
      { key: "visitType", label: "Visit type", type: "text" },
      { key: "updatedAt", label: "Updated", type: "dateRange" },
    ],
    [options],
  );

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "favouriteName",
        header: "Product",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.favouriteName}
            secondary={row.original.medicationName}
          />
        ),
      },
      { id: "pharmacy", header: "Pharmacy", accessorKey: "pharmacy" },
      {
        id: "category",
        header: "Category",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.category}
            secondary={row.original.visitType ?? undefined}
            strong={false}
          />
        ),
      },
      {
        id: "form",
        header: "Type",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.form.toLowerCase()}
            secondary={row.original.type}
            strong={false}
          />
        ),
      },
      {
        id: "strength",
        header: "Strength",
        cell: ({ row }) => row.original.concentration ?? <Empty />,
      },
      {
        id: "dispense",
        header: "Dispense",
        cell: ({ row }) =>
          row.original.dispenseQuantity ? (
            <span className="whitespace-nowrap tabular-nums">
              {row.original.dispenseQuantity} {row.original.dispenseUnit}
            </span>
          ) : (
            <Empty />
          ),
      },
      {
        id: "daysSupply",
        header: "Days",
        cell: ({ row }) => <Num value={row.original.daysSupply} />,
      },
      {
        id: "refills",
        header: "Refills",
        cell: ({ row }) => <Num value={row.original.refills} />,
      },
      {
        id: "costOfGoodsCents",
        header: "Cost",
        cell: ({ row }) => <Money cents={row.original.costOfGoodsCents} />,
      },
      {
        id: "sell",
        header: "We charge",
        cell: ({ row }) =>
          row.original.sellPriceCents === null ? (
            <Badge tone="warning">not priced</Badge>
          ) : (
            <Stacked
              primary={<Money cents={row.original.sellPriceCents} />}
              secondary={
                row.original.marginPercent === null
                  ? "cost unknown"
                  : row.original.marginPercent < 0
                    ? "below cost"
                    : `${row.original.marginPercent}%`
              }
              strong={false}
            />
          ),
      },
      {
        id: "medId",
        header: "Medicine ID",
        // What a client business sends on an intake. The reason an order is
        // rejected is usually that this does not match.
        cell: ({ row }) => <Long value={row.original.medId} />,
      },
      {
        id: "kitCode",
        header: "Kit ID",
        cell: ({ row }) => <Long value={row.original.kitCode} />,
      },
      {
        id: "defaultSig",
        header: "Directions",
        cell: ({ row }) => <Long value={row.original.defaultSig} />,
      },
      {
        id: "notes",
        header: "Pharmacy notes",
        cell: ({ row }) => <Long value={row.original.pharmacyNotes} />,
      },
      {
        id: "visitType",
        header: "Visit type",
        cell: ({ row }) => row.original.visitType ?? <Empty />,
      },
      {
        id: "createdAt",
        header: "Added",
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
      {
        id: "updatedAt",
        header: "Updated",
        cell: ({ row }) => <When value={row.original.updatedAt} />,
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/medications"
      columns={columns}
      sortable={[
        "favouriteName",
        "medicationName",
        "createdAt",
        "costOfGoodsCents",
      ]}
      filters={filters}
      hiddenByDefault={HIDDEN}
      storageKey="sa-medications"
      searchPlaceholder="Search product, medication, kit ID, medicine ID or directions…"
      emptyTitle="Nothing stocked yet"
      emptyHint="Add products from a pharmacy's own catalogue."
      // Editing happens where the product lives, beside the rest of that
      // pharmacy's stock — rather than a second edit surface that can disagree.
      onRowClick={(row) =>
        router.push(`/super-admin/pharmacies/${row.pharmacyId}`)
      }
    />
  );
}
