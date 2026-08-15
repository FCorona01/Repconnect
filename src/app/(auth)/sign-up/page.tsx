import Link from 'next/link';
import type { Metadata } from 'next';

import { signUpAction } from '../actions';
import { AuthForm } from '../AuthForm';
import { AuthShell } from '../AuthShell';

export const metadata: Metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="One account, whether you are hiring sales talent or looking for opportunities."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium underline">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm mode="sign-up" action={signUpAction} />
    </AuthShell>
  );
}
