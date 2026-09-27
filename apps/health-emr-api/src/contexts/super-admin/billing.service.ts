import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  InvoiceQuery,
  IssueInvoiceInput,
  RecordPaymentInput,
  ReportKind,
  ReportQuery,
} from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { AuditService } from '@/shared/audit/audit.service';
import { buildOrderBy, listResponse, offsetSkipTake, safeSort } from '@/shared/http/list-query';
import { columnFilterWhere, type ColumnFilterMap } from '@/shared/http/column-filters';

export const INVOICE_SORT = ['createdAt', 'issuedAt', 'totalCents', 'status'] as const;

/** Filterable columns of the invoice table, keyed by the column id. */
export const INVOICE_FILTERS = {
  number: { path: 'number', kind: 'text' },
  tenant: { path: 'tenant.name', kind: 'text' },
  patient: {
    path: 'patient.lastName',
    kind: 'name',
    paths: ['patient.firstName', 'patient.lastName'],
  },
  // `status` is deliberately absent: the endpoint already takes it as a
  // validated enum, and redeclaring it here as loose text would replace that
  // check with none.
  totalCents: { path: 'totalCents', kind: 'number' },
  issuedAt: { path: 'issuedAt', kind: 'date' },
  dueAt: { path: 'dueAt', kind: 'date' },
  paidAt: { path: 'paidAt', kind: 'date' },
  lines: { path: 'lines', kind: 'presence' },
  payments: { path: 'payments', kind: 'presence' },
  createdAt: { path: 'createdAt', kind: 'date' },
} as const satisfies ColumnFilterMap;

/**
 * Billing and reporting.
 *
 * An invoice is generated from what actually happened — the prescription, the
 * price the client quoted, the pharmacy that filled it — rather than typed in.
 * Once issued it is immutable: correcting an issued invoice means voiding it and
 * raising another, because a document somebody has paid against cannot quietly
 * change afterwards.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: InvoiceQuery) {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { tenant: { name: { contains: query.q, mode: 'insensitive' } } },
              { patient: { lastName: { contains: query.q, mode: 'insensitive' } } },
              { patient: { mrn: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...columnFilterWhere(query, INVOICE_FILTERS),
    };

    const sort = safeSort(query.sort, INVOICE_SORT, 'createdAt');

    const [rows, total] = await Promise.all([
      this.prisma.raw.invoice.findMany({
        where,
        orderBy: buildOrderBy(sort, query.order),
        ...offsetSkipTake(query),
        select: {
          id: true, number: true, status: true, currency: true, subtotalCents: true,
          totalCents: true, issuedAt: true, dueAt: true, paidAt: true, source: true, createdAt: true,
          tenant: { select: { id: true, name: true } },
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          _count: { select: { lines: true, payments: true } },
        },
      }),
      this.prisma.raw.invoice.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      currency: row.currency,
      subtotalCents: row.subtotalCents,
      totalCents: row.totalCents,
      source: row.source,
      tenant: row.tenant,
      patient: { id: row.patient.id, name: `${row.patient.firstName} ${row.patient.lastName}`, mrn: row.patient.mrn },
      lines: row._count.lines,
      payments: row._count.payments,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    return listResponse(data, total, query, INVOICE_SORT);
  }

  async get(id: string) {
    const invoice = await this.prisma.raw.invoice.findUnique({
      where: { id },
      select: {
        id: true, number: true, status: true, currency: true, subtotalCents: true, discountCents: true,
        taxCents: true, totalCents: true, source: true, issuedAt: true, dueAt: true, paidAt: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, contactEmail: true, billingPlan: true } },
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        prescription: {
          select: {
            id: true, signedAt: true, providerNameSnapshot: true,
            medication: { select: { name: true, strength: true } },
            orders: { select: { pharmacy: { select: { name: true } }, costOfGoodsCents: true } },
          },
        },
        lines: { select: { id: true, description: true, quantity: true, unitPriceCents: true, totalCents: true } },
        payments: {
          select: { id: true, processor: true, externalId: true, amountCents: true, status: true, paidAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('That invoice does not exist');

    const paidCents = invoice.payments
      .filter((payment) => payment.status === 'SUCCEEDED')
      .reduce((sum, payment) => sum + payment.amountCents, 0);

    return {
      ...invoice,
      patient: {
        id: invoice.patient.id,
        name: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
        mrn: invoice.patient.mrn,
      },
      // Both sides of the balance, so the screen never has to do arithmetic the
      // server can do once and consistently.
      paidCents,
      outstandingCents: Math.max(0, invoice.totalCents - paidCents),
      costOfGoodsCents: invoice.prescription?.orders?.[0]?.costOfGoodsCents ?? null,
    };
  }

  /**
   * Raises a draft invoice for a prescription, from the price the client quoted.
   *
   * Refuses if that prescription already has one: two invoices for one fill is
   * how a patient gets charged twice, and it is far easier to prevent here than
   * to unpick in an accounting system afterwards.
   */
  async createForPrescription(prescriptionId: string, actorUserId: string) {
    const prescription = await this.prisma.raw.prescription.findUnique({
      where: { id: prescriptionId },
      select: {
        id: true, tenantId: true, patientId: true, dose: true, quantity: true,
        medicationId: true,
        medication: { select: { name: true, strength: true } },
        requestItem: { select: { quotedPriceCents: true } },
        invoices: { select: { id: true, number: true } },
        orders: { select: { id: true } },
      },
    });
    if (!prescription) throw new NotFoundException('That prescription does not exist');
    if (prescription.invoices.length) {
      throw new ConflictException(`That prescription is already on invoice ${prescription.invoices[0].number}`);
    }

    const unitPriceCents = prescription.requestItem.quotedPriceCents;
    if (unitPriceCents === null || unitPriceCents === undefined) {
      throw new BadRequestException(
        'That prescription has no quoted price. The client business sends the price with the intake; ' +
          'without it there is nothing to invoice, and inventing a figure would be worse than raising nothing.',
      );
    }

    const description =
      `${prescription.medication.name}${prescription.medication.strength ? ` ${prescription.medication.strength}` : ''}` +
      ` · ${prescription.dose} · qty ${prescription.quantity}`;

    const invoice = await this.prisma.raw.$transaction(async (tx) => {
      const number = await this.nextNumber(tx);
      return tx.invoice.create({
        data: {
          tenantId: prescription.tenantId,
          patientId: prescription.patientId,
          prescriptionId: prescription.id,
          pharmacyOrderId: prescription.orders[0]?.id ?? null,
          number,
          subtotalCents: unitPriceCents,
          totalCents: unitPriceCents,
          status: 'DRAFT',
          source: 'TENANT_QUOTED',
          lines: {
            create: [{
              description,
              medicationId: prescription.medicationId,
              quantity: 1,
              unitPriceCents,
              totalCents: unitPriceCents,
            }],
          },
        },
        select: { id: true, number: true, status: true, totalCents: true, tenantId: true },
      });
    });

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      tenantId: invoice.tenantId,
      patientId: prescription.patientId,
      actorUserId,
      after: { number: invoice.number, totalCents: invoice.totalCents, status: invoice.status },
    });

    return invoice;
  }

  async issue(id: string, input: IssueInvoiceInput, actorUserId: string) {
    const before = await this.prisma.raw.invoice.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, totalCents: true, tenantId: true, patientId: true },
    });
    if (!before) throw new NotFoundException('That invoice does not exist');
    if (before.status !== 'DRAFT') throw new ConflictException(`Invoice ${before.number} is already ${before.status.toLowerCase()}`);
    if (before.totalCents <= 0) throw new BadRequestException('An invoice for nothing cannot be issued');

    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + input.dueInDays * 86_400_000);

    const after = await this.prisma.raw.invoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt, dueAt },
      select: { id: true, number: true, status: true, totalCents: true, issuedAt: true, dueAt: true },
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'Invoice',
      entityId: id,
      tenantId: before.tenantId,
      patientId: before.patientId,
      actorUserId,
      before: { status: before.status },
      after: { number: after.number, status: after.status, dueAt: after.dueAt?.toISOString() ?? null },
    });

    return after;
  }

  async void(id: string, reason: string, actorUserId: string) {
    const before = await this.prisma.raw.invoice.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, tenantId: true, patientId: true },
    });
    if (!before) throw new NotFoundException('That invoice does not exist');
    if (before.status === 'PAID') {
      throw new ConflictException(
        `Invoice ${before.number} has been paid. Refund it rather than voiding — voiding a paid invoice ` +
          'leaves money recorded against a document that claims nothing was owed.',
      );
    }
    if (before.status === 'VOID') throw new ConflictException('That invoice is already void');

    const after = await this.prisma.raw.invoice.update({
      where: { id },
      data: { status: 'VOID' },
      select: { id: true, number: true, status: true },
    });

    await this.audit.record({
      action: 'PHI_UPDATED',
      entityType: 'Invoice',
      entityId: id,
      tenantId: before.tenantId,
      patientId: before.patientId,
      actorUserId,
      before: { status: before.status },
      after: { number: after.number, status: after.status, reason },
    });

    return after;
  }

  async recordPayment(id: string, input: RecordPaymentInput, actorUserId: string) {
    const invoice = await this.prisma.raw.invoice.findUnique({
      where: { id },
      select: {
        id: true, number: true, status: true, totalCents: true, tenantId: true, patientId: true,
        payments: { where: { status: 'SUCCEEDED' }, select: { amountCents: true } },
      },
    });
    if (!invoice) throw new NotFoundException('That invoice does not exist');
    if (invoice.status === 'VOID') throw new ConflictException('That invoice is void');

    const alreadyPaid = invoice.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (alreadyPaid + input.amountCents > invoice.totalCents) {
      throw new BadRequestException(
        `That would take payments to ${formatCents(alreadyPaid + input.amountCents)} against a total of ` +
          `${formatCents(invoice.totalCents)}. Record a refund instead of an overpayment.`,
      );
    }

    const paidAt = input.paidAt ?? new Date();
    const settled = alreadyPaid + input.amountCents === invoice.totalCents;

    const payment = await this.prisma.raw.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          invoiceId: id,
          processor: input.processor,
          externalId: input.externalId ?? null,
          amountCents: input.amountCents,
          status: 'SUCCEEDED',
          paidAt,
        },
        select: { id: true, amountCents: true, processor: true, paidAt: true },
      });

      if (settled) {
        await tx.invoice.update({ where: { id }, data: { status: 'PAID', paidAt } });
      }
      return created;
    });

    await this.audit.record({
      action: 'PHI_CREATED',
      entityType: 'Payment',
      entityId: payment.id,
      tenantId: invoice.tenantId,
      patientId: invoice.patientId,
      actorUserId,
      after: {
        number: invoice.number,
        amountCents: payment.amountCents,
        processor: payment.processor,
        settledInvoice: settled,
      },
    });

    return { ...payment, invoiceSettled: settled };
  }

  /**
   * Sequential invoice numbers, allocated inside the caller's transaction.
   *
   * A count-plus-one would collide the moment two invoices are raised at once,
   * and an invoice number is the one identifier an accountant will quote back at
   * you. The advisory lock serialises allocation without locking the table.
   */
  private async nextNumber(tx: Prisma.TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('invoice-number'))`;
    const year = new Date().getUTCFullYear();
    const prefix = `INV-${year}-`;
    const latest = await tx.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = latest ? Number(latest.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(5, '0')}`;
  }

  // ── reports ──────────────────────────────────────────────────────────────

  async report(kind: ReportKind, query: ReportQuery) {
    const window =
      query.from || query.to
        ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
        : undefined;
    const tenantFilter = query.tenantId ? { tenantId: query.tenantId } : {};

    switch (kind) {
      case 'cost-of-goods':
        return this.costOfGoodsReport(tenantFilter, window);
      case 'revenue':
        return this.revenueReport(tenantFilter, window);
      case 'provider-earnings':
        return this.providerEarningsReport(tenantFilter, window);
      case 'tenant-activity':
        return this.tenantActivityReport(window);
    }
  }

  private async costOfGoodsReport(tenantFilter: object, window: Prisma.DateTimeFilter | undefined) {
    const orders = await this.prisma.raw.pharmacyOrder.findMany({
      where: { ...tenantFilter, ...(window ? { createdAt: window } : {}) },
      select: {
        costOfGoodsCents: true,
        pharmacy: { select: { id: true, name: true } },
        tenant: { select: { name: true } },
        prescription: { select: { medication: { select: { name: true } } } },
      },
    });

    const byPharmacy = new Map<string, { pharmacy: string; orders: number; priced: number; costCents: number }>();
    for (const order of orders) {
      const key = order.pharmacy.id;
      const row = byPharmacy.get(key) ?? { pharmacy: order.pharmacy.name, orders: 0, priced: 0, costCents: 0 };
      row.orders += 1;
      if (order.costOfGoodsCents !== null) {
        row.priced += 1;
        row.costCents += order.costOfGoodsCents;
      }
      byPharmacy.set(key, row);
    }

    const rows = [...byPharmacy.values()].map((row) => ({
      ...row,
      // Published per pharmacy, not just in aggregate: one unpriced catalogue
      // drags the platform figure down and it should be obvious whose.
      coverage: row.orders ? row.priced / row.orders : 0,
      averageCostCents: row.priced ? Math.round(row.costCents / row.priced) : 0,
    }));

    return {
      kind: 'cost-of-goods',
      rows: rows.sort((a, b) => b.costCents - a.costCents),
      totals: {
        orders: orders.length,
        priced: rows.reduce((sum, row) => sum + row.priced, 0),
        costCents: rows.reduce((sum, row) => sum + row.costCents, 0),
      },
    };
  }

  private async revenueReport(tenantFilter: object, window: Prisma.DateTimeFilter | undefined) {
    const items = await this.prisma.raw.prescriptionRequestItem.findMany({
      where: {
        quotedPriceCents: { not: null },
        // Approved or modified only — a denied line was never sold.
        decision: { in: ['APPROVED', 'MODIFIED'] },
        request: { ...tenantFilter, ...(window ? { createdAt: window } : {}) },
      },
      select: {
        quotedPriceCents: true,
        nameText: true,
        request: { select: { tenant: { select: { id: true, name: true } } } },
      },
    });

    const byTenant = new Map<string, { tenant: string; items: number; revenueCents: number }>();
    for (const item of items) {
      const key = item.request.tenant.id;
      const row = byTenant.get(key) ?? { tenant: item.request.tenant.name, items: 0, revenueCents: 0 };
      row.items += 1;
      row.revenueCents += item.quotedPriceCents ?? 0;
      byTenant.set(key, row);
    }

    return {
      kind: 'revenue',
      rows: [...byTenant.values()].sort((a, b) => b.revenueCents - a.revenueCents),
      totals: {
        items: items.length,
        revenueCents: items.reduce((sum, item) => sum + (item.quotedPriceCents ?? 0), 0),
      },
    };
  }

  private async providerEarningsReport(tenantFilter: object, window: Prisma.DateTimeFilter | undefined) {
    const earnings = await this.prisma.raw.providerEarning.findMany({
      where: { ...tenantFilter, ...(window ? { earnedAt: window } : {}) },
      select: {
        amountCents: true, status: true, outcome: true,
        provider: { select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });

    const byProvider = new Map<
      string,
      { provider: string; email: string; reviews: number; approvals: number; denials: number; owedCents: number; paidCents: number }
    >();

    for (const earning of earnings) {
      const key = earning.provider.id;
      const row = byProvider.get(key) ?? {
        provider: `${earning.provider.user.firstName} ${earning.provider.user.lastName}`.trim(),
        email: earning.provider.user.email,
        reviews: 0, approvals: 0, denials: 0, owedCents: 0, paidCents: 0,
      };
      row.reviews += 1;
      if (earning.outcome === 'APPROVED') row.approvals += 1;
      if (earning.outcome === 'DENIED') row.denials += 1;
      if (earning.status === 'PAID') row.paidCents += earning.amountCents;
      else if (earning.status !== 'VOID') row.owedCents += earning.amountCents;
      byProvider.set(key, row);
    }

    return {
      kind: 'provider-earnings',
      rows: [...byProvider.values()].sort((a, b) => b.owedCents - a.owedCents),
      totals: {
        reviews: earnings.length,
        owedCents: [...byProvider.values()].reduce((sum, row) => sum + row.owedCents, 0),
        paidCents: [...byProvider.values()].reduce((sum, row) => sum + row.paidCents, 0),
      },
    };
  }

  private async tenantActivityReport(window: Prisma.DateTimeFilter | undefined) {
    const tenants = await this.prisma.raw.tenant.findMany({
      select: {
        id: true, name: true, status: true,
        _count: { select: { patients: true, requests: true, prescriptions: true, orders: true } },
      },
      orderBy: { name: 'asc' },
    });

    const earnings = await this.prisma.raw.providerEarning.groupBy({
      by: ['tenantId'],
      where: window ? { earnedAt: window } : {},
      _sum: { amountCents: true },
    });
    const feesByTenant = new Map(earnings.map((row) => [row.tenantId, row._sum.amountCents ?? 0]));

    return {
      kind: 'tenant-activity',
      rows: tenants.map((tenant) => ({
        tenant: tenant.name,
        status: tenant.status,
        patients: tenant._count.patients,
        visits: tenant._count.requests,
        prescriptions: tenant._count.prescriptions,
        orders: tenant._count.orders,
        providerFeesCents: feesByTenant.get(tenant.id) ?? 0,
      })),
      totals: {
        tenants: tenants.length,
        prescriptions: tenants.reduce((sum, tenant) => sum + tenant._count.prescriptions, 0),
      },
    };
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Renders report rows as CSV.
 *
 * Quoting is not optional: a pharmacy called "Smith, Jones & Co" silently shifts
 * every column after it in a report somebody then reconciles against.
 */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}
