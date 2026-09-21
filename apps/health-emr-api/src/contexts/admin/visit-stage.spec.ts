import { VISIT_STAGES, visitStage } from '@health-emr/types';
import { visitStageWhere } from './visit-stage.filter';

/**
 * The stage a client business reads is derived in TypeScript; the filter behind
 * the stage dropdown is reconstructed in SQL. Two definitions of one thing drift
 * unless something holds them together, and a drifted filter is worse than none
 * — it shows a confident, wrong count.
 *
 * So: enumerate the reachable combinations of the three status columns, derive
 * each one's stage, and check the predicates select exactly that stage and no
 * other. The predicate is evaluated here rather than in Postgres, which trades
 * fidelity for covering every combination in milliseconds; the end-to-end suite
 * exercises the real SQL on real rows.
 */

const REQUEST = [
  'RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW',
  'INFO_REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED',
] as const;

const PRESCRIPTION = [
  null, 'SIGNED', 'TRANSMITTED', 'DISPENSED', 'SHIPPED', 'DELIVERED', 'VOIDED',
] as const;

const ORDER = [
  null, 'QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT',
  'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED',
] as const;

const NOW = new Date('2026-03-01T12:00:00.000Z');
const LONG_AGO = new Date('2026-02-28T12:00:00.000Z');
const RECENTLY = new Date('2026-03-01T11:30:00.000Z');

interface Row {
  requestStatus: string;
  prescriptionStatus: string | null;
  orderStatus: string | null;
  orderError: string | null;
  orderSubmittedAt: Date | null;
  signedAt: Date | null;
}

function* rows(): Generator<Row> {
  for (const requestStatus of REQUEST) {
    for (const prescriptionStatus of PRESCRIPTION) {
      for (const orderStatus of ORDER) {
        for (const orderError of [null, 'connect ECONNREFUSED 10.0.0.4:443']) {
          for (const signedAt of [null, LONG_AGO, RECENTLY]) {
            for (const orderSubmittedAt of [null, RECENTLY]) {
              // An order cannot exist without a prescription to hang off.
              if (orderStatus && !prescriptionStatus) continue;
              yield {
                requestStatus, prescriptionStatus, orderStatus,
                orderError, orderSubmittedAt, signedAt,
              };
            }
          }
        }
      }
    }
  }
}

/**
 * Evaluates one Prisma predicate against one row.
 *
 * Only the operators the filter actually uses are implemented. Anything else
 * throws rather than quietly returning false, so adding an operator to the
 * filter without teaching this evaluator fails loudly instead of passing.
 */
function matches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'AND':
        return (value as Record<string, unknown>[]).every((part) => matches(part, row));
      case 'OR':
        return (value as Record<string, unknown>[]).some((part) => matches(part, row));
      case 'NOT':
        return !matches(value as Record<string, unknown>, row);
      case 'status':
        return enumMatch(value, row.requestStatus);
      case 'prescriptions': {
        const some = (value as { some: Record<string, unknown> }).some;
        return row.prescriptionStatus === null ? false : prescriptionMatches(some, row);
      }
      default:
        throw new Error(`the evaluator does not implement "${key}"`);
    }
  });
}

function prescriptionMatches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'status':
        return enumMatch(value, row.prescriptionStatus);
      case 'orders': {
        const some = (value as { some: Record<string, unknown> }).some;
        return row.orderStatus === null ? false : orderMatches(some, row);
      }
      default:
        throw new Error(`the evaluator does not implement prescription."${key}"`);
    }
  });
}

function orderMatches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case 'status':
        return enumMatch(value, row.orderStatus);
      case 'lastError':
        return (value as { not: null }).not === null
          ? row.orderError !== null
          : row.orderError === null;
      case 'submittedAt':
        return value === null ? row.orderSubmittedAt === null : false;
      case 'prescription': {
        const before = (value as { signedAt: { lt: Date } }).signedAt.lt;
        return row.signedAt !== null && row.signedAt < before;
      }
      default:
        throw new Error(`the evaluator does not implement order."${key}"`);
    }
  });
}

function enumMatch(value: unknown, actual: string | null): boolean {
  if (value === null || typeof value === 'string') return actual === value;
  return actual !== null && (value as { in: string[] }).in.includes(actual);
}

function describe_(row: Row): string {
  return [
    row.requestStatus,
    `rx ${row.prescriptionStatus ?? '—'}`,
    `order ${row.orderStatus ?? '—'}`,
    row.orderError ? 'errored' : 'no error',
    row.orderSubmittedAt ? 'sent' : 'unsent',
    row.signedAt === LONG_AGO ? 'signed long ago' : row.signedAt ? 'signed recently' : 'unsigned',
  ].join(' / ');
}

describe('visit stage', () => {
  it('derives exactly the stage its own filter selects, for every combination', () => {
    const disagreements: string[] = [];
    let checked = 0;

    for (const row of rows()) {
      checked += 1;
      const derived = visitStage({ ...row, now: NOW });
      const selected = VISIT_STAGES.filter((stage) =>
        matches(visitStageWhere(stage, NOW) as Record<string, unknown>, row),
      );

      if (selected.length !== 1 || selected[0] !== derived) {
        disagreements.push(`${describe_(row)} → derives ${derived}, filter selects [${selected}]`);
      }
    }

    // Reported rather than counted: a bare "expected 0" tells whoever broke it
    // nothing about which combination broke.
    expect(disagreements.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('calls an approved order stuck once it has sat unsent for hours', () => {
    const base = {
      requestStatus: 'APPROVED',
      prescriptionStatus: 'SIGNED',
      orderStatus: 'QUEUED',
      orderSubmittedAt: null,
      now: NOW,
    };

    expect(visitStage({ ...base, signedAt: RECENTLY })).toBe('APPROVED');
    expect(visitStage({ ...base, signedAt: LONG_AGO })).toBe('STUCK');
  });

  it('calls a failed transmission stuck immediately, without waiting out the clock', () => {
    expect(
      visitStage({
        requestStatus: 'APPROVED',
        prescriptionStatus: 'SIGNED',
        orderStatus: 'QUEUED',
        orderError: 'connect ECONNREFUSED 10.0.0.4:443',
        signedAt: RECENTLY,
        now: NOW,
      }),
    ).toBe('STUCK');
  });

  it('reads a refusal from the request, whatever the pharmacy side says', () => {
    expect(visitStage({ requestStatus: 'DENIED', prescriptionStatus: null })).toBe('REFUSED');
  });

  it('follows the furthest thing that happened, not the tidiest record', () => {
    // A prescription still marked TRANSMITTED while the pharmacy reports the
    // parcel delivered: the patient has it, and that is the honest answer.
    expect(
      visitStage({
        requestStatus: 'APPROVED',
        prescriptionStatus: 'TRANSMITTED',
        orderStatus: 'DELIVERED',
      }),
    ).toBe('DELIVERED');
  });

  it('prefers shipped over stuck when both are true', () => {
    // In transit, but the last transmission attempt errored. The parcel moving
    // is the answer the patient needs; the error is the pharmacy's problem.
    expect(
      visitStage({
        requestStatus: 'APPROVED',
        prescriptionStatus: 'SHIPPED',
        orderStatus: 'QUEUED',
        orderError: 'timeout',
        now: NOW,
      }),
    ).toBe('SHIPPED');
  });
});
