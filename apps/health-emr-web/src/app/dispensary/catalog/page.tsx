import { Catalog } from './catalog';
import { PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'My catalogue — HealthEMR' };

export default function CatalogPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="My catalogue"
        subtitle="The categories you group stock into and everything in them — kit ID, medication, concentration, form, vial size, days supply and what each costs you."
      />

      {/* Kept out of the header: it is guidance about one field rather than a
          description of the page, and a subtitle that runs to four lines stops
          being read at all. */}
      <p className="max-w-[70ch] text-[0.85rem] leading-relaxed text-[var(--ar-text-muted)]">
        The <strong className="text-[var(--ar-body-color)]">kit ID</strong> is the identifier. It is
        what a client business puts on an order and what your own system fills against, so it has to
        be unique here and it has to match what you use. Everything else on the product — cost of
        goods, days supply, vial size — hangs off it.
      </p>

      <Catalog />
    </div>
  );
}
