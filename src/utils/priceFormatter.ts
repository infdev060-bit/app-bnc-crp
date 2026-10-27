/**
 * Price formatting and tickSize quantization utilities for Crypto Edge AI.
 * Handles high-precision micro-cap and meme tokens (e.g., 0.000012)
 * as well as major coins (e.g., 80,000.00) without truncation.
 */

/**
 * Returns the number of decimal places defined by a tickSize (e.g. 0.00001 -> 5, 0.01 -> 2)
 */
export function getDecimalsFromTickSize(tickSize?: number): number {
  if (!tickSize || tickSize <= 0) return 2;
  const tickStr = tickSize.toString();
  if (tickStr.includes('e-')) {
    const parts = tickStr.split('e-');
    return parseInt(parts[1], 10);
  }
  const decimalIndex = tickStr.indexOf('.');
  return decimalIndex === -1 ? 0 : tickStr.length - decimalIndex - 1;
}

/**
 * Safely quantize a price to the exchange's tickSize.
 * mode:
 * - 'floor': rounds down (used for Long SL and Short TP)
 * - 'ceil': rounds up (used for Short SL and Long TP)
 * - 'round': standard nearest rounding (used for Entry)
 */
export function quantizePrice(price: number, tickSize?: number, mode: 'floor' | 'ceil' | 'round' = 'round'): number {
  if (!tickSize || tickSize <= 0 || isNaN(price) || price <= 0) {
    return price;
  }

  const decimals = Math.min(getDecimalsFromTickSize(tickSize), 10);
  const factor = Math.pow(10, decimals);
  const tickInt = Math.round(tickSize * factor);

  if (tickInt <= 0) return price;

  const priceInt = price * factor;
  let quantizedInt: number;

  if (mode === 'floor') {
    quantizedInt = Math.floor(priceInt / tickInt) * tickInt;
  } else if (mode === 'ceil') {
    quantizedInt = Math.ceil(priceInt / tickInt) * tickInt;
  } else {
    quantizedInt = Math.round(priceInt / tickInt) * tickInt;
  }

  const result = quantizedInt / factor;
  // Eliminate floating point noise e.g. 0.051000000000000004
  return parseFloat(result.toFixed(decimals));
}

/**
 * Determine suitable number of decimal places based on price magnitude if tickSize is unknown
 */
export function getDefaultDecimals(price: number): number {
  if (isNaN(price) || price <= 0) return 2;
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  if (price >= 0.0001) return 7;
  return 8;
}

/**
 * Format cryptocurrency price in French locale with proper decimal precision
 */
export function formatCryptoPrice(price: number | undefined | null, tickSize?: number): string {
  if (price === undefined || price === null || isNaN(price)) {
    return '0,00';
  }

  const decimals = tickSize && tickSize > 0 ? getDecimalsFromTickSize(tickSize) : getDefaultDecimals(price);
  const formatted = price.toLocaleString('fr-FR', {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: Math.max(decimals, 2),
  });

  return formatted;
}
