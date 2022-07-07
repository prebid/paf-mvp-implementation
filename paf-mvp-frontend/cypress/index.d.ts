import {
  getIdsAndPreferences,
  getIdsAndPreferencesAsync,
  getNewId,
  refreshIdsAndPreferences,
  signPreferences,
  updateIdsAndPreferences,
} from '../src/lib/paf-lib';
import { NotificationEnum } from '../src/enums/notification.enum';

declare global {
  namespace Cypress {
    interface Chainable<Subject> {
      shouldNotContainClass(className: string): Chainable<Subject>;
      shouldContainClass(className: string): Chainable<Subject>;
    }
  }

  interface Window {
    PAF: {
      getNewId: typeof getNewId;
      signPreferences: typeof signPreferences;
      getIdsAndPreferences: typeof getIdsAndPreferences;
      getIdsAndPreferencesAsync: typeof getIdsAndPreferencesAsync;
      refreshIdsAndPreferences: typeof refreshIdsAndPreferences;
      updateIdsAndPreferences: typeof updateIdsAndPreferences;
    };
    PAFUI: {
      promptConsent: () => Promise<boolean>;
      showNotification: (notificationType: NotificationEnum) => void;
    };
  }
}

export {};
