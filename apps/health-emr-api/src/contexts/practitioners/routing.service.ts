import { Injectable, Logger } from '@nestjs/common';
import type { RoutingOutcome } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { EntitlementsService } from '../tenancy/entitlements.service';

export interface RoutingCandidate {
  providerId: string;
  outcome: RoutingOutcome;
  detail?: string;
}

export interface RoutingDecision {
  assignedProviderId: string | null;
  /** Every provider considered and why. Persisted as RoutingAttempt rows. */
  attempts: RoutingCandidate[];
  /**
   * Structural means no provider could ever serve this — reject at intake so
   * the tenant learns before charging the patient. Transient means everyone
   * qualified is busy right now, so queue and retry.
   */
  failure: 'none' | 'structural' | 'transient';
  reason?: string;
}

/** One medication on the visit, and the categories it may be reviewed under. */
export interface RoutingLine {
  /** Opaque to the router — handed back on the assignment so the caller can match. */
  key: string;
  /** Named in failure text, so a rejection says which product could not be placed. */
  label: string;
  /**
   * Any one of these qualifies a provider. Empty means the catalogue has not
   * filed the medication under a category, which is our data fault and must not
   * strand a patient — such a line falls back to the visit's own category.
   */
  categoryIds: string[];
}

export interface LineAssignment {
  key: string;
  providerId: string;
}

export interface VisitRoutingDecision extends RoutingDecision {
  /** One entry per line. Empty when the visit could not be placed at all. */
  lines: LineAssignment[];
  /** True when no single clinician covered the visit and it was shared out. */
  split: boolean;
}

/** A provider with everything the gates need, loaded once per routing call. */
interface Candidate {
  id: string;
  load: number;
  maxOpenRequests: number;
  isAcceptingRequests: boolean;
  licence: { status: string; expiresAt: Date; licenseNumber: string } | undefined;
  categoryIds: Set<string>;
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Picks a provider for a request.
   *
   *   eligible(provider) =
   *        provider is on this tenant's roster
   *      ∧ provider is accepting work
   *      ∧ ∃ licence in the patient's state that is ACTIVE and unexpired
   *      ∧ that state permits asynchronous prescribing
   *      ∧ provider is qualified for the category
   *      ∧ provider is under their open-request cap
   *
   * State comes from where the patient physically was at submission, never from
   * their mailing address: a provider practises medicine where the patient is.
   */
  async route(params: {
    tenantId: string;
    categoryId: string;
    patientState: string;
  }): Promise<RoutingDecision> {
    const { lines: _lines, split: _split, ...decision } = await this.routeVisit({
      tenantId: params.tenantId,
      patientState: params.patientState,
      fallbackCategoryId: params.categoryId,
      lines: [{ key: 'visit', label: 'this visit', categoryIds: [params.categoryId] }],
    });
    return decision;
  }

  /**
   * Places every medication on a visit.
   *
   * One clinician for the whole visit is always preferred: it is one review, one
   * conversation with the patient and one fee. Only when nobody holds every
   * category the visit spans is the work shared out line by line — each line to
   * someone credentialed for it, and each reviewing clinician paid for the work
   * they actually did.
   *
   * A visit is placed whole or not at all. Assigning three of four lines would
   * leave a patient who has already paid waiting on a medication no one can
   * review, which is worse than a rejection the client can act on.
   */
  async routeVisit(params: {
    tenantId: string;
    patientState: string;
    /** Used for lines the catalogue has not categorised. */
    fallbackCategoryId: string;
    lines: RoutingLine[];
  }): Promise<VisitRoutingDecision> {
    const pool = await this.candidatePool(params.tenantId, params.patientState);
    if ('blocked' in pool) return { ...pool.blocked, lines: [], split: false };

    const lines = params.lines.map((line) => ({
      ...line,
      categoryIds: line.categoryIds.length ? line.categoryIds : [params.fallbackCategoryId],
    }));

    const attempts = new AttemptLog();
    const required = new Set(lines.flatMap((line) => line.categoryIds));

    // Preferred: one clinician who covers every category the visit touches. A
    // line qualifies them if *any* of its categories is one they hold, so the
    // test is per line rather than against the union.
    const covering = this.eligibleFor(
      pool.providers,
      (candidate) => lines.every((line) => line.categoryIds.some((id) => candidate.categoryIds.has(id))),
      attempts,
      lines.length > 1 ? 'every category on this visit' : undefined,
    );

    if (covering.eligible.length) {
      const chosen = this.pick(covering.eligible, attempts);
      return {
        assignedProviderId: chosen,
        attempts: attempts.all(),
        failure: 'none',
        lines: lines.map((line) => ({ key: line.key, providerId: chosen })),
        split: false,
      };
    }

    // Nobody covers the whole visit. Fall back to one clinician per line. This
    // is not a second round of queries — the same pool is re-tested in memory.
    const assignments: LineAssignment[] = [];

    for (const line of lines) {
      const perLine = this.eligibleFor(
        pool.providers,
        (candidate) => line.categoryIds.some((id) => candidate.categoryIds.has(id)),
        attempts,
        lines.length > 1 ? line.label : undefined,
      );

      if (!perLine.eligible.length) {
        // Judged on this line alone. Another line having found a reviewer says
        // nothing about whether this one ever could — reporting "transient"
        // because a colleague could take the *other* medication would have the
        // client retry a visit that will never place.
        const { anyStructurallyEligible } = perLine;
        return {
          assignedProviderId: null,
          attempts: attempts.all(),
          failure: anyStructurallyEligible ? 'transient' : 'structural',
          reason: anyStructurallyEligible
            ? `Every clinician qualified for ${line.label} is at capacity or unavailable`
            : `No clinician licensed in ${params.patientState} is credentialed for ${line.label}`,
          lines: [],
          split: false,
        };
      }

      assignments.push({ key: line.key, providerId: this.pick(perLine.eligible, attempts) });
    }

    const distinct = new Set(assignments.map((row) => row.providerId));
    if (distinct.size === 1) {
      // The per-line pass converged on one clinician anyway — not a split, even
      // though no single candidate satisfied the stricter covering test. That
      // happens when a line falls back to the visit category.
      return {
        assignedProviderId: assignments[0].providerId,
        attempts: attempts.all(),
        failure: 'none',
        lines: assignments,
        split: false,
      };
    }

    // The lead is whoever holds the most lines; ties break on id so the choice
    // is reproducible. Every clinician with a line is paid, but one name has to
    // sit on the visit for the patient's chart and the provider's own caseload.
    const byProvider = new Map<string, number>();
    for (const row of assignments) byProvider.set(row.providerId, (byProvider.get(row.providerId) ?? 0) + 1);
    const lead = [...byProvider.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    this.logger.log(
      `Visit split across ${distinct.size} clinicians — no single provider covers ${[...required].length} categories`,
    );

    return {
      assignedProviderId: lead,
      attempts: attempts.all(),
      failure: 'none',
      lines: assignments,
      split: true,
    };
  }

  /**
   * Everyone on the roster who could take work in this state, with their
   * categories and current load. One query, reused for every line on the visit.
   */
  private async candidatePool(
    tenantId: string,
    patientState: string,
  ): Promise<{ blocked: RoutingDecision } | { providers: Candidate[] }> {
    // Gate 0 — the state itself. Checked before providers because a state that
    // forbids async prescribing makes every provider ineligible, and that is a
    // structural failure worth naming precisely.
    const policy = await this.prisma.raw.statePolicy.findUnique({ where: { state: patientState } });

    if (!policy || !policy.allowsAsyncPrescribing) {
      return {
        blocked: {
          assignedProviderId: null,
          attempts: [],
          failure: 'structural',
          reason: policy
            ? `${patientState} does not permit asynchronous prescribing`
            : `No prescribing policy on record for ${patientState}`,
        },
      };
    }

    const rosterIds = await this.entitlements.rosterProviderIds(tenantId);
    if (rosterIds.length === 0) {
      return {
        blocked: {
          assignedProviderId: null,
          attempts: [],
          failure: 'structural',
          reason: 'No providers are contracted to this tenant',
        },
      };
    }

    const providers = await this.prisma.raw.providerProfile.findMany({
      where: { id: { in: rosterIds } },
      include: {
        licenses: { where: { state: patientState } },
        categories: { select: { categoryId: true } },
        _count: {
          select: {
            requests: { where: { status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] } } },
          },
        },
      },
    });

    // A shared visit does not sit in the lead's caseload alone, so open work is
    // counted from the lines a clinician owns, not from the visits that name
    // them. Without this a second reviewer looks idle and keeps drawing work.
    const sharedLoad = await this.prisma.raw.prescriptionRequestItem.groupBy({
      by: ['assignedProviderId'],
      where: {
        assignedProviderId: { in: rosterIds },
        decision: 'PENDING',
        request: {
          status: { in: ['ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED'] },
          assignedProviderId: { not: null },
        },
      },
      _count: { requestId: true },
    });

    const extra = new Map<string, number>();
    for (const row of sharedLoad) {
      if (row.assignedProviderId) extra.set(row.assignedProviderId, row._count.requestId);
    }

    return {
      providers: providers.map((provider) => ({
        id: provider.id,
        // Visits that name them, plus lines they own on visits that do not.
        // Counting lines rather than visits slightly over-weights a shared
        // visit, which is the right bias: shared work costs more to review.
        load: Math.max(provider._count.requests, extra.get(provider.id) ?? 0),
        maxOpenRequests: provider.maxOpenRequests,
        isAcceptingRequests: provider.isAcceptingRequests,
        licence: provider.licenses[0],
        categoryIds: new Set(provider.categories.map((row) => row.categoryId)),
      })),
    };
  }

  /** Runs the gates in order and returns whoever survives all of them. */
  private eligibleFor(
    providers: Candidate[],
    qualifies: (candidate: Candidate) => boolean,
    attempts: AttemptLog,
    /** Names what they were tested against, when the visit has more than one line. */
    scope: string | undefined,
  ): { eligible: Candidate[]; anyStructurallyEligible: boolean } {
    let anyStructurallyEligible = false;
    const eligible: Candidate[] = [];

    for (const provider of providers) {
      const licence = provider.licence;

      if (!licence) {
        attempts.add({ providerId: provider.id, outcome: 'NO_LICENSE' });
        continue;
      }
      if (licence.status !== 'ACTIVE' || licence.expiresAt <= new Date()) {
        attempts.add({
          providerId: provider.id,
          outcome: 'LICENSE_EXPIRED',
          detail: `Licence ${licence.licenseNumber} is ${licence.status.toLowerCase()}`,
        });
        continue;
      }
      if (!qualifies(provider)) {
        attempts.add({
          providerId: provider.id,
          outcome: 'NOT_QUALIFIED',
          detail: scope ? `not credentialed for ${scope}` : undefined,
        });
        continue;
      }

      // Past this point the provider could serve this request on another day,
      // so any failure below is transient rather than structural.
      anyStructurallyEligible = true;

      if (!provider.isAcceptingRequests) {
        attempts.add({ providerId: provider.id, outcome: 'NOT_ACCEPTING' });
        continue;
      }
      if (provider.load >= provider.maxOpenRequests) {
        attempts.add({
          providerId: provider.id,
          outcome: 'AT_CAPACITY',
          detail: `${provider.load}/${provider.maxOpenRequests} open`,
        });
        continue;
      }

      eligible.push(provider);
    }

    return { eligible, anyStructurallyEligible };
  }

  /**
   * Least-loaded wins; ties break on id so the choice is deterministic and a
   * failed route can be replayed exactly in a test.
   */
  private pick(eligible: Candidate[], attempts: AttemptLog): string {
    const sorted = [...eligible].sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
    const [chosen, ...runnersUp] = sorted;

    // Record the ones who could have taken it too. "Why did nobody get this"
    // and "why did THIS provider get it" are both questions someone asks at 2am.
    for (const runnerUp of runnersUp) {
      attempts.add({
        providerId: runnerUp.id,
        outcome: 'NOT_SELECTED',
        detail: `eligible with ${runnerUp.load} open requests`,
      });
    }

    attempts.add({
      providerId: chosen.id,
      outcome: 'ASSIGNED',
      detail: `${chosen.load} open requests at assignment`,
    });

    return chosen.id;
  }

  /** Persists the audit trail of a routing decision. */
  async recordAttempts(requestId: string, attempts: RoutingCandidate[]): Promise<void> {
    if (attempts.length === 0) return;

    await this.prisma.raw.routingAttempt.createMany({
      data: attempts.map((attempt) => ({
        requestId,
        providerId: attempt.providerId,
        rule: 'eligibility',
        outcome: attempt.outcome,
        detail: attempt.detail ?? null,
      })),
    });
  }
}

/**
 * Collects attempts across the passes a visit makes through the gates.
 *
 * A four-line visit tests the same roster five times, and writing "no licence in
 * Texas" five times for the same provider turns the trail into noise. Identical
 * verdicts collapse; a verdict that differs by line keeps its own row, because
 * that difference is the thing worth reading.
 */
class AttemptLog {
  private readonly seen = new Map<string, RoutingCandidate>();

  add(attempt: RoutingCandidate): void {
    const key = `${attempt.providerId}|${attempt.outcome}|${attempt.detail ?? ''}`;
    if (!this.seen.has(key)) this.seen.set(key, attempt);
  }

  all(): RoutingCandidate[] {
    return [...this.seen.values()];
  }
}
