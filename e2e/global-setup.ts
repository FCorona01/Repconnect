import postgres from 'postgres';

/**
 * Seeds deterministic fixtures for the E2E suite.
 *
 * Written directly against the database rather than through the app, because
 * signing up requires Supabase Auth, which the E2E environment deliberately
 * does not have configured. The rows are the same shape the application
 * creates.
 *
 * Idempotent: re-running is safe, so the suite can be run repeatedly against a
 * local database without a reset.
 */
export default async function globalSetup(): Promise<void> {
  const url =
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/repconnect';

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql.begin(async (tx) => {
      await tx`delete from rep_profiles where slug in ('e2e-public-rep', 'e2e-private-rep')`;
      await tx`delete from users where email in ('e2e-public@example.test', 'e2e-private@example.test')`;

      const [publicUser] = await tx<{ id: string }[]>`
        insert into users (email, full_name, status, email_verified_at)
        values ('e2e-public@example.test', 'Ada Public', 'active', now())
        returning id
      `;

      const [privateUser] = await tx<{ id: string }[]>`
        insert into users (email, full_name, status, email_verified_at)
        values ('e2e-private@example.test', 'Bob Private', 'active', now())
        returning id
      `;

      if (!publicUser || !privateUser) throw new Error('Failed to seed E2E users');

      const [publicProfile] = await tx<{ id: string }[]>`
        insert into rep_profiles
          (user_id, slug, headline, bio, years_experience, seniority, visibility,
           open_to_work, profile_completeness)
        values
          (${publicUser.id}, 'e2e-public-rep', 'Enterprise MedTech closer',
           ${'Fifteen years selling surgical implants to hospital systems across the Southwest.'},
           15, 'enterprise_ae', 'public', true, 85)
        returning id
      `;

      await tx`
        insert into rep_profiles
          (user_id, slug, headline, visibility, open_to_work, profile_completeness)
        values
          (${privateUser.id}, 'e2e-private-rep', 'Quietly looking', 'businesses_only', true, 40)
      `;

      if (!publicProfile) throw new Error('Failed to seed E2E rep profile');

      await tx`
        insert into rep_industries (rep_profile_id, industry_id, proficiency, years)
        select ${publicProfile.id}, id, 'expert', 12 from industries where slug = 'medical-devices'
      `;

      await tx`
        insert into rep_territories (rep_profile_id, territory_id)
        select ${publicProfile.id}, id from territories where slug = 'california'
      `;

      await tx`
        insert into rep_customer_types (rep_profile_id, customer_type_id, proficiency)
        select ${publicProfile.id}, id, 'expert' from customer_types where slug = 'healthcare-providers'
      `;

      await tx`
        insert into rep_sales_models (rep_profile_id, sales_model_id, proficiency)
        select ${publicProfile.id}, id, 'expert' from sales_models where slug = 'field-sales'
      `;
    });
  } finally {
    await sql.end();
  }
}
