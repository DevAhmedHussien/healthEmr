import { Module } from '@nestjs/common';
import { PrescribingController } from './prescribing.controller';
import { PrescribingService } from './prescribing.service';
import { EarningsService } from './earnings.service';
import { MessagingModule } from '@/contexts/messaging/messaging.module';

/**
 * Bounded context: prescribing.
 *
 * Owns the review queue, the decision on each line, and the signed prescription.
 * The one place in the system where a clinical order comes into being.
 */
@Module({
  // A clinician asks the patient a question in the conversation they already
  // have, rather than this context growing a messaging system of its own.
  imports: [MessagingModule],
  controllers: [PrescribingController],
  providers: [PrescribingService, EarningsService],
  exports: [PrescribingService, EarningsService],
})
export class PrescribingModule {}
