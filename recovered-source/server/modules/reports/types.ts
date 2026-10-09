export type ReportGrouping = 'hour' | 'day' | 'week' | 'month';

export interface ReportFilters {
  branchId?: number;
  roomId?: number;
  tableId?: number;
  timeFrom?: string;
  timeTo?: string;
  businessDayId?: number;
  from?: string;
  to?: string;
  shiftId?: number;
  registerId?: number;
  staffId?: number;
  departmentId?: number;
  categoryId?: number;
  itemId?: number;
  paymentMethodId?: number;
  orderType?: 'DINE_IN' | 'TAKEAWAY';
  grouping?: ReportGrouping;
}

export const REPORT_METRICS = {
  grossSales: 'Sum of finalized customer-facing bill prices before discounts and rounding; VAT is already included.',
  netSales: 'Finalized customer-facing bill prices less finalized bill discounts; VAT is reported as the included tax component.',
  grandTotal: 'Finalized amount payable after discounts and rounding.',
  averageBill: 'Grand total divided by finalized bill count.',
  averageOrderValue: 'Grand total divided by distinct orders represented by finalized bills.',
  foodSales: 'Net bill-line sales attributed to items snapshotted/classified FOOD.',
  beverageSales: 'Net bill-line sales attributed to items snapshotted/classified BEVERAGE.',
  theoreticalRecipeCost: 'Recipe-cost snapshot captured for sold order items; not accounting COGS.',
  grossMargin: 'Net F&B sales minus theoretical recipe cost; not accounting profit.',
  tableTurn: 'One COMPLETED dine-in order associated with a valid table; cancelled, merged and active orders are excluded.',
  occupancyDuration: 'Visit-weighted minutes from created_at to completed_at for completed visits with valid timestamps; active and cancelled visits are excluded.',
  currentOccupancy: 'Distinct tables with PLACED, PREPARING, READY or SERVED dine-in orders now; location filters apply, historical date/time filters do not.',
  peakOccupancy: 'Maximum concurrent distinct tables across selected completed and open-business-day active visit intervals; ends precede starts at equal timestamps.',
  salesPerTable: 'Finalized bill subtotal minus discount_total for selected completed visits divided by the selected table count.',
  ordersPerTable: 'Completed dine-in orders divided by the selected table count (including tables with no completed visits).',
  occupancyTimeFilter: 'Visit-start clock time in stored database time, inclusive from and exclusive to; overnight windows are rejected. Business dates come from business_days.',
} as const;
