import crypto from 'crypto';
import { logger } from '../lib/logger';
import { RealtimeEventEnvelope, RealtimeEventType, RealtimeEntityType } from './events';
import { realtimeGateway } from './gateway';

export interface PublishRealtimeEventInput<T = unknown> {
  type: RealtimeEventType;
  organizationId: number;
  branchId: number | null;
  entityType: RealtimeEntityType;
  entityId: number | string;
  data: T;
  version?: number;
}

export class RealtimeEventPublisher {
  private subscribers = new Set<(event: RealtimeEventEnvelope) => void>();
  private versions = new Map<string, number>();

  publish<T>(input: PublishRealtimeEventInput<T>): RealtimeEventEnvelope<T> {
    const versionKey = `${input.entityType}:${input.entityId}`;
    const nextVersion = (this.versions.get(versionKey) ?? 0) + 1;
    this.versions.set(versionKey, nextVersion);
    const event: RealtimeEventEnvelope<T> = {
      eventId: `evt_${crypto.randomUUID()}`,
      type: input.type,
      version: input.version ?? nextVersion,
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      branchId: input.branchId,
      entity: { type: input.entityType, id: input.entityId },
      data: input.data,
    };

    try {
      realtimeGateway.publish(event);
      for (const subscriber of this.subscribers) {
        try { subscriber(event); } catch (error) { logger.warn('Realtime internal subscriber failed', { eventType: event.type, error }); }
      }
    } catch (error) {
      logger.warn('Realtime event delivery failed; authoritative REST state remains available', {
        eventType: event.type,
        entityType: event.entity.type,
        entityId: event.entity.id,
        error,
      });
    }
    return event;
  }

  subscribe(handler: (event: RealtimeEventEnvelope) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }
}

export const realtimePublisher = new RealtimeEventPublisher();
