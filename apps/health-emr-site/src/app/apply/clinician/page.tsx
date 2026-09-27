import type { Metadata } from 'next';
import { SectionHead } from '@/components/blocks';
import { ClinicianForm } from './form';

export const metadata: Metadata = {
  title: 'Apply as a clinician',
  description:
    'Join the HealthEMR clinician network: review telehealth visits asynchronously in the states you are licensed in, paid per review, with no shifts or minimums.',
  alternates: { canonical: '/apply/clinician' },
};

export default function Page() {
  return (
    <>
      <SectionHead
        as="h1"
        align="left"
        size="display"
        eyebrow="For clinicians"
        title="Join the clinician network"
        lede="Tell us your licences and what you are comfortable reviewing. We verify each licence against its issuing board before it sends you anything."
      />
      <div className="mt-14">
        <ClinicianForm />
      </div>
    </>
  );
}
