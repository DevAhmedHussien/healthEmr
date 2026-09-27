'use client';

import * as React from 'react';
import type { PlatformPermission } from '@health-emr/types';
import { api } from '@/lib/api';

interface Me {
  role: string;
  permissions?: PlatformPermission[];
}

/**
 * What the signed-in administrator is allowed to do.
 *
 * Asked of the API rather than read from the session, for the same reason the
 * server does not trust the token: an owner who revoked a grant a minute ago
 * should not still be shown the button. `/auth/me` re-reads the user on every
 * call, so this is current.
 *
 * Cached for the lifetime of the page so twenty rows do not make twenty
 * requests, and shared across every component that asks.
 */
let inFlight: Promise<Me> | null = null;
let cached: Me | null = null;

function load(): Promise<Me> {
  if (cached) return Promise.resolve(cached);
  inFlight ??= api<Me>('v1/auth/me')
    .then((me) => {
      cached = me;
      return me;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Forget the cached answer — after an owner changes somebody's grants. */
export function forgetPermissions() {
  cached = null;
}

export function usePermissions() {
  const [me, setMe] = React.useState<Me | null>(cached);
  const [loading, setLoading] = React.useState(!cached);

  React.useEffect(() => {
    if (cached) return;
    let live = true;
    load()
      .then((result) => live && setMe(result))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const can = React.useCallback(
    (permission: PlatformPermission) => {
      if (!me) return false;
      // An owner holds everything by virtue of the role; the stored list is
      // beside the point for them, and checking it would hide their own
      // buttons.
      if (me.role === 'OWNER') return true;
      return (me.permissions ?? []).includes(permission);
    },
    [me],
  );

  return { can, loading, role: me?.role ?? null };
}
