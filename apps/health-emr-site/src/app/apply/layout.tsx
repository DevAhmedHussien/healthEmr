/**
 * The frame every application shares.
 *
 * Narrower than the marketing pages and without their alternating bands: a
 * form is a task, and the surrounding page should get out of the way while
 * somebody does it.
 */
export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--paper)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  );
}
