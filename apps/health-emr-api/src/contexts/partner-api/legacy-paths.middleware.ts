import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('PartnerApi');

const PREFIX = '/partner/v1';

/**
 * Ordered: the first match wins, so the specific patterns come before the
 * general ones that would otherwise swallow them.
 */
const REWRITES: Array<{
  method: string;
  from: RegExp;
  /** Where it goes. `$1` is the first capture. */
  to: string;
}> = [
  { method: 'POST', from: /^\/visit\/createNoPayPhotos$/, to: '/visits' },
  { method: 'GET', from: /^\/visit\/externalFetch\/(.+)$/, to: '/visits/$1' },
  { method: 'GET', from: /^\/patient\/externalFetch\/(.+)$/, to: '/patients/by-phone/$1' },
  { method: 'GET', from: /^\/questionnaire\/(.+)$/, to: '/intake-forms/$1' },
  { method: 'GET', from: /^\/states$/, to: '/coverage' },
  { method: 'GET', from: /^\/pharmacies\/([^/]+)\/medications$/, to: '/pharmacies/$1/catalog' },
  { method: 'GET', from: /^\/visit\/([^/]+)\/photos$/, to: '/visits/$1/uploads' },
  // Last: these would otherwise swallow every /visit/... path above them.
  { method: 'PATCH', from: /^\/visit\/([^/]+)$/, to: '/visits/$1' },
  { method: 'GET', from: /^\/visit\/([^/]+)$/, to: '/visits/$1' },
];

/**
 * The paths this API used to have.
 *
 * The contract was first cut to match the incumbent's, verb for verb, so a
 * client could repoint a base URL and be done. That was the right trade when
 * the job was winning migrations; it is the wrong one now, because it left
 * `createNoPayPhotos` and `externalFetch` carved into our own product — names
 * that record someone else's implementation history rather than describing
 * anything a reader of ours could reason about.
 *
 * So the routes were renamed, and the old spellings are rewritten onto the new
 * ones here. Not out of caution: anyone already integrating has the old URLs in
 * code they have tested, and a rename that silently 404s their integration is
 * our decision presented to them as their outage.
 *
 * Rewriting rather than duplicating the handlers means there is one
 * implementation of each endpoint, one place to change it, and no way for the
 * two spellings to drift apart. It also means this file is the whole of the
 * debt: delete it, and the retired contract is gone with it.
 *
 * Registered in `bootstrap` rather than through the module, because Nest mounts
 * module middleware on a path and Express strips that path from `req.url`
 * before the handler runs — which is precisely the part being rewritten.
 *
 * Three retired paths are not here: they named the visit in the body where the
 * new ones name it in the path, and the body is not parsed this early. Those
 * are carried as excluded aliases on the controller instead.
 */
export function rewriteRetiredPartnerPaths(req: Request, _res: Response, next: NextFunction) {
  const [path, query] = req.url.split('?');
  if (!path.startsWith(PREFIX)) return next();

  const tail = path.slice(PREFIX.length) || '/';

  for (const rule of REWRITES) {
    if (rule.method !== req.method) continue;
    if (!rule.from.test(tail)) continue;

    const rewritten = PREFIX + tail.replace(rule.from, rule.to);
    logger.warn(`${req.method} ${path} is a retired path — use ${rewritten}. Rewritten for now.`);
    req.url = query ? `${rewritten}?${query}` : rewritten;
    return next();
  }

  return next();
}
