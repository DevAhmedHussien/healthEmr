import { SetMetadata } from '@nestjs/common';
export const PARTNER_KEY = 'isPartnerRoute';
/** Marks a route as authenticated by a tenant API key rather than a user session. */
export const PartnerRoute = () => SetMetadata(PARTNER_KEY, true);
