import { AuthContext } from '../identity/types';
import { ForbiddenError } from '../../shared/errors';
import { AlertRecord } from './types';

export function resolveAlertBranchScope(auth:AuthContext, requestedBranchId?:number):number[]{
  if(requestedBranchId!==undefined){
    if(!auth.allowedBranchIds.includes(requestedBranchId)) throw new ForbiddenError('Branch is outside your authorized scope','UNAUTHORIZED_BRANCH_ACCESS');
    return [requestedBranchId];
  }
  return [...auth.allowedBranchIds];
}

export function canViewAlert(auth:AuthContext, alert:AlertRecord):boolean{
  if(!auth.allowedBranchIds.includes(alert.branchId)) return false;
  if(auth.role==='OWNER'||auth.permissions.includes('admin:all')) return true;
  if(alert.category==='SECURITY'&&!auth.permissions.includes('alerts.security.view')) return false;

  // Branch managers keep the broad operations view without gaining any manual
  // capability to clear an unresolved alert.
  if(auth.permissions.includes('alerts.settings.manage')) return true;
  if(alert.metadata?.secondaryRole===auth.role) return true;
  if(typeof alert.metadata?.secondaryPermission==='string'&&auth.permissions.includes(alert.metadata.secondaryPermission)) return true;
  if(alert.audienceType==='BRANCH') return auth.permissions.includes('alerts.view');
  if(alert.audienceType==='USER') return alert.audienceReference===String(auth.id);
  if(alert.audienceType==='ROLE') return alert.audienceReference===auth.role;
  if(alert.audienceType==='PERMISSION_GROUP') return !!alert.audienceReference&&auth.permissions.includes(alert.audienceReference);
  return false;
}
