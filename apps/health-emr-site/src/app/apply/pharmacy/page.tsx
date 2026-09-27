import type { Metadata } from 'next';
import { SectionHead } from '@/components/blocks';
import { PharmacyForm } from './form';

export const metadata: Metadata = {
  title: 'Apply as a pharmacy',
  description:
    'Join the HealthEMR pharmacy network: receive signed telehealth prescriptions machine-to-machine through LifeFile, a generic HTTP integration, or a dispensary screen.',
  alternates: { canonical: '/apply/pharmacy' },
};

export default function Page() {
  return (
    <>
      <SectionHead
        as="h1"
        align="left"
        size="display"
        eyebrow="For pharmacies"
        title="Join the pharmacy network"
        lede="Tell us what you dispense and where you ship. We will come back with which brands and categories that covers, and how you would like to receive orders."
      />
      <div className="mt-14">
        <PharmacyForm />
      </div>
    </>
  );
}
