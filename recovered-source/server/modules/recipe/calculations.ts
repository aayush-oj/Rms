export interface ConvertibleUnit {
  id: number;
  dimension: string;
  conversionFactor: number;
}

export function round6(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function convertQuantity(quantity: number, from: ConvertibleUnit, to: ConvertibleUnit): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantity must be a finite non-negative number');
  if (from.dimension !== to.dimension) throw new Error(`Incompatible unit dimensions: ${from.dimension} -> ${to.dimension}`);
  if (from.conversionFactor <= 0 || to.conversionFactor <= 0) throw new Error('Unit conversion factors must be positive');
  return round6(quantity * from.conversionFactor / to.conversionFactor);
}

export function recipeCostMetrics(batchCost: number, yieldQuantity: number, netSellingPrice: number) {
  if (!Number.isFinite(batchCost) || batchCost < 0) throw new Error('Batch cost must be non-negative');
  if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0) throw new Error('Yield quantity must be positive');
  const costPerPortion = round6(batchCost / yieldQuantity);
  if (!Number.isFinite(netSellingPrice) || netSellingPrice <= 0) {
    return { batchCost: round6(batchCost), costPerPortion, netSellingPrice: 0, foodCostPercent: null, grossProfit: null, grossMarginPercent: null };
  }
  const grossProfit = round6(netSellingPrice - costPerPortion);
  return {
    batchCost: round6(batchCost),
    costPerPortion,
    netSellingPrice: round6(netSellingPrice),
    foodCostPercent: round6((costPerPortion / netSellingPrice) * 100),
    grossProfit,
    grossMarginPercent: round6((grossProfit / netSellingPrice) * 100),
  };
}
