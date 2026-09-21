import { Injectable } from '@nestjs/common';
import type { Questionnaire, QuestionnaireResponse } from '@health-emr/types';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { runWithoutTenantScope } from '@/shared/auth/request-context';

/**
 * The questions a visit type asks.
 *
 * Read through the tenant's entitlements rather than straight off the category,
 * so a client cannot discover the questionnaire for a category they are not
 * enabled for — the set of things a competitor sells is not ours to hand out.
 */
@Injectable()
export class QuestionnaireService {
  constructor(private readonly prisma: PrismaService) {}

  async forVisitType(tenantId: string, visitType: string): Promise<QuestionnaireResponse | null> {
    return runWithoutTenantScope(async () => {
      const entitlement = await this.prisma.raw.tenantCategory.findFirst({
        where: { tenantId, category: { slug: visitType, isActive: true } },
        select: { category: { select: { id: true, slug: true, name: true } } },
      });
      if (!entitlement) return null;

      const template = await this.prisma.raw.questionnaireTemplate.findFirst({
        where: { categoryId: entitlement.category.id, isActive: true },
        orderBy: { version: 'desc' },
        select: { version: true, schemaJson: true },
      });
      if (!template) return null;

      return {
        visitType,
        category: { slug: entitlement.category.slug, name: entitlement.category.name },
        version: template.version,
        questionnaire: template.schemaJson as unknown as Questionnaire,
      };
    });
  }
}
