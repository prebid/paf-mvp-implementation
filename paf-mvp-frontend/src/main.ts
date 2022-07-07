import './polyfills/assign';
import './styles.scss';
import { PromptConsent } from './widgets/prompt-consent';
import { notificationService } from './services/notification.service';
import { NotificationEnum } from '@frontend/enums/notification.enum';
import { currentScript } from '@frontend/utils/current-script';
import {
  generateSeed,
  getAuditLogByDivId,
  getAuditLogByTransaction,
  getIdsAndPreferences,
  getIdsAndPreferencesAsync,
  getNewId,
  refreshIdsAndPreferences,
  registerTransmissionResponse,
  signPreferences,
  updateIdsAndPreferences,
} from './lib/paf-lib';
import { Window } from './global';

currentScript.setScript(document.currentScript as HTMLScriptElement);

const promptConsent = () => new Promise<boolean>((resolve) => new PromptConsent({ emitConsent: resolve }).render());
const showNotification = (type: NotificationEnum) => notificationService.showNotification(type);

(<Window>window).PAFUI ??= { promptConsent, showNotification };
(<Window>window).PAF = {
  ...((<Window>window).PAF ?? {}),
  // The rest has to be the official methods, should not be overridden from the outside
  getNewId,
  signPreferences,
  getIdsAndPreferences,
  getIdsAndPreferencesAsync,
  refreshIdsAndPreferences,
  updateIdsAndPreferences,
  generateSeed,
  registerTransmissionResponse,
  getAuditLogByTransaction,
  getAuditLogByDivId,
};
