"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Badge, Button, statusTone } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { z } from "zod";
import { Form } from "@/components/form/form";
import { MaskedField, TextField } from "@/components/form/fields";
import { DataTable } from "@/components/table/data-table";
import type { FilterDef } from "@/components/table/table-toolbar";
import { Email, Num, Phone, When } from "@/components/table/cells";
import { api, ApiError } from "@/lib/api";
import { UserPlusIcon } from "@/components/ui/icons";
import { AccountRowActions } from "@/components/admin/account-row-actions";

const FORM_ID = "create-admin";

interface Row extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  ownerName: string | null;
  email: string;
  phone: string | null;
  status: string;
  patients: number;
  providers: number;
  pharmacies: number;
  ordersThisMonth: number;
  lastActivity: string | null;
  inviteOutstanding: boolean;
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
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "SUSPENDED", label: "Suspended" },
      { value: "CLOSED", label: "Closed" },
    ],
  },
  { key: "name", label: "Business", type: "text" },
  { key: "owner", label: "Owner", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "slug", label: "Slug", type: "text" },
  { key: "createdAt", label: "Added", type: "dateRange" },
  {
    key: "patients",
    label: "Patients",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "providers",
    label: "Providers",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
  {
    key: "pharmacies",
    label: "Pharmacies",
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "any", label: "Any" },
    ],
  },
];

export function AdminAccounts() {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);

  const columns = React.useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Business",
        cell: ({ row }) => (
          <div>
            <span className="font-medium text-[var(--ar-headings)]">
              {row.original.name}
            </span>
            <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
              {row.original.slug}
            </span>
          </div>
        ),
      },
      {
        id: "owner",
        header: "Owner",
        cell: ({ row }) => (
          <div>
            <span>{row.original.ownerName ?? "—"}</span>
            {/* <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">{row.original.email}</span> */}
          </div>
        ),
      },
      {
        id: "email",
        header: "Email",
        cell: ({ row }) => <Email value={row.original.email} />,
      },

      {
        id: "patients",
        header: "Patients",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.patients}</span>
        ),
      },
      {
        id: "providers",
        header: "Providers",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.providers}</span>
        ),
      },
      {
        id: "pharmacies",
        header: "Pharmacies",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.pharmacies}</span>
        ),
      },
      {
        id: "ordersThisMonth",
        header: "Orders (month)",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.ordersThisMonth}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Badge tone={statusTone(row.original.status)}>
              {row.original.status.toLowerCase()}
            </Badge>
            {row.original.inviteOutstanding ? (
              <Badge tone="warning">invite pending</Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "phone",
        header: "Phone",
        cell: ({ row }) => <Phone value={row.original.phone} />,
      },
      {
        id: "slug",
        header: "Slug",
        // The identifier their API key and every intake payload is keyed on.
        cell: ({ row }) => <Num value={row.original.slug} />,
      },
      {
        id: "lastActivity",
        header: "Last active",
        cell: ({ row }) => <When value={row.original.lastActivity} />,
      },
      {
        id: "createdAt",
        header: "Joined",
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
      {
        id: "actions",
        // Named, and named the same in every table. A blank header saves a
        // little width and costs the column its place in the row a screen
        // reader announces — and leaves sighted readers to work out from the
        // icons what the column is for.
        header: "Actions",
        enableSorting: false,
        // Last and right-aligned: an action column that sorts or takes width
        // from a header is a column pretending to be data.
        cell: ({ row }) => (
          <AccountRowActions
            kind="tenant"
            id={row.original.id}
            name={row.original.name}
            archived={row.original.status === "ARCHIVED"}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={UserPlusIcon} onClick={() => setShowForm(true)}>
          Add client account
        </Button>
      </div>

      <CreateAdminDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onCreated={() => {
          setShowForm(false);
          router.refresh();
        }}
      />

      <DataTable<Row>
        endpoint="v1/super-admin/admins"
        columns={columns}
        sortable={["name", "slug", "createdAt", "status"]}
        filters={filters}
        hiddenByDefault={["phone", "slug", "lastActivity", "createdAt"]}
        storageKey="sa-admins"
        searchPlaceholder="Search business, owner or email…"
        emptyTitle="No admin accounts yet"
        emptyHint="Add one to onboard a telehealth business."
        onRowClick={(row) => router.push(`/super-admin/admins/${row.id}`)}
      />
    </div>
  );
}

const createAdminSchema = z.object({
  businessName: z.string().trim().min(2, "Business name is required").max(200),
  ownerName: z.string().trim().min(2, "Owner name is required").max(200),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email"),
  phone: z.string().trim().optional(),
});

type CreateAdminValues = z.infer<typeof createAdminSchema>;

/**
 * Add a client account.
 *
 * A dialog rather than a panel that pushes the table down the page: adding one
 * is a short, self-contained task, and the list it is added to should stay put
 * behind it. Same shell as every other add and edit in the console, so the
 * confirm button is always in the same corner.
 *
 * No password is set here. The owner receives an invite and chooses their own —
 * an account whose first credential was typed by somebody else is one nobody can
 * honestly say only they know.
 */
function CreateAdminDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [errors, setErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<string | null>(null);

  // Reset on each open, or a second account starts with the first one's errors.
  React.useEffect(() => {
    if (open) {
      setErrors([]);
      setCreated(null);
      setBusy(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a client account"
      description={[
        "The telehealth business you are onboarding, and whoever will run it.",
        "They receive an invite and set their own password — none is created here.",
      ]}
      footer={
        created ? (
          <Button onClick={onCreated}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {/* Outside the form, so `form=` is what submits it. */}
            <Button
              type="submit"
              form={FORM_ID}
              icon={UserPlusIcon}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create and send invite"}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <Alert tone="success">
          Created <strong>{created}</strong>. An invite is on its way to the
          owner.
        </Alert>
      ) : (
        <Form<CreateAdminValues>
          id={FORM_ID}
          className="space-y-4"
          schema={createAdminSchema}
          defaultValues={{
            businessName: "",
            ownerName: "",
            email: "",
            phone: "",
          }}
          onSubmit={async (values) => {
            setBusy(true);
            setErrors([]);
            try {
              const result = await api<{ slug: string }>(
                "v1/super-admin/admins",
                {
                  method: "POST",
                  body: JSON.stringify({
                    ...values,
                    phone: values.phone || undefined,
                    categorySlugs: [],
                  }),
                },
              );
              setCreated(result.slug);
            } catch (caught) {
              setErrors(
                caught instanceof ApiError && Array.isArray(caught.details)
                  ? (caught.details as Array<{ message: string }>).map(
                      (issue) => issue.message,
                    )
                  : [(caught as Error).message],
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {errors.length > 0 ? (
            <Alert>
              <ul className="list-disc space-y-0.5 pl-4">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField<CreateAdminValues>
              name="businessName"
              label="Business name"
              required
            />
            <TextField<CreateAdminValues>
              name="ownerName"
              label="Owner name"
              required
            />
            <TextField<CreateAdminValues>
              name="email"
              label="Owner email"
              type="email"
              hint="Where the invite goes"
              required
            />
            <MaskedField<CreateAdminValues>
              name="phone"
              label="Phone"
              mask="phone"
              placeholder="(555) 123-4567"
            />
          </div>
        </Form>
      )}
    </Modal>
  );
}
