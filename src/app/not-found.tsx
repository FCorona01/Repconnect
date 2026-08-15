import Link from 'next/link';

/**
 * Shown for genuinely missing pages AND for records the viewer is not
 * permitted to see — the two are deliberately indistinguishable, so a response
 * never confirms that a private profile or opportunity exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-3 text-[var(--muted)]">
        This page doesn&apos;t exist, or it isn&apos;t available to you.
      </p>
      <p className="mt-8">
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          Back to RepConnect
        </Link>
      </p>
    </main>
  );
}
