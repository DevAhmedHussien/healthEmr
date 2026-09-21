import { Prisma } from '@prisma/client';
import { VISIT_STAGES, type VisitStage } from '@health-emr/types';

/**
 * Translates a derived stage back into a database predicate.
 *
 * The stage is computed, not stored, which is what keeps it honest — but a
 * filter still has to run in SQL. Filtering the page in memory after it came
 * back would silently lie about the total and hand the user three rows labelled
 * "127 results", so the predicate is reconstructed here instead.
 *
 * Reconstruction means two definitions of one thing, which is the kind of pair
 * that drifts. Two things stop it. The precedence below mirrors the if-chain in
 * `visitStage()` exactly rather than approximating it, so a stage is "matches
 * its own rule and none of the rules above it" — the same way an if-chain
 * behaves. And `visit-stage.spec.ts` enumerates every reachable combination of
 * the three status columns and asserts the two agree on all of them.
 *
 * One known divergence, deliberate: the derivation reads a visit's most recent
 * prescription and that prescription's most recent order, while these predicates
 * ask whether *any* prescription or order matches. For a visit with a single
 * prescription — every visit this system currently creates — they are the same.
 * If a visit ever carries two, the filter is the more useful of the two
 * behaviours for its job: "show me anything stuck" should find it.
 */

/** Matches the threshold in `visitStage()`. */
const STALLED_AFTER_HOURS = 6;

function anyOrder(where: Prisma.PharmacyOrderWhereInput): Prisma.PrescriptionRequestWhereInput {
  return { prescriptions: { some: { orders: { some: where } } } };
}

function anyPrescription(where: Prisma.PrescriptionWhereInput): Prisma.PrescriptionRequestWhereInput {
  return { prescriptions: { some: where } };
}

/**
 * Each stage's own rule, in the order `visitStage()` tests them.
 *
 * Order is the whole point: `SHIPPED` and `STUCK` can both be true of one row —
 * a parcel is in transit while the pharmacy's last transmission attempt failed —
 * and the derivation resolves that by testing shipped first. So does this.
 */
function rules(now: Date): Array<[VisitStage, Prisma.PrescriptionRequestWhereInput]> {
  const stalledSince = new Date(now.getTime() - STALLED_AFTER_HOURS * 3_600_000);
  const approved: Prisma.PrescriptionRequestWhereInput = { status: 'APPROVED' };

  return [
    [
      'CANCELLED',
      {
        OR: [
          { status: { in: ['CANCELLED', 'EXPIRED'] } },
          { AND: [approved, anyPrescription({ status: 'VOIDED' })] },
        ],
      },
    ],
    ['REFUSED', { status: 'DENIED' }],
    ['INFO_NEEDED', { status: 'INFO_REQUESTED' }],
    [
      'PENDING_REVIEW',
      { status: { in: ['RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW'] } },
    ],
    [
      'DELIVERED',
      {
        AND: [
          approved,
          { OR: [anyPrescription({ status: 'DELIVERED' }), anyOrder({ status: 'DELIVERED' })] },
        ],
      },
    ],
    [
      'SHIPPED',
      {
        AND: [
          approved,
          { OR: [anyPrescription({ status: 'SHIPPED' }), anyOrder({ status: 'SHIPPED' })] },
        ],
      },
    ],
    [
      'BEING_FILLED',
      {
        AND: [
          approved,
          { OR: [anyOrder({ status: 'IN_FULFILMENT' }), anyPrescription({ status: 'DISPENSED' })] },
        ],
      },
    ],
    [
      'SENT_TO_PHARMACY',
      { AND: [approved, anyOrder({ status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] } })] },
    ],
    [
      // Three ways nothing is moving: the pharmacy refused it, the transmission
      // errored, or it has simply sat unsent long enough that waiting is no
      // longer a reasonable explanation. The third is the one that would
      // otherwise go unnoticed, because no failure was ever recorded.
      'STUCK',
      {
        AND: [
          approved,
          {
            OR: [
              anyOrder({ status: { in: ['REJECTED', 'CANCELLED'] } }),
              anyOrder({ status: 'QUEUED', lastError: { not: null } }),
              anyOrder({
                status: 'QUEUED',
                submittedAt: null,
                prescription: { signedAt: { lt: stalledSince } },
              }),
            ],
          },
        ],
      },
    ],
    ['APPROVED', approved],
  ];
}

/**
 * The where-clause for one stage.
 *
 * `now` is a parameter rather than a call to `new Date()` so a test can pin it;
 * a predicate that silently depends on the wall clock is one that cannot be
 * asserted.
 */
export function visitStageWhere(
  stage: VisitStage,
  now: Date = new Date(),
): Prisma.PrescriptionRequestWhereInput {
  const ordered = rules(now);
  const index = ordered.findIndex(([name]) => name === stage);

  // Unreachable through the controller, which validates against VISIT_STAGES,
  // but a stage added to the enum and not to the rules above must fail loudly
  // rather than return "everything".
  if (index === -1) throw new Error(`no filter defined for visit stage "${stage}"`);

  const [, rule] = ordered[index];
  const earlier = ordered.slice(0, index).map(([, where]) => where);

  return earlier.length ? { AND: [rule, ...earlier.map((where) => ({ NOT: where }))] } : rule;
}

/** Every stage has a rule. Asserted at import so a gap cannot ship. */
for (const stage of VISIT_STAGES) {
  if (!rules(new Date(0)).some(([name]) => name === stage)) {
    throw new Error(`visit stage "${stage}" has no filter rule`);
  }
}
