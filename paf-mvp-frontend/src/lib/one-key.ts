/**
 * Entry point to OneKey library, built as paf-lib.js (TODO rename js file)
 */
import { Window } from '@frontend/global';
import { setUpImmediateProcessingQueue } from '@frontend/utils/queue';
import { OneKeyLib } from '@frontend/lib/paf-lib';
import { CurrentScript } from '@frontend/utils/current-script';
import { auditLogStorageService } from '@frontend/services/audit-log-storage.service';
import { seedStorageService } from '@frontend/services/seed-storage.service';

// Get properties from HTML
const pafLibScript = new CurrentScript<{ clientHostname: string; upFrontRedirect?: string }>();
pafLibScript.setScript(document.currentScript);

const triggerRedirectIfNeeded =
  pafLibScript.getData()?.upFrontRedirect !== undefined ? pafLibScript.getData().upFrontRedirect === 'true' : true;
export const oneKeyLib = new OneKeyLib(
  pafLibScript.getData()?.clientHostname,
  triggerRedirectIfNeeded,
  auditLogStorageService,
  seedStorageService
);

const queue = (<Window>window).OneKey?.queue ?? [];
(<Window>window).OneKey = oneKeyLib;
(<Window>window).OneKey.queue = queue;

(async () => {
  await oneKeyLib.handleAfterBoomerangRedirect();
  await setUpImmediateProcessingQueue((<Window>window).OneKey);
})();
