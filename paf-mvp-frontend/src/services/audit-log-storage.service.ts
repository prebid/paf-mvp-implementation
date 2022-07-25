import { DivId } from '@frontend/lib/paf-lib';
import { AuditLog } from '@core/model';

class AuditLogStorageService implements IAuditLogStorageService {
  /**
   * Internal storage for fetching the audit log for a Div id.
   */
  private auditLogByDivId = new Map<DivId, AuditLog>();

  /**
   * store the audit log with its corresponding divId
   * @param divId
   * @param auditLog
   */
  saveAuditLog(divId: DivId, auditLog: AuditLog): void {
    this.auditLogByDivId.set(divId, auditLog);
  }

  /**
   * @param divId The id of the tag (<div id="something">) that contains the addressable content..
   * @returns The Audit Log attached to this DivId.
   */
  getAuditLogByDivId = (divId: DivId): AuditLog | undefined => {
    return this.auditLogByDivId.get(divId);
  };
}

export interface IAuditLogStorageService {
  saveAuditLog: (divId: DivId, auditLog: AuditLog) => void;
  getAuditLogByDivId: (divId: DivId) => AuditLog | undefined;
}

export const auditLogStorageService = new AuditLogStorageService();
