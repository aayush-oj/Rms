import { alertRepository } from './repository';
import { AlertCandidate, AlertRecord } from './types';
import { realtimePublisher } from '../../realtime/publisher';

function eventData(alert:AlertRecord){
  return {
    id:alert.id,
    type:alert.type,
    category:alert.category,
    severity:alert.severity,
    status:alert.status,
    title:alert.title,
    message:alert.message,
    entityType:alert.entityType,
    entityId:alert.entityId,
    audienceType:alert.audienceType,
    audienceReference:alert.audienceReference,
    metadata:alert.metadata,
    createdAt:alert.createdAt,
    resolvedAt:alert.resolvedAt,
    updatedAt:alert.updatedAt,
  };
}

export class AlertService {
  async open(candidate:AlertCandidate):Promise<AlertRecord>{
    const result=await alertRepository.upsertOpen(candidate);
    const alert=result.alert;
    if(result.created||result.changed){
      realtimePublisher.publish({
        type:result.created?'alert.created':'alert.updated',
        organizationId:alert.organizationId,
        branchId:alert.branchId,
        entityType:'alert',
        entityId:alert.id,
        data:eventData(alert),
      });
    }
    return alert;
  }

  async resolveCondition(org:number,branch:number,key:string):Promise<AlertRecord|null>{
    const alert=await alertRepository.resolveByKey(org,branch,key);
    if(alert){
      realtimePublisher.publish({
        type:'alert.resolved',
        organizationId:alert.organizationId,
        branchId:alert.branchId,
        entityType:'alert',
        entityId:alert.id,
        data:eventData(alert),
      });
    }
    return alert;
  }
}

export const alertService=new AlertService();
