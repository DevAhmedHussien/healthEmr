import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/shared/prisma/prisma.service';

/**
 * How long a clinician was actually working, per day.
 *
 * There is no session timer in this system and adding one would not help: a
 * browser left open overnight would report sixteen hours of diligent review. So
 * active time is reconstructed from what the person actually did — the audit
 * trail already records every action they took, with a timestamp, and that is a
 * better witness than a heartbeat from an idle tab.
 *
 * Consecutive actions are grouped into a working session, and a gap longer than
 * IDLE_GAP_MINUTES ends one. The sum of those sessions is the day's active
 * time. It is an estimate and the interface says so — but it is an estimate
 * anchored to evidence, and it cannot be inflated by leaving a tab open.
 */
@Injectable()
export class ProviderActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** No action for this long means they stopped working, not that they paused. */
  private static readonly IDLE_GAP_MINUTES = 20;

  /**
   * Credited after the last recorded action in a session.
   *
   * Without it a session containing one action lasts zero minutes — a clinician
   * who signed in, decided one visit and left would show as having worked no
   * time at all. Reading the chart and deciding takes longer than the instant
   * the click was recorded.
   */
  private static readonly TAIL_MINUTES = 2;

  async forProvider(providerId: string, days: number, timeZone: string) {
    const provider = await this.prisma.raw.providerProfile.findUnique({
      where: { id: providerId },
      select: { userId: true, user: { select: { firstName: true, lastName: true } } },
    });
    if (!provider) throw new NotFoundException('That provider does not exist');

    return this.forUser(provider.userId, days, timeZone, {
      name: `${provider.user.firstName} ${provider.user.lastName}`.trim(),
    });
  }

  async forUser(
    userId: string,
    days: number,
    timeZone: string,
    extra: { name?: string } = {},
  ) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.daily(userId, since, timeZone);

    const byDay = new Map(rows.map((row) => [row.day, row]));
    // Every day in the window, including the ones with nothing on them. A chart
    // that silently omits quiet days compresses the gaps and reads as steadier
    // work than actually happened.
    const series: DailyActivity[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = dayKey(new Date(Date.now() - offset * 86_400_000), timeZone);
      const row = byDay.get(day);
      series.push({
        day,
        activeMinutes: row ? Math.round(Number(row.minutes)) : 0,
        sessions: row ? Number(row.sessions) : 0,
        actions: row ? Number(row.actions) : 0,
        decisions: row ? Number(row.decisions) : 0,
      });
    }

    const totalMinutes = series.reduce((sum, row) => sum + row.activeMinutes, 0);
    const workedDays = series.filter((row) => row.activeMinutes > 0).length;
    const totalDecisions = series.reduce((sum, row) => sum + row.decisions, 0);

    return {
      ...extra,
      timeZone,
      days,
      series,
      totals: {
        activeMinutes: totalMinutes,
        activeHours: round1(totalMinutes / 60),
        workedDays,
        // Averaged over the days they actually worked, not over the window: a
        // clinician who works intensely two days a week is not doing "half an
        // hour a day", and reporting it that way misrepresents both numbers.
        averageMinutesPerWorkedDay: workedDays ? Math.round(totalMinutes / workedDays) : 0,
        decisions: totalDecisions,
        /** Minutes of recorded activity per decision — a rough pace. */
        minutesPerDecision: totalDecisions ? round1(totalMinutes / totalDecisions) : null,
      },
      basis: {
        idleGapMinutes: ProviderActivityService.IDLE_GAP_MINUTES,
        tailMinutes: ProviderActivityService.TAIL_MINUTES,
        note: 'Derived from recorded actions, not from a session timer. A gap longer than the idle window ends a session.',
      },
    };
  }

  /**
   * Sessionised in the database rather than in memory.
   *
   * A busy clinician generates thousands of audit rows a month, and pulling
   * them all back to group them here would be a lot of traffic to compute a
   * handful of numbers. Window functions do the grouping where the data is.
   */
  private daily(userId: string, since: Date, timeZone: string) {
    return this.prisma.raw.$queryRaw<RawDay[]>`
      WITH events AS (
        SELECT
          "createdAt" AS at,
          action,
          LAG("createdAt") OVER (ORDER BY "createdAt") AS previous
        FROM audit_logs
        WHERE "actorUserId" = ${userId}::uuid
          AND "createdAt" >= ${since}
      ),
      marked AS (
        SELECT
          at,
          action,
          CASE
            WHEN previous IS NULL
              OR at - previous > make_interval(mins => ${ProviderActivityService.IDLE_GAP_MINUTES}::int)
            THEN 1 ELSE 0
          END AS starts_session
        FROM events
      ),
      grouped AS (
        SELECT at, action, SUM(starts_session) OVER (ORDER BY at) AS session_no
        FROM marked
      ),
      spans AS (
        SELECT
          session_no,
          MIN(at) AS started,
          MAX(at) AS ended,
          COUNT(*) AS actions,
          COUNT(*) FILTER (WHERE action = 'REQUEST_DECIDED') AS decisions
        FROM grouped
        GROUP BY session_no
      )
      SELECT
        to_char(started AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
        SUM(EXTRACT(EPOCH FROM (ended - started)) / 60.0)
          + (COUNT(*) * ${ProviderActivityService.TAIL_MINUTES}) AS minutes,
        COUNT(*) AS sessions,
        SUM(actions) AS actions,
        SUM(decisions) AS decisions
      FROM spans
      GROUP BY 1
      ORDER BY 1
    `;
  }

  /**
   * The whole roster at a glance, for the platform's own overview.
   *
   * One query for everybody rather than one per clinician: a directory of forty
   * would otherwise be forty round trips to draw one column.
   */
  async roster(days: number, timeZone: string) {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await this.prisma.raw.$queryRaw<RosterRow[]>`
      WITH events AS (
        SELECT
          a."actorUserId" AS user_id,
          a."createdAt" AS at,
          a.action,
          LAG(a."createdAt") OVER (PARTITION BY a."actorUserId" ORDER BY a."createdAt") AS previous
        FROM audit_logs a
        JOIN users u ON u.id = a."actorUserId"
        WHERE u.role = 'PROVIDER' AND a."createdAt" >= ${since}
      ),
      marked AS (
        SELECT
          user_id, at, action,
          CASE
            WHEN previous IS NULL
              OR at - previous > make_interval(mins => ${ProviderActivityService.IDLE_GAP_MINUTES}::int)
            THEN 1 ELSE 0
          END AS starts_session
        FROM events
      ),
      grouped AS (
        SELECT
          user_id, at, action,
          SUM(starts_session) OVER (PARTITION BY user_id ORDER BY at) AS session_no
        FROM marked
      ),
      spans AS (
        SELECT
          user_id, session_no,
          MIN(at) AS started, MAX(at) AS ended,
          COUNT(*) FILTER (WHERE action = 'REQUEST_DECIDED') AS decisions
        FROM grouped
        GROUP BY user_id, session_no
      )
      SELECT
        s.user_id,
        u.email,
        u."firstName" AS first_name,
        u."lastName" AS last_name,
        p.id AS provider_id,
        SUM(EXTRACT(EPOCH FROM (s.ended - s.started)) / 60.0)
          + (COUNT(*) * ${ProviderActivityService.TAIL_MINUTES}) AS minutes,
        COUNT(*) AS sessions,
        SUM(s.decisions) AS decisions,
        COUNT(DISTINCT to_char(s.started AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')) AS worked_days,
        MAX(s.ended) AS last_seen
      FROM spans s
      JOIN users u ON u.id = s.user_id
      JOIN provider_profiles p ON p."userId" = s.user_id
      GROUP BY s.user_id, u.email, u."firstName", u."lastName", p.id
      ORDER BY minutes DESC
    `;

    return {
      days,
      timeZone,
      data: rows.map((row) => {
        const minutes = Math.round(Number(row.minutes));
        const workedDays = Number(row.worked_days);
        return {
          providerId: row.provider_id,
          userId: row.user_id,
          name: `${row.first_name} ${row.last_name}`.trim(),
          email: row.email,
          activeMinutes: minutes,
          activeHours: round1(minutes / 60),
          sessions: Number(row.sessions),
          decisions: Number(row.decisions),
          workedDays,
          averageMinutesPerWorkedDay: workedDays ? Math.round(minutes / workedDays) : 0,
          lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
        };
      }),
    };
  }
}

export interface DailyActivity {
  /** YYYY-MM-DD in the requested zone. */
  day: string;
  activeMinutes: number;
  sessions: number;
  actions: number;
  decisions: number;
}

interface RawDay {
  day: string;
  minutes: Prisma.Decimal | number;
  sessions: bigint | number;
  actions: bigint | number;
  decisions: bigint | number;
}

interface RosterRow {
  user_id: string;
  provider_id: string;
  email: string;
  first_name: string;
  last_name: string;
  minutes: Prisma.Decimal | number;
  sessions: bigint | number;
  decisions: bigint | number;
  worked_days: bigint | number;
  last_seen: Date | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The calendar day a moment falls on, in the zone being reported. */
function dayKey(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}
