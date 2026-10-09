import { Server, Socket } from 'socket.io';
import { realtimeRooms } from './rooms';
import { RealtimeEventEnvelope } from './events';
import { AuthContext } from '../modules/identity/types';
import { authService } from '../modules/identity/authService';
import { managementRepository } from '../modules/management/repository';
import { logger } from '../lib/logger';
import { rawCookieToken } from '../modules/identity/sessionCookies';

type Channel = 'orders' | 'tables' | 'kitchen' | 'billing' | 'shift' | 'purchasing' | 'inventory' | 'expenses' | 'alerts';
interface SocketData { auth: AuthContext; token: string; }
type RealtimeSocket = Socket<any, any, any, SocketData>;

type OrganizationSocket = {
  data?: {
    auth?: {
      organizationId?: number;
    };
  };
  disconnect(close?: boolean): unknown;
};

export function disconnectOrganizationSockets(
  sockets: Iterable<OrganizationSocket>,
  organizationId: number,
): number {
  if (!Number.isInteger(organizationId) || organizationId <= 0) return 0;

  let disconnected = 0;
  for (const socket of Array.from(sockets)) {
    if (Number(socket.data?.auth?.organizationId) !== organizationId) continue;
    socket.disconnect(true);
    disconnected += 1;
  }
  return disconnected;
}

function channelForEvent(type: string): Channel | null {
  if (type.startsWith('order.') || type.startsWith('service.')) return 'orders';
  if (type.startsWith('table.')) return 'tables';
  if (type.startsWith('kot.') || type.startsWith('kds.')) return 'kitchen';
  if (type.startsWith('bill.') || type.startsWith('payment.')) return 'billing';
  if (type.startsWith('shift.') || type.startsWith('cash_movement.') || type.startsWith('business_day.')) return 'shift';
  if (type.startsWith('supplier.') || type.startsWith('purchase_order.') || type.startsWith('purchase_receipt.')) return 'purchasing';
  if (type.startsWith('inventory.') || type.startsWith('stock.')) return 'inventory';
  if (type.startsWith('expense.')) return 'expenses';
  if (type.startsWith('alert.')) return 'alerts';
  return null;
}

function channelRoom(branchId: number, channel: Channel): string {
  return `branch:${branchId}:${channel}`;
}

function tableChannelRoom(branchId: number, tableId: number, channel: Channel): string {
  return `${channelRoom(branchId, channel)}:table:${tableId}`;
}

function canJoinChannel(auth: AuthContext, channel: Channel): boolean {
  if (auth.role === 'OWNER' || auth.permissions.includes('admin:all')) return true;
  const permissions: Record<Channel, string[]> = {
    orders: ['pos:orders:view', 'pos:orders:create'],
    tables: ['pos:tables:manage', 'pos:tables:allocate', 'pos:orders:view'],
    kitchen: ['kitchen:tickets:view', 'kitchen:tickets:update'],
    billing: ['pos:billing:settle'],
    shift: ['shift:view', 'shift:open', 'shift:close', 'shift:cash:manage', 'shift:reconcile', 'businessday:view', 'businessday:open', 'businessday:close'],
    purchasing: ['purchasing:view', 'purchasing:create', 'purchasing:approve', 'purchasing:receive', 'suppliers:view'],
    inventory: ['inventory:view','inventory:history:view','inventory:adjust','inventory:count','inventory:transfer'],
    expenses: ['expenses:view','expenses:create','expenses:update','expenses:post','expenses:void','expenses:category:manage'],
    alerts: ['alerts.view'],
  };
  return permissions[channel].some(p => auth.permissions.includes(p));
}

function authFingerprint(auth: AuthContext): string {
  return JSON.stringify({
    role: auth.role,
    mustChangePin: auth.mustChangePin,
    activeBranchId: auth.activeBranchId,
    branches: [...auth.allowedBranchIds].sort((a,b) => a-b),
    permissions: [...auth.permissions].sort(),
  });
}

export class RealtimeGateway {
  private io: Server | null = null;

  attach(io: Server): void {
    this.io = io;
    io.use(async (socket: RealtimeSocket, next) => {
      try {
        const token = typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token.trim()
          ? socket.handshake.auth.token.trim()
          : rawCookieToken(socket.handshake.headers.cookie, 'STAFF');
        if (!token) return next(new Error('AUTH_REQUIRED'));
        const claims = authService.verifyToken(token);
        const auth = await authService.resolveAuthContext(claims);
        if (auth.authLevel !== 'STAFF') return next(new Error('STAFF_AUTH_REQUIRED'));
        if (auth.mustChangePin) return next(new Error('PIN_CHANGE_REQUIRED'));
        socket.data.auth = auth;
        socket.data.token = token;
        next();
      } catch {
        next(new Error('AUTH_INVALID'));
      }
    });

    io.on('connection', (socket: RealtimeSocket) => {
      const auth = socket.data.auth;
      const initialFingerprint = authFingerprint(auth);
      socket.use(async (_packet, next) => {
        try {
          const current = await authService.resolveAuthContext(authService.verifyToken(socket.data.token));
          if (authFingerprint(current) !== initialFingerprint) {
            socket.disconnect(true);
            return next(new Error('AUTH_CONTEXT_CHANGED'));
          }
          socket.data.auth = current;
          next();
        } catch { socket.disconnect(true); next(new Error('AUTH_EXPIRED')); }
      });
      const authRecheck = setInterval(async () => {
        try {
          const current = await authService.resolveAuthContext(authService.verifyToken(socket.data.token));
          if (authFingerprint(current) !== initialFingerprint) return socket.disconnect(true);
          socket.data.auth = current;
        } catch { socket.disconnect(true); }
      }, 5 * 60 * 1000);
      authRecheck.unref?.();
      if (auth.role === 'OWNER' || auth.permissions.includes('admin:all') || auth.permissions.some(p => ['suppliers:view','purchasing:view','purchasing:create','purchasing:approve','purchasing:receive'].includes(p))) socket.join(realtimeRooms.organization(auth.organizationId));
      for (const branchId of auth.allowedBranchIds) {
        for (const channel of ['orders', 'tables', 'kitchen', 'billing', 'shift', 'purchasing', 'inventory', 'expenses', 'alerts'] as Channel[]) {
          if (canJoinChannel(auth, channel)) {
            const fullBranch = auth.role === 'OWNER' || auth.permissions.includes('admin:all') || auth.permissions.includes('admin:tables:manage') || auth.permissions.includes('admin:access:manage');
            if (fullBranch || ['kitchen', 'billing', 'shift', 'purchasing', 'inventory', 'expenses', 'alerts'].includes(channel)) socket.join(channelRoom(branchId, channel));
          }
        }
      }
      socket.join(realtimeRooms.user(auth.id));
      const canReceiveAlerts = canJoinChannel(auth, 'alerts');
      if (canReceiveAlerts) {
        for (const branchId of auth.allowedBranchIds) {
          socket.join(`branch:${branchId}:alert-user:${auth.id}`);
          socket.join(`branch:${branchId}:alert-role:${auth.role}`);
          for (const permission of auth.permissions) socket.join(`branch:${branchId}:alert-permission:${permission}`);
        }
      }

      socket.on('subscribe', async (request: { scope?: 'table' | 'room'; id?: number }, ack?: (result: { ok: boolean; code?: string }) => void) => {
        try {
          const id = Number(request?.id);
          if (!Number.isInteger(id) || id <= 0) return ack?.({ ok: false, code: 'INVALID_SCOPE_ID' });
          const currentAuth = socket.data.auth;
          const branchId = currentAuth.activeBranchId;
          if (request.scope === 'table') {
            const allowed = await managementRepository.canAccessTable(currentAuth.organizationId, currentAuth.id, branchId, id, currentAuth.permissions);
            if (!allowed) return ack?.({ ok: false, code: 'TABLE_ACCESS_FORBIDDEN' });
            for (const channel of ['orders', 'tables', 'kitchen', 'billing'] as Channel[]) {
              if (canJoinChannel(currentAuth, channel)) socket.join(tableChannelRoom(branchId, id, channel));
            }
            if (canJoinChannel(currentAuth, 'alerts')) socket.join(`branch:${branchId}:alert-table:${id}`);
            return ack?.({ ok: true });
          }
          if (request.scope === 'room') {
            const allowed = await managementRepository.canAccessSection(currentAuth.organizationId, currentAuth.id, branchId, id, currentAuth.permissions);
            if (!allowed) return ack?.({ ok: false, code: 'ROOM_ACCESS_FORBIDDEN' });
            socket.join(realtimeRooms.room(id));
            return ack?.({ ok: true });
          }
          return ack?.({ ok: false, code: 'UNSUPPORTED_SCOPE' });
        } catch {
          return ack?.({ ok: false, code: 'SCOPE_CHECK_FAILED' });
        }
      });

      socket.on('unsubscribe', (request: { scope?: 'table' | 'room'; id?: number }) => {
        const id = Number(request?.id);
        if (!Number.isInteger(id) || id <= 0) return;
        if (request.scope === 'table') {
          for (const channel of ['orders', 'tables', 'kitchen', 'billing'] as Channel[]) socket.leave(tableChannelRoom(socket.data.auth.activeBranchId, id, channel));
          socket.leave(`branch:${socket.data.auth.activeBranchId}:alert-table:${id}`);
        }
        if (request.scope === 'room') socket.leave(realtimeRooms.room(id));
      });

      socket.on('disconnect', reason => { clearInterval(authRecheck); logger.debug('Realtime socket disconnected', { userId: auth.id, reason }); });
    });
  }

  disconnectOrganization(organizationId: number): number {
    if (!this.io) return 0;
    const disconnected = disconnectOrganizationSockets(
      this.io.sockets.sockets.values() as Iterable<OrganizationSocket>,
      organizationId,
    );
    if (disconnected > 0) {
      logger.info('Disconnected realtime sockets for blocked organization', {
        organizationId,
        disconnected,
      });
    }
    return disconnected;
  }

  publish(event: RealtimeEventEnvelope): void {
    if (!this.io) return;
    if (event.branchId == null) { if (event.type.startsWith('supplier.')) this.io.to(realtimeRooms.organization(event.organizationId)).emit('rms:event', event); return; }
    const channel = channelForEvent(event.type);
    if (!channel) return;
    if (channel === 'alerts') {
      const data = event.data as any;
      const audienceType = String(data?.audienceType || 'BRANCH');
      const reference = data?.audienceReference == null ? null : String(data.audienceReference);
      let delivered = false;
      if (audienceType === 'USER' && reference) { this.io.to(`branch:${event.branchId}:alert-user:${reference}`).emit('rms:event', event); delivered = true; }
      if (audienceType === 'ROLE' && reference) { this.io.to(`branch:${event.branchId}:alert-role:${reference}`).emit('rms:event', event); delivered = true; }
      if (audienceType === 'PERMISSION_GROUP' && reference) { this.io.to(`branch:${event.branchId}:alert-permission:${reference}`).emit('rms:event', event); delivered = true; }
      if (audienceType === 'TABLE_ASSIGNMENT' && reference && Number.isInteger(Number(reference))) { this.io.to(`branch:${event.branchId}:alert-table:${reference}`).emit('rms:event', event); delivered = true; }
      const secondaryRole = typeof data?.metadata?.secondaryRole === 'string' ? data.metadata.secondaryRole : null;
      const secondaryPermission = typeof data?.metadata?.secondaryPermission === 'string' ? data.metadata.secondaryPermission : null;
      if (secondaryRole) { this.io.to(`branch:${event.branchId}:alert-role:${secondaryRole}`).emit('rms:event', event); delivered = true; }
      if (secondaryPermission) { this.io.to(`branch:${event.branchId}:alert-permission:${secondaryPermission}`).emit('rms:event', event); delivered = true; }
      if (!delivered || audienceType === 'BRANCH') this.io.to(channelRoom(event.branchId, 'alerts')).emit('rms:event', event);
      return;
    }
    const scopedTableId = event.entity.type === 'table' && typeof event.entity.id === 'number'
      ? event.entity.id
      : typeof (event.data as any)?.diningTableId === 'number'
        ? Number((event.data as any).diningTableId)
        : null;

    // Table-scoped operational events are delivered to explicitly authorized table rooms.
    // Branch-wide delivery is reserved for users with branch-level management access.
    const branchRoom = channelRoom(event.branchId, channel);
    const audience = this.io.to(scopedTableId == null
      ? branchRoom
      : [branchRoom, tableChannelRoom(event.branchId, scopedTableId, channel)]);
    audience.emit('rms:event', event);
  }

  health() { return { enabled: this.io !== null, connections: this.io?.engine.clientsCount ?? 0 }; }
}

export const realtimeGateway = new RealtimeGateway();
