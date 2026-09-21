'use client';

import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Skeleton,
  TableWrap,
  Textarea,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SimpleSelect } from '@/components/ui/select';
import { EditIcon, PillIcon, PlusIcon, SaveIcon, TrashIcon } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/tooltip';
import { toSlug, MEDICATION_FORMS } from '@health-emr/types';
import { formatMoney } from '@/lib/format';

interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultDaysSupply: number | null;
  sortOrder: number;
  isActive: boolean;
  clinicalCategory: { slug: string; name: string } | null;
  _count: { products: number };
}

interface Product {
  id: string;
  kitCode: string;
  favouriteName: string;
  medicationName: string;
  concentration: string | null;
  form: string;
  vialSize: string | null;
  daysSupply: number | null;
  costOfGoodsCents: number | null;
  sellPriceCents: number | null;
  isActive: boolean;
}

/** Cents in the API, a decimal in the field. Nobody types 8900 for $89. */
const toCents = (value: string) => {
  const amount = Number(value);
  return Number.isFinite(amount) && value.trim() !== '' ? Math.round(amount * 100) : undefined;
};
const fromCents = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);

/**
 * What share of the price we keep, as a short suffix beside it.
 *
 * Just the percentage: the cash margin is one subtraction away from the two
 * columns either side, and spelling it out here made the cell wide enough to
 * push the row's own edit buttons off the panel.
 */
function margin(row: { costOfGoodsCents: number | null; sellPriceCents: number | null }) {
  if (row.sellPriceCents === null) return '';
  // A null cost is unknown, not zero. Reading the whole price as margin would be
  // the most flattering possible interpretation of missing data.
  if (row.costOfGoodsCents === null) return 'cost unknown';

  const profit = row.sellPriceCents - row.costOfGoodsCents;
  const percent = Math.round((profit / row.sellPriceCents) * 100);
  return profit < 0 ? 'below cost' : `${percent}%`;
}

/** Live margin under the price field, so the number is judged as it is typed. */
function marginHint(cost: string, sell: string): string {
  const costCents = toCents(cost);
  const sellCents = toCents(sell);
  if (sellCents === undefined) return 'What a client business pays us for this.';
  if (costCents === undefined) return 'Set the cost of goods to see the margin.';

  const profit = sellCents - costCents;
  const percent = sellCents > 0 ? Math.round((profit / sellCents) * 100) : 0;
  return profit < 0
    ? `Below cost — we lose $${Math.abs(profit / 100).toFixed(2)} on every one.`
    : `Margin $${(profit / 100).toFixed(2)} per unit, ${percent}% of the price.`;
}

export interface CatalogProps {
  /**
   * Path prefix for the catalogue routes. The two surfaces share the same
   * suffixes — `/categories`, `/categories/:id/products`, `/products/:id` — so
   * one component serves both.
   *
   * A pharmacy signs in and edits its own, and the API resolves which from the
   * account: there is no id in that path that could be pointed at somebody
   * else's stock. Super Admin names the pharmacy instead, and the API checks the
   * role.
   */
  base?: string;
  /**
   * Whether this surface may set what the platform charges for a product.
   *
   * False for a pharmacy. They tell us what it costs; our margin on top is not
   * theirs to see or set, and the API rejects the field from that route rather
   * than trusting the form to withhold it.
   */
  canPrice?: boolean;
}

/**
 * A pharmacy's catalogue.
 *
 * Categories on the left, the products in the chosen one on the right.
 */
export function Catalog({ base = 'v1/dispensary/catalog', canPrice = false }: CatalogProps = {}) {
  const [categories, setCategories] = React.useState<Category[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [categoryForm, setCategoryForm] = React.useState<Category | 'new' | null>(null);
  const [productForm, setProductForm] = React.useState<Product | 'new' | null>(null);
  const [confirming, setConfirming] = React.useState<
    { kind: 'category'; row: Category } | { kind: 'product'; row: Product } | null
  >(null);
  const [removing, setRemoving] = React.useState(false);

  const loadCategories = React.useCallback(async () => {
    const response = await api<{ data: Category[] }>(`${base}/categories`);
    setCategories(response.data);
    setSelected((current) => current ?? response.data[0]?.id ?? null);
  }, [base]);

  React.useEffect(() => {
    loadCategories().catch(() => setError('Could not load your catalogue.'));
  }, [loadCategories]);

  React.useEffect(() => {
    if (!selected) {
      setProducts([]);
      return;
    }
    setProducts(null);
    api<{ data: Product[] }>(`${base}/categories/${selected}/products`)
      .then((response) => setProducts(response.data))
      .catch(() => setError('Could not load those products.'));
  }, [base, selected]);

  const reloadProducts = React.useCallback(async () => {
    if (!selected) return;
    const response = await api<{ data: Product[] }>(`${base}/categories/${selected}/products`);
    setProducts(response.data);
  }, [base, selected]);

  const category = categories?.find((row) => row.id === selected) ?? null;

  async function removeCategory(row: Category) {
    setError(null);
    setRemoving(true);
    try {
      const result = await api<{
        deleted: boolean;
        productsDeactivated: number;
      }>(`${base}/categories/${row.id}`, { method: 'DELETE' });
      setNotice(
        result.deleted
          ? `“${row.name}” removed.`
          : `“${row.name}” had ${result.productsDeactivated} product${result.productsDeactivated === 1 ? '' : 's'}, ` +
              'so it and they were deactivated rather than deleted — a kit code that has been dispensed stays on the record.',
      );
      await loadCategories();
      if (selected === row.id) setSelected(null);
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setRemoving(false);
    }
  }

  async function removeProduct(row: Product) {
    setError(null);
    setRemoving(true);
    try {
      const result = await api<{ deleted: boolean; deactivated: boolean }>(
        `${base}/products/${row.id}`,
        { method: 'DELETE' },
      );
      setNotice(
        result.deleted
          ? `“${row.favouriteName}” removed.`
          : `“${row.favouriteName}” has been dispensed, so it was deactivated rather than deleted — it carries the cost basis of those fills.`,
      );
      await Promise.all([reloadProducts(), loadCategories()]);
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {/* `minmax(0,1fr)`, not `1fr`. A grid track's minimum defaults to its
          content, so the products table — two columns wider since the platform
          started pricing — pushed the panel off the page instead of scrolling
          inside it. */}
      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <Card className="p-0">
          <div className="p-5 pb-3">
            <CardHeader
              title="Categories"
              subtitle="How you group your stock."
              action={
                <Button size="sm" icon={PlusIcon} onClick={() => setCategoryForm('new')}>
                  Add
                </Button>
              }
            />
          </div>

          {categories === null ? (
            <div className="space-y-2 px-5 pb-5">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : categories.length === 0 ? (
            <EmptyState
              title="No categories yet"
              hint="Add one — a category holds your products and sets the days supply they inherit."
            />
          ) : (
            <ul className="space-y-1 px-3 pb-4">
              {categories.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.id)}
                    aria-current={row.id === selected ? 'true' : undefined}
                    className={
                      row.id === selected
                        ? 'w-full rounded-[var(--ar-radius)] bg-[var(--ar-primary-soft)] px-3 py-2.5 text-left'
                        : 'w-full rounded-[var(--ar-radius)] px-3 py-2.5 text-left transition hover:bg-[var(--ar-body-bg)]'
                    }
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={
                          row.id === selected
                            ? 'font-medium text-[var(--ar-primary)]'
                            : 'font-medium text-[var(--ar-headings)]'
                        }
                      >
                        {row.name}
                      </span>
                      {row.isActive ? null : <Badge tone="neutral">inactive</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] text-[var(--ar-text-faint)]">
                      {row._count.products} product
                      {row._count.products === 1 ? '' : 's'}
                      {row.defaultDaysSupply
                        ? ` · ${row.defaultDaysSupply}-day supply`
                        : ' · no default supply'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="p-6 pb-3">
            <CardHeader
              title={category ? category.name : 'Products'}
              subtitle={
                category
                  ? [
                      category.description,
                      category.defaultDaysSupply
                        ? `Products here default to a ${category.defaultDaysSupply}-day supply.`
                        : 'No default days supply set for this category.',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : 'Choose a category to see what it holds.'
              }
              action={
                category ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      icon={EditIcon}
                      onClick={() => setCategoryForm(category)}
                    >
                      Edit category
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={TrashIcon}
                      onClick={() => setConfirming({ kind: 'category', row: category })}
                    >
                      Remove
                    </Button>
                    <Button size="sm" icon={PlusIcon} onClick={() => setProductForm('new')}>
                      Add product
                    </Button>
                  </div>
                ) : null
              }
            />
          </div>

          {!category ? (
            <EmptyState title="Nothing selected" hint="Pick a category on the left." />
          ) : products === null ? (
            <div className="space-y-2 px-6 pb-6">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              title="No products in this category"
              hint="Add one with its kit ID, vial size and what it costs you."
            />
          ) : (
            <TableWrap fixed>
              {/* A share of the panel each, so a long favourite name or a
                  32-character kit code ellipses instead of deciding how wide
                  the table is. Both are readable in full on hover. */}
              <colgroup>
                <col style={{ width: canPrice ? '27%' : '34%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                {canPrice ? <col style={{ width: '14%' }} /> : null}
                <col style={{ width: '11%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Kit ID</th>
                  <th scope="col">Strength &amp; vial</th>
                  <th scope="col">Days</th>
                  <th scope="col">Cost</th>
                  {canPrice ? <th scope="col">We charge</th> : null}
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Tooltip content={`${row.favouriteName} · ${row.medicationName}`}>
                        <span className="font-medium text-[var(--ar-headings)]">
                          {row.favouriteName}
                        </span>
                        <span className="block text-[0.75rem] text-[var(--ar-text-faint)]">
                          {row.medicationName}
                          {row.isActive ? '' : ' · inactive'}
                        </span>
                      </Tooltip>
                    </td>
                    <td className="tabular-nums">
                      <Tooltip content={row.kitCode}>{row.kitCode}</Tooltip>
                    </td>
                    <td className="text-[0.82rem]">
                      {row.concentration ?? '—'}
                      {row.vialSize ? ` · ${row.vialSize}` : ''}
                      <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                        {row.form.toLowerCase()}
                      </span>
                    </td>
                    <td className="tabular-nums">{row.daysSupply ?? '—'}</td>
                    <td className="tabular-nums">{formatMoney(row.costOfGoodsCents)}</td>
                    {canPrice ? (
                      <td className="tabular-nums">
                        {row.sellPriceCents === null ? (
                          // Not "$0.00". An unpriced product earns nothing and
                          // still costs us — a problem to fix, not a price.
                          <Badge tone="warning">not priced</Badge>
                        ) : (
                          <>
                            {formatMoney(row.sellPriceCents)}
                            {/* The margin beside the price rather than in its
                                own column: it is derived from the two numbers
                                either side of it, and a column of its own costs
                                the width the row actions need. */}
                            <span className="block text-[0.72rem] text-[var(--ar-text-faint)]">
                              {margin(row)}
                            </span>
                          </>
                        )}
                      </td>
                    ) : null}
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon={EditIcon}
                          aria-label={`Edit ${row.favouriteName}`}
                          onClick={() => setProductForm(row)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          icon={TrashIcon}
                          aria-label={`Remove ${row.favouriteName}`}
                          onClick={() => setConfirming({ kind: 'product', row })}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      {confirming?.kind === 'category' ? (
        <ConfirmDialog
          open
          busy={removing}
          onClose={() => setConfirming(null)}
          onConfirm={() => removeCategory(confirming.row)}
          title="Remove this category?"
          confirmLabel="Remove category"
          body={
            <>
              <strong>{confirming.row.name}</strong> holds{' '}
              {confirming.row._count.products === 0
                ? 'no products'
                : `${confirming.row._count.products} product${confirming.row._count.products === 1 ? '' : 's'}`}
              .
            </>
          }
          consequence={
            confirming.row._count.products === 0
              ? 'It is empty, so it will be deleted outright.'
              : `Because it still holds ${confirming.row._count.products} product${
                  confirming.row._count.products === 1 ? '' : 's'
                }, the category and its products will be deactivated rather than deleted — a kit code that has appeared on a dispensed order stays on the record. They will stop being orderable immediately.`
          }
        />
      ) : null}

      {confirming?.kind === 'product' ? (
        <ConfirmDialog
          open
          busy={removing}
          onClose={() => setConfirming(null)}
          onConfirm={() => removeProduct(confirming.row)}
          title="Remove this product?"
          confirmLabel="Remove product"
          body={
            <>
              <strong>{confirming.row.favouriteName}</strong> — {confirming.row.medicationName}, kit{' '}
              <span className="tabular-nums">{confirming.row.kitCode}</span>.
            </>
          }
          consequence={`Clients order this kit as ${confirming.row.kitCode} and will stop being able to straight away. If it has ever been dispensed it will be deactivated rather than deleted, because it carries the cost basis of those fills — we will tell you which happened.`}
        />
      ) : null}

      {categoryForm ? (
        <CategoryDialog
          base={base}
          category={categoryForm === 'new' ? null : categoryForm}
          onClose={() => setCategoryForm(null)}
          onSaved={async (id) => {
            setCategoryForm(null);
            await loadCategories();
            if (id) setSelected(id);
          }}
        />
      ) : null}

      {productForm && category ? (
        <ProductDialog
          base={base}
          canPrice={canPrice}
          categoryId={category.id}
          categoryDaysSupply={category.defaultDaysSupply}
          product={productForm === 'new' ? null : productForm}
          onClose={() => setProductForm(null)}
          onSaved={async () => {
            setProductForm(null);
            await Promise.all([reloadProducts(), loadCategories()]);
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  base,
  category,
  onClose,
  onSaved,
}: {
  base: string;
  category: Category | null;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const [name, setName] = React.useState(category?.name ?? '');
  const [description, setDescription] = React.useState(category?.description ?? '');
  const [days, setDays] = React.useState(category?.defaultDaysSupply?.toString() ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        defaultDaysSupply: days.trim() === '' ? null : Number(days),
      };
      const saved = await api<{ id: string }>(
        category ? `${base}/categories/${category.id}` : `${base}/categories`,
        { method: category ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(saved.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'Add a category'}
      description="A category groups your stock and sets the days supply its products inherit."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={SaveIcon} onClick={save} disabled={busy || name.trim().length < 1}>
            {busy ? 'Saving…' : category ? 'Save category' : 'Add category'}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-4">
        <Field
          label="Name"
          hint={name.trim() ? `Saved as “${toSlug(name)}”` : 'For example, Weight management'}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>

        <Field
          label="Default days supply"
          hint="How long a normal course here lasts. Products inherit it unless they say otherwise. Leave blank for none."
        >
          <Input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            placeholder="e.g. 28"
          />
        </Field>

        <Field label="Description" hint="Optional.">
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function ProductDialog({
  base,
  canPrice,
  categoryId,
  categoryDaysSupply,
  product,
  onClose,
  onSaved,
}: {
  base: string;
  canPrice: boolean;
  categoryId: string;
  categoryDaysSupply: number | null;
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    kitCode: product?.kitCode ?? '',
    favouriteName: product?.favouriteName ?? '',
    medicationName: product?.medicationName ?? '',
    concentration: product?.concentration ?? '',
    form: product?.form ?? 'OTHER',
    vialSize: product?.vialSize ?? '',
    daysSupply: product?.daysSupply?.toString() ?? '',
    cost: fromCents(product?.costOfGoodsCents),
    sell: fromCents(product?.sellPriceCents),
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        kitCode: form.kitCode.trim(),
        favouriteName: form.favouriteName.trim(),
        medicationName: form.medicationName.trim(),
        concentration: form.concentration.trim() || undefined,
        form: form.form,
        vialSize: form.vialSize.trim() || undefined,
        daysSupply: form.daysSupply.trim() === '' ? undefined : Number(form.daysSupply),
        costOfGoodsCents: toCents(form.cost),
        // Omitted entirely rather than sent as undefined from the pharmacy's own
        // console: the schema on that route is strict and rejects the field, and
        // a form that quietly sends it would fail the whole save.
        ...(canPrice ? { sellPriceCents: toCents(form.sell) } : {}),
      };
      await api(
        product ? `${base}/products/${product.id}` : `${base}/categories/${categoryId}/products`,
        { method: product ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const complete = form.kitCode.trim() && form.favouriteName.trim() && form.medicationName.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Edit product' : 'Add a product'}
      description="Everything an order needs: your kit ID, what it is, how much is in the vial, how long it lasts and what it costs you."
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={PillIcon} onClick={save} disabled={busy || !complete}>
            {busy ? 'Saving…' : product ? 'Save product' : 'Add product'}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kit ID" hint="The code your own system expects on an order.">
          <Input
            value={form.kitCode}
            onChange={(event) => set('kitCode')(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Favourite name" hint="The shorthand your staff recognise.">
          <Input
            value={form.favouriteName}
            onChange={(event) => set('favouriteName')(event.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Medication name" hint="As it should read on the label.">
            <Input
              value={form.medicationName}
              onChange={(event) => set('medicationName')(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Concentration" hint="e.g. 2.5mg/mL">
          <Input
            value={form.concentration}
            onChange={(event) => set('concentration')(event.target.value)}
          />
        </Field>
        <Field label="Form">
          <SimpleSelect
            value={form.form}
            onValueChange={set('form')}
            options={MEDICATION_FORMS.map((value) => ({
              value,
              label: value.toLowerCase(),
            }))}
          />
        </Field>

        <Field label="Vial or pack size" hint="e.g. 10mL vial, 90 tablets">
          <Input value={form.vialSize} onChange={(event) => set('vialSize')(event.target.value)} />
        </Field>
        <Field
          label="Days supply"
          hint={
            categoryDaysSupply
              ? `Blank inherits this category's ${categoryDaysSupply} days.`
              : 'How long one of these lasts a patient.'
          }
        >
          <Input
            type="number"
            min={1}
            max={3650}
            value={form.daysSupply}
            onChange={(event) => set('daysSupply')(event.target.value)}
            placeholder={categoryDaysSupply ? String(categoryDaysSupply) : ''}
          />
        </Field>

        <Field
          label="Cost of goods"
          hint={
            canPrice
              ? 'What the pharmacy charges us, per unit.'
              : 'What this costs you, per unit. Used for margin reporting.'
          }
        >
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.cost}
            onChange={(event) => set('cost')(event.target.value)}
            placeholder="0.00"
          />
        </Field>

        {canPrice ? (
          <Field label="We charge" hint={marginHint(form.cost, form.sell)}>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.sell}
              onChange={(event) => set('sell')(event.target.value)}
              placeholder="0.00"
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
