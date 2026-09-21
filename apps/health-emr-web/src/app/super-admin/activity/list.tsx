"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/primitives";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { Long, Num, Stacked } from "@/components/table/cells";
import { formatDateTime } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";

interface Row extends Record<string, unknown> {
  id: string;
  sequence: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  actor: { id: string; name: string; email: string; role: string } | null;
  tenant: { id: string; name: string } | null;
  changes: Array<{ field: string; from: unknown; to: unknown }> | null;
  ip: string | null;
  at: string;
}

/** The actions worth filtering to. Everything else is reachable by search. */
const ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "BREAK_THE_GLASS",
  "APPLICATION_DECIDED",
  "PRESCRIPTION_SIGNED",
  "ORDER_SUBMITTED",
  "ORDER_STATUS_CHANGED",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_REACTIVATED",
  "USER_DEACTIVATED",
  "TENANT_UPDATED",
  "ENTITLEMENT_CHANGED",
  "INVITE_SENT",
  "INVITE_ACCEPTED",
  "PHI_CREATED",
  "PHI_UPDATED",
  "PHI_DELETED",
  "PHI_READ",
];

const TONE: Record<
  string,
  "success" | "danger" | "warning" | "info" | "neutral"
> = {
  ACCOUNT_SUSPENDED: "danger",
  USER_DEACTIVATED: "danger",
  PHI_DELETED: "danger",
  BREAK_THE_GLASS: "warning",
  LOGIN_FAILED: "warning",
  ACCOUNT_REACTIVATED: "success",
  APPLICATION_DECIDED: "info",
  PRESCRIPTION_SIGNED: "info",
};

// A filter keyed to a column id is drawn in a box under that column's header;
// one that is not — a derived status, a scope spanning several fields — stays
// in the Filters panel. Each key must be a column the endpoint declares
// filterable, or the request is refused.
const filters: FilterDef[] = [
  {
    key: "action",
    label: "Action",
    type: "select",
    options: ACTIONS.map((action) => ({
      value: action,
      label: action.replace(/_/g, " ").toLowerCase(),
    })),
  },
  { key: "entityType", label: "Record type", type: "text" },
  { key: "actor", label: "Actor", type: "text" },
  { key: "tenant", label: "Account", type: "text" },
  { key: "entity", label: "Entity", type: "text" },
  { key: "ip", label: "IP", type: "text" },
  { key: "createdAt", label: "When", type: "dateRange" },
  { key: "sequence", label: "Seq", type: "text" },
];

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function ActivityList() {
  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "sequence",
        header: "#",
        cell: ({ row }) => (
          <span className="tabular-nums text-[0.78rem] text-[var(--ar-text-faint)]">
            {row.original.sequence}
          </span>
        ),
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <Badge tone={TONE[row.original.action] ?? "neutral"}>
            {row.original.action.replace(/_/g, " ").toLowerCase()}
          </Badge>
        ),
      },
      {
        id: "summary",
        header: "What happened",
        cell: ({ row }) => (
          <div>
            <Tooltip content={row.original.summary}>
              <span className="text-[var(--ar-body-color)]">
                {row.original.summary}
              </span>
            </Tooltip>
            {row.original.changes?.length ? (
              <ul className="mt-1 space-y-0.5">
                {row.original.changes.slice(0, 3).map((change) => (
                  <li
                    key={change.field}
                    className="text-[0.75rem] text-[var(--ar-text-muted)]"
                  >
                    <span className="font-medium">{change.field}</span>:{" "}
                    <span className="line-through opacity-70">
                      {show(change.from)}
                    </span>{" "}
                    → {show(change.to)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ),
      },
      {
        id: "actor",
        header: "Who",
        cell: ({ row }) =>
          row.original.actor ? (
            <div>
              <span>{row.original.actor.name}</span>
              <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                {row.original.actor.role.toLowerCase()}
                {row.original.ip ? ` · ${row.original.ip}` : ""}
              </span>
            </div>
          ) : (
            <span className="text-[var(--ar-text-faint)]">system</span>
          ),
      },
      {
        id: "tenant",
        header: "Account",
        cell: ({ row }) =>
          row.original.tenant?.name ?? (
            <span className="text-[var(--ar-text-faint)]">—</span>
          ),
      },
      {
        id: "entity",
        header: "Record",
        cell: ({ row }) => (
          <Stacked
            primary={row.original.entityType}
            secondary={row.original.entityId ?? undefined}
            strong={false}
          />
        ),
      },
      {
        id: "changes",
        header: "Changed",
        // The audit entry's own diff. Long, so it is readable on hover rather
        // than allowed to set the width of the table.
        cell: ({ row }) => (
          <Long
            value={
              row.original.changes ? JSON.stringify(row.original.changes) : null
            }
          />
        ),
      },
      {
        id: "ip",
        header: "From",
        cell: ({ row }) => <Num value={row.original.ip} />,
      },
      {
        id: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-[0.8rem]">
            {formatDateTime(row.original.at)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable<Row>
      endpoint="v1/super-admin/activity"
      columns={columns}
      sortable={["createdAt", "action"]}
      filters={filters}
      hiddenByDefault={["entity", "changes", "ip"]}
      storageKey="sa-activity"
      searchPlaceholder="Search by record type, id or who acted…"
      emptyTitle="Nothing recorded"
      emptyHint="Every privileged action lands here as it happens."
    />
  );
}
