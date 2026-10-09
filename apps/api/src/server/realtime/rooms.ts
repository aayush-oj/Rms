export const realtimeRooms = {
  organization: (id: number) => `organization:${id}`,
  branch: (branchId: number) => `branch:${branchId}`,
  table: (tableId: number) => `table:${tableId}`,
  room: (roomId: number) => `room:${roomId}`,
  user: (userId: number) => `user:${userId}`,
};
