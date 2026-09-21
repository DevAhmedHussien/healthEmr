import Link from 'next/link';

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-10 flex items-center gap-2.5">
        <Link href="/welcome" className="flex items-center gap-2.5">
          <div className="bg-[var(--ar-primary)] grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold text-white">
            H
          </div>
          <span className="font-semibold">HealthEMR</span>
        </Link>
      </header>
      {children}
    </div>
  );
}
