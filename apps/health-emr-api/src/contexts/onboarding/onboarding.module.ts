import { Module } from '@nestjs/common';
import { OnboardingReviewController, PublicOnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Bounded context: onboarding.
 *
 * Owns applications from pharmacies and clinicians who want to work with us,
 * their legal documents, and the review that turns an applicant into a real
 * Pharmacy or ProviderProfile.
 */
@Module({
  controllers: [PublicOnboardingController, OnboardingReviewController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
