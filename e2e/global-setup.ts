import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import postgres from 'postgres';
import sharp from 'sharp';

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
    await sql`delete from rep_profiles where slug in ('e2e-public-rep', 'e2e-private-rep')`;
    await sql`delete from users where email in ('e2e-public@example.test', 'e2e-private@example.test')`;

    const [publicUser] = await sql<{ id: string }[]>`
      insert into users (email, full_name, status, email_verified_at)
      values ('e2e-public@example.test', 'Ada Public', 'active', now())
      returning id
    `;

    const [privateUser] = await sql<{ id: string }[]>`
      insert into users (email, full_name, status, email_verified_at)
      values ('e2e-private@example.test', 'Bob Private', 'active', now())
      returning id
    `;

    if (!publicUser || !privateUser) throw new Error('Failed to seed E2E users');

    const [publicProfile] = await sql<{ id: string }[]>`
      insert into rep_profiles
        (user_id, slug, headline, bio, years_experience, seniority, visibility,
         open_to_work, profile_completeness)
      values
        (${publicUser.id}, 'e2e-public-rep', 'Enterprise MedTech closer',
         ${'Fifteen years selling surgical implants to hospital systems across the Southwest.'},
         15, 'enterprise_ae', 'public', true, 85)
      returning id
    `;

    await sql`
      insert into rep_profiles
        (user_id, slug, headline, visibility, open_to_work, profile_completeness)
      values
        (${privateUser.id}, 'e2e-private-rep', 'Quietly looking', 'businesses_only', true, 40)
    `;

    if (!publicProfile) throw new Error('Failed to seed E2E rep profile');

    await sql`
      insert into rep_industries (rep_profile_id, industry_id, proficiency, years)
      select ${publicProfile.id}, id, 'expert', 12 from industries where slug = 'medical-devices'
    `;

    await sql`
      insert into rep_territories (rep_profile_id, territory_id)
      select ${publicProfile.id}, id from territories where slug = 'california'
    `;

    await sql`
      insert into rep_customer_types (rep_profile_id, customer_type_id, proficiency)
      select ${publicProfile.id}, id, 'expert' from customer_types where slug = 'healthcare-providers'
    `;

    await sql`
      insert into rep_sales_models (rep_profile_id, sales_model_id, proficiency)
      select ${publicProfile.id}, id, 'expert' from sales_models where slug = 'field-sales'
    `;

    await seedAvatar(sql, publicProfile.id, publicUser.id);
    await seedOrganization(sql, publicUser.id);
  } finally {
    await sql.end();
  }
}

/**
 * Gives the public profile an avatar, stored through the real storage adapter,
 * so the E2E run exercises the authorized download route rather than a
 * hand-placed file on disk.
 */
async function seedAvatar(
  sql: postgres.Sql,
  repProfileId: string,
  ownerUserId: string,
): Promise<void> {
  const body = await sharp({
    create: { width: 512, height: 512, channels: 3, background: '#2563eb' },
  })
    .webp()
    .toBuffer();

  const storagePath = `${ownerUserId}/${randomUUID()}`;

  // Written straight to the local storage root rather than through the storage
  // adapter: that module is marked `server-only`, and Playwright's global setup
  // is a plain Node script. E2E always runs against the local adapter, so the
  // layout here is the one the app will read from.
  const target = resolve(join(process.cwd(), '.storage', 'avatars', storagePath));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);

  const [file] = await sql<{ id: string }[]>`
    insert into files
      (owner_user_id, bucket, visibility, storage_path, original_filename,
       content_type, size_bytes, checksum_sha256, scan_status, image_width, image_height)
    values
      (${ownerUserId}, 'avatars', 'private', ${storagePath}, 'avatar.webp',
       'image/webp', ${body.length},
       ${createHash('sha256').update(body).digest('hex')}, 'clean', 512, 512)
    returning id
  `;

  if (file) {
    await sql`update rep_profiles set avatar_file_id = ${file.id} where id = ${repProfileId}`;
  }
}

/**
 * A company profile with attributes and a headquarters, for the public
 * /c/[slug] page.
 */
async function seedOrganization(sql: postgres.Sql, ownerUserId: string): Promise<void> {
  await sql`delete from organizations where slug = 'e2e-northwind'`;

  const [org] = await sql<{ id: string }[]>`
    insert into organizations
      (slug, legal_name, display_name, tagline, description, size_band,
       founded_year, hq_territory_id, status, verification_status, created_by)
    values
      ('e2e-northwind', 'Northwind Devices LLC', 'Northwind Devices',
       'Surgical implants for outpatient centres',
       'We build implants used in ambulatory surgery centres across the Southwest.',
       '51-200', 2014,
       (select id from territories where slug = 'los-angeles-metro'),
       'active', 'verified', ${ownerUserId})
    returning id
  `;

  if (!org) throw new Error('Failed to seed E2E organisation');

  await sql`
    insert into organization_members (organization_id, user_id, org_role, accepted_at)
    values (${org.id}, ${ownerUserId}, 'owner', now())
  `;

  await sql`
    insert into org_industries (organization_id, industry_id)
    select ${org.id}, id from industries where slug = 'medical-devices'
  `;

  await sql`
    insert into org_product_categories (organization_id, product_category_id)
    select ${org.id}, id from product_categories where slug = 'medical-capital-equipment'
  `;
}
