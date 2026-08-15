import Link from 'next/link';
import type { Metadata } from 'next';

import { signInAction } from '../actions';
import { AuthForm } from '../AuthForm';
import { AuthShell } from '../AuthShell';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/sign-up" className="font-medium underline">
            Create one
          </Link>
        </>
      }
    >
      <AuthForm mode="sign-in" action={signInAction} next={next} />
    </AuthShell>
  );
}
