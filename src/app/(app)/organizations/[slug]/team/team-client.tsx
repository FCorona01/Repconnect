'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { ORG_ROLE_RANK, type OrgRole } from '@/lib/db/schema';

import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  type TeamActionState,
} from './actions';

const GRANTABLE: Array<Exclude<OrgRole, 'owner'>> = ['admin', 'recruiter', 'viewer'];

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  recruiter: 'Recruiter',
  viewer: 'Viewer',
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[var(--color-brand-600)] px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
    >
      {pending ? 'Working…' : label}
    </button>
  );
}

export function InviteMemberForm({ slug }: { slug: string }) {
  const [state, formAction] = useActionState<TeamActionState, FormData>(
    inviteMemberAction.bind(null, slug),
    {},
  );

  return (
    <form
      action={formAction}
      className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h2 className="text-sm font-medium">Invite someone</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        They need a RepConnect account already. The invitation grants nothing until
        they accept it.
      </p>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {state.message}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="colleague@company.com"
            aria-invalid={state.fieldErrors?.email ? true : undefined}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="orgRole" className="sr-only">
            Role
          </label>
          <select
            id="orgRole"
            name="orgRole"
            defaultValue="viewer"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm sm:w-auto"
          >
            {GRANTABLE.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton label="Invite" />
      </div>
    </form>
  );
}

export interface MemberSummary {
  userId: string;
  fullName: string;
  email: string;
  orgRole: OrgRole;
  acceptedAt: Date | null;
  invitedAt: Date;
}

export function MemberRow({
  slug,
  member,
  roleDescription,
  canManage,
  maxGrantableRank,
  pending = false,
}: {
  slug: string;
  member: MemberSummary;
  roleDescription: string;
  canManage: boolean;
  maxGrantableRank: number;
  pending?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const grantable = GRANTABLE.filter((role) => ORG_ROLE_RANK[role] < maxGrantableRank);

  function changeRole(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRoleAction(
        slug,
        member.userId,
        next as Exclude<OrgRole, 'owner'>,
      );
      if (result.error) setError(result.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(slug, member.userId);
      if (result.error) setError(result.error);
      setConfirmingRemove(false);
    });
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{member.fullName}</p>
        <p className="truncate text-sm text-[var(--muted)]">{member.email}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {pending && (
          <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            Pending
          </span>
        )}

        {canManage && grantable.length > 0 ? (
          <>
            <label htmlFor={`role-${member.userId}`} className="sr-only">
              Role for {member.fullName}
            </label>
            <select
              id={`role-${member.userId}`}
              defaultValue={member.orgRole}
              disabled={isPending}
              onChange={(event) => changeRole(event.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm disabled:opacity-60"
            >
              {grantable.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-sm text-[var(--muted)]" title={roleDescription}>
            {ROLE_LABELS[member.orgRole]}
          </span>
        )}

        {canManage &&
          (confirmingRemove ? (
            // Removal is destructive and easy to misclick next to a dropdown,
            // so it asks once rather than acting on the first press.
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {isPending ? 'Removing…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="text-xs text-[var(--muted)] underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="text-xs text-[var(--muted)] underline underline-offset-4"
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  );
}
