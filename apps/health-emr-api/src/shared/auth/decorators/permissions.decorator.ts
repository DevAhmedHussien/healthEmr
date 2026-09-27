import { SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from '@health-emr/types';

export const PERMISSIONS_KEY = 'platform-permissions';

/**
 * The grant an endpoint needs beyond its role.
 *
 * Role answers "may you be in this part of the product at all"; this answers
 * "may you do the irreversible thing". Two questions, two decorators, because
 * conflating them is how a read-only administrator ends up able to delete.
 */
export const RequiresPermission = (...permissions: PlatformPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
