/**
 * Grants a platform role by direct database access.
 *
 * This is deliberately the ONLY way the first superadmin comes into existence.
 * There is no signup option, no invite flow and no in-app promotion path
 * reachable by a normal user — so the privilege-escalation route simply does
 * not exist to be exploited. After the first superadmin exists, further roles
 * are granted through the audited admin console.
 *
 *   pnpm exec tsx scripts/promote-admin.ts you@example.com superadmin
 */
import postgres from 'postgres';

const ROLES = ['member', 'admin', 'superadmin'] as const;
type Role = (typeof ROLES)[number];

async function main(): Promise<void> {
  const [emailArg, roleArg = 'superadmin'] = process.argv.slice(2);

  if (!emailArg) {
    console.error('Usage: tsx scripts/promote-admin.ts <email> [member|admin|superadmin]');
    process.exit(1);
  }

  if (!ROLES.includes(roleArg as Role)) {
    console.error(`Role must be one of: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL must be set.');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    const updated = await sql<{ id: string; email: string; platform_role: string }[]>`
      update users
         set platform_role = ${roleArg}::platform_role,
             updated_at = now()
       where lower(email) = ${email}
         and deleted_at is null
      returning id, email, platform_role
    `;

    const row = updated[0];
    if (!row) {
      console.error(
        `No active account found for ${email}.\n` +
          'Sign up through the app first, then run this again.',
      );
      process.exit(1);
    }

    // Recorded like every other consequential change. A role granted outside
    // the app is exactly the kind of event an audit trail exists for.
    await sql`
      insert into audit_logs (actor_user_id, actor_role, action, target_type, target_id, after_state)
      values (null, 'system', 'user.platform_role_changed.cli', 'user', ${row.id},
              ${sql.json({ platformRole: roleArg, via: 'scripts/promote-admin.ts' })})
    `;

    console.log(`${row.email} is now ${row.platform_role}.`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
