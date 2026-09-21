import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <p className="text-sm font-semibold text-[var(--ar-primary)]">404</p>
        <h1 className="mt-2 text-2xl font-medium">We could not find that</h1>
        <p className="mt-2 text-sm text-[var(--ar-text-muted)]">
          The page may have moved, or you may not have access to it.
        </p>
        <Link
          href="/"
          className="bg-[var(--ar-primary)] mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-medium text-white"
        >
          Go back
        </Link>
      </div>
    </div>
  );
}
