import { NextResponse, type NextRequest } from 'next/server';

import { getActor } from '@/lib/auth/session';
import { readFileBytes } from '@/lib/repositories/files';

export const dynamic = 'force-dynamic';

/**
 * Authorized file download.
 *
 * Every request is authorized afresh against the session — this route holds no
 * token and trusts nothing in the URL beyond the id, which is a random UUID
 * that is useless without permission.
 *
 * Served as an attachment, always. An uploaded PDF or HTML file rendered inline
 * from our own origin would execute in our security context; forcing a download
 * removes that entire class of problem.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actor = await getActor();
  const result = await readFileBytes(actor, id);

  if (!result.ok) {
    // Identical response whether the file is missing or merely forbidden.
    return new NextResponse('Not found', { status: 404 });
  }

  const { body, file } = result.data;

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'content-type': file.contentType,
      'content-length': String(body.length),
      // The filename is quoted and stripped of anything that could break out of
      // the header — it is user-supplied text.
      'content-disposition': `attachment; filename="${file.originalFilename.replace(/[^\w.\- ]/g, '_')}"`,
      // Private, and never cached by a shared cache: this response is
      // authorization-dependent, and a CDN copy would serve it to anyone.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Belt and braces: even if something did render this, it can do nothing.
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
