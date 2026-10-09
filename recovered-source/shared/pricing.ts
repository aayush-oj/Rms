export type PriceEntryMode = 'VAT_INCLUDED' | 'VAT_EXCLUDED';
export type RoundingMethod = 'HALF_EVEN' | 'HALF_UP' | 'ROUND_DOWN' | 'ROUND_UP';

export interface VatProfileInput {
  isVatRegistered: boolean;
  vatRate: number | string;
  roundingMethod: RoundingMethod;
}

export interface PriceBreakdown {
  enteredPrice: number;
  priceEntryMode: PriceEntryMode;
  priceBeforeVat: number;
  vatAmount: number;
  customerPrice: number;
}

export interface OrderPricingLineInput {
  key: number | string;
  customerPrice: number | string;
  complimentary?: boolean;
}

export interface OrderPricingLine extends OrderPricingLineInput {
  lineSubtotal: number;
  discountAmount: number;
  taxableAmount: number;
  vatAmount: number;
  lineTotal: number;
}

export interface OrderPricingResult {
  subtotal: number;
  discount: number;
  taxableAmount: number;
  vatAmount: number;
  roundingDelta: number;
  grandTotal: number;
  lines: OrderPricingLine[];
}

const MONEY_DIGITS = 4;
const RATE_DIGITS = 6;
const MONEY_SCALE = 10n ** BigInt(MONEY_DIGITS);
const RATE_SCALE = 10n ** BigInt(RATE_DIGITS);
const FINAL_MONEY_UNIT = 100n;

function decimalString(value: number | string, digits: number): string {
  const raw = String(value).trim();
  if (!/[eE]/.test(raw)) return raw;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid decimal value: ${raw}`);
  return numeric.toFixed(digits + 4);
}

function toScaled(value: number | string, digits: number): bigint {
  const raw = decimalString(value, digits);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) throw new Error(`Invalid decimal value: ${raw}`);
  const negative = match[1] === '-';
  const whole = match[2];
  const fraction = match[3] ?? '';
  const retained = fraction.slice(0, digits).padEnd(digits, '0');
  let scaled = BigInt(whole) * (10n ** BigInt(digits)) + BigInt(retained || '0');
  if (Number(fraction[digits] ?? '0') >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

function money(value: bigint): number {
  return Number(value) / Number(MONEY_SCALE);
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Pricing denominator must be positive');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function roundFinal(value: bigint, method: RoundingMethod): bigint {
  const quotient = value / FINAL_MONEY_UNIT;
  const remainder = value % FINAL_MONEY_UNIT;
  if (remainder === 0n) return value;
  if (method === 'ROUND_DOWN') return quotient * FINAL_MONEY_UNIT;
  if (method === 'ROUND_UP') return (quotient + 1n) * FINAL_MONEY_UNIT;
  const doubled = remainder * 2n;
  if (doubled < FINAL_MONEY_UNIT) return quotient * FINAL_MONEY_UNIT;
  if (doubled > FINAL_MONEY_UNIT) return (quotient + 1n) * FINAL_MONEY_UNIT;
  if (method === 'HALF_EVEN') return (quotient % 2n === 0n ? quotient : quotient + 1n) * FINAL_MONEY_UNIT;
  return (quotient + 1n) * FINAL_MONEY_UNIT;
}

function normalizedRate(profile: VatProfileInput): bigint {
  if (!profile.isVatRegistered) return 0n;
  const rate = toScaled(profile.vatRate, RATE_DIGITS);
  if (rate < 0n || rate > RATE_SCALE) throw new Error('VAT rate must be between 0 and 1');
  return rate;
}

function splitVatFromGross(gross: bigint, rate: bigint): { base: bigint; vat: bigint } {
  if (rate === 0n) return { base: gross, vat: 0n };
  const base = divideHalfUp(gross * RATE_SCALE, RATE_SCALE + rate);
  return { base, vat: gross - base };
}

export function roundMoney(value: number | string): number {
  return money(toScaled(value, MONEY_DIGITS));
}

export function addMoney(...values: Array<number | string>): number {
  return money(values.reduce((sum, value) => sum + toScaled(value, MONEY_DIGITS), 0n));
}

export function multiplyMoney(value: number | string, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Money multiplier must be a non-negative integer');
  return money(toScaled(value, MONEY_DIGITS) * BigInt(quantity));
}

export function calculateMenuPrice(
  enteredPrice: number | string,
  priceEntryMode: PriceEntryMode,
  profile: VatProfileInput,
): PriceBreakdown {
  const entered = toScaled(enteredPrice, MONEY_DIGITS);
  if (entered < 0n) throw new Error('Price cannot be negative');
  const rate = normalizedRate(profile);
  if (rate === 0n) {
    return { enteredPrice: money(entered), priceEntryMode, priceBeforeVat: money(entered), vatAmount: 0, customerPrice: money(entered) };
  }
  if (priceEntryMode === 'VAT_INCLUDED') {
    const { base, vat } = splitVatFromGross(entered, rate);
    return { enteredPrice: money(entered), priceEntryMode, priceBeforeVat: money(base), vatAmount: money(vat), customerPrice: money(entered) };
  }
  const vat = divideHalfUp(entered * rate, RATE_SCALE);
  return { enteredPrice: money(entered), priceEntryMode, priceBeforeVat: money(entered), vatAmount: money(vat), customerPrice: money(entered + vat) };
}

function allocateDiscount(grossLines: bigint[], discount: bigint): bigint[] {
  const subtotal = grossLines.reduce((sum, value) => sum + value, 0n);
  if (discount <= 0n || subtotal <= 0n) return grossLines.map(() => 0n);
  const capped = discount > subtotal ? subtotal : discount;
  const allocations = grossLines.map((gross, index) => {
    const numerator = capped * gross;
    return { index, amount: numerator / subtotal, remainder: numerator % subtotal };
  });
  let remaining = capped - allocations.reduce((sum, item) => sum + item.amount, 0n);
  allocations.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
  for (const item of allocations) {
    if (remaining === 0n) break;
    if (item.amount < grossLines[item.index]) {
      item.amount += 1n;
      remaining -= 1n;
    }
  }
  allocations.sort((a, b) => a.index - b.index);
  return allocations.map((item) => item.amount);
}

export function calculateOrderPricing(
  inputLines: OrderPricingLineInput[],
  discountInput: number | string,
  profile: VatProfileInput,
): OrderPricingResult {
  if (inputLines.length === 0) throw new Error('At least one pricing line is required');
  const grossLines = inputLines.map((line) => {
    const amount = toScaled(line.customerPrice, MONEY_DIGITS);
    if (amount < 0n) throw new Error('Line price cannot be negative');
    return amount;
  });
  const subtotal = grossLines.reduce((sum, value) => sum + value, 0n);
  let requestedDiscount = toScaled(discountInput, MONEY_DIGITS);
  if (requestedDiscount < 0n) requestedDiscount = 0n;
  if (requestedDiscount > subtotal) requestedDiscount = subtotal;
  const fixedAllocations = inputLines.map((line, index) => line.complimentary ? grossLines[index] : 0n);
  const fixedDiscount = fixedAllocations.reduce((sum, value) => sum + value, 0n);
  const allocatableDiscount = requestedDiscount > fixedDiscount ? requestedDiscount - fixedDiscount : 0n;
  const discountableLines = grossLines.map((gross, index) => inputLines[index].complimentary ? 0n : gross);
  const proportionalAllocations = allocateDiscount(discountableLines, allocatableDiscount);
  const allocations = fixedAllocations.map((fixed, index) => fixed + proportionalAllocations[index]);
  const discount = allocations.reduce((sum, value) => sum + value, 0n);
  const rate = normalizedRate(profile);

  let taxableTotal = 0n;
  let vatTotal = 0n;
  const lines = inputLines.map((line, index): OrderPricingLine => {
    const netGross = grossLines[index] - allocations[index];
    const { base, vat } = splitVatFromGross(netGross, rate);
    taxableTotal += base;
    vatTotal += vat;
    return {
      ...line,
      lineSubtotal: money(grossLines[index]),
      discountAmount: money(allocations[index]),
      taxableAmount: money(base),
      vatAmount: money(vat),
      lineTotal: money(netGross),
    };
  });

  const rawGrandTotal = subtotal - discount;
  const grandTotal = roundFinal(rawGrandTotal, profile.roundingMethod);
  return {
    subtotal: money(subtotal),
    discount: money(discount),
    taxableAmount: money(taxableTotal),
    vatAmount: money(vatTotal),
    roundingDelta: money(grandTotal - rawGrandTotal),
    grandTotal: money(grandTotal),
    lines,
  };
}
