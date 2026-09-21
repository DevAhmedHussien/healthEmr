import { PharmacyApplicationForm } from './form';

export const metadata = { title: 'Apply as a pharmacy — HealthEMR' };

export default function ApplyPharmacy() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-medium">Work with us</h1>
        <p className="mt-2 text-[var(--ar-text-muted)]">
          Tell us about your pharmacy. Once you submit, we will show you exactly which licences and
          registrations we need — the list depends on whether you compound, whether you are a 503B
          outsourcing facility, and which states you ship into.
        </p>
      </div>
      <PharmacyApplicationForm />
    </div>
  );
}
