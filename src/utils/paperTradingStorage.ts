import { PaperTrade, PaperAccountConfig } from '../types/paperTrading';

const DB_NAME = 'CryptoEdgePaperTradingDB';
const DB_VERSION = 1;
const TRADES_STORE = 'trades';
const CONFIG_STORE = 'config';
const LOCAL_STORAGE_KEY_TRADES = 'crypto_edge_paper_trades_v1';
const LOCAL_STORAGE_KEY_CONFIG = 'crypto_edge_paper_config_v1';

export const DEFAULT_PAPER_CONFIG: PaperAccountConfig = {
  initialCapital: 10000,
  riskPerTradePercent: 0.5, // 0.5% recommended default
  tp1ClosePercent: 50,
  tp2ClosePercent: 25,
  tp3ClosePercent: 25,
  moveToBreakEvenAfterTP1: false,
  defaultFeeRatePercent: 0.04, // 0.04% taker
  defaultSlippagePercent: 0.02, // 0.02%
  defaultFundingRatePercent: 0.01, // 0.01% / 8h
  maxOpenPositions: 5,
  isAutoTradingActive: false,
  isPaused: false,
};

// Check if IndexedDB is available in the current environment
const isIndexedDBAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
  } catch {
    return false;
  }
};

const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB non disponible'));
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(TRADES_STORE)) {
          const store = db.createObjectStore(TRADES_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('symbol', 'symbol', { unique: false });
          store.createIndex('entryTime', 'entryTime', { unique: false });
        }
        if (!db.objectStoreNames.contains(CONFIG_STORE)) {
          db.createObjectStore(CONFIG_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Load all paper trades with fallback to localStorage
 */
export async function loadPaperTradesFromStorage(): Promise<PaperTrade[]> {
  if (isIndexedDBAvailable()) {
    try {
      const db = await openDatabase();
      return await new Promise<PaperTrade[]>((resolve, reject) => {
        const tx = db.transaction(TRADES_STORE, 'readonly');
        const store = tx.objectStore(TRADES_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const trades = req.result as PaperTrade[];
          resolve(validateAndSanitizeTrades(trades));
        };
        req.onerror = () => reject(req.error);
      });
    } catch (idbErr) {
      console.warn('[PaperTradingStorage] IndexedDB non utilisable, bascule vers localStorage:', idbErr);
    }
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_TRADES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return validateAndSanitizeTrades(parsed);
  } catch (lsErr) {
    console.error('[PaperTradingStorage] Erreur lecture localStorage:', lsErr);
    return [];
  }
}

/**
 * Save all paper trades with fallback to localStorage
 */
export async function savePaperTradesToStorage(trades: PaperTrade[]): Promise<void> {
  const sanitized = validateAndSanitizeTrades(trades);

  // Always mirror in localStorage for immediate sync across tabs
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_TRADES, JSON.stringify(sanitized));
  } catch (lsErr) {
    console.warn('[PaperTradingStorage] Erreur écriture miroir localStorage:', lsErr);
  }

  if (isIndexedDBAvailable()) {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TRADES_STORE, 'readwrite');
        const store = tx.objectStore(TRADES_STORE);
        store.clear();
        for (const t of sanitized) {
          store.put(t);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (idbErr) {
      console.warn('[PaperTradingStorage] Erreur enregistrement IndexedDB:', idbErr);
    }
  }
}

/**
 * Load config with fallback
 */
export async function loadPaperConfigFromStorage(): Promise<PaperAccountConfig> {
  if (isIndexedDBAvailable()) {
    try {
      const db = await openDatabase();
      const res = await new Promise<PaperAccountConfig | null>((resolve, reject) => {
        const tx = db.transaction(CONFIG_STORE, 'readonly');
        const store = tx.objectStore(CONFIG_STORE);
        const req = store.get('account_config');
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
      if (res) return { ...DEFAULT_PAPER_CONFIG, ...res };
    } catch {
      // Ignore and fallback
    }
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_CONFIG);
    if (!raw) return DEFAULT_PAPER_CONFIG;
    return { ...DEFAULT_PAPER_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PAPER_CONFIG;
  }
}

/**
 * Save config with fallback
 */
export async function savePaperConfigToStorage(config: PaperAccountConfig): Promise<void> {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_CONFIG, JSON.stringify(config));
  } catch (err) {
    console.warn('[PaperTradingStorage] Erreur sauvegarde config localStorage:', err);
  }

  if (isIndexedDBAvailable()) {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CONFIG_STORE, 'readwrite');
        const store = tx.objectStore(CONFIG_STORE);
        store.put({ key: 'account_config', value: config });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[PaperTradingStorage] Erreur sauvegarde config IndexedDB:', err);
    }
  }
}

/**
 * Clear all trades and reset history
 */
export async function clearPaperTradesStorage(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_TRADES);
  } catch {}

  if (isIndexedDBAvailable()) {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TRADES_STORE, 'readwrite');
        const store = tx.objectStore(TRADES_STORE);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  }
}

/**
 * Sanitize and validate trade objects loaded from persistence
 */
function validateAndSanitizeTrades(rawList: any[]): PaperTrade[] {
  if (!Array.isArray(rawList)) return [];

  return rawList.filter((item): item is PaperTrade => {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.symbol === 'string' &&
      (item.direction === 'LONG' || item.direction === 'SHORT') &&
      typeof item.entryPrice === 'number' &&
      !isNaN(item.entryPrice) &&
      item.entryPrice > 0 &&
      typeof item.stopLoss === 'number' &&
      !isNaN(item.stopLoss) &&
      typeof item.initialQuantity === 'number' &&
      item.initialQuantity > 0 &&
      Array.isArray(item.partialFills)
    );
  });
}

/**
 * Export Paper Trades to CSV
 */
export function exportPaperTradesToCSV(trades: PaperTrade[]): string {
  const headers = [
    'ID',
    'Date Entrée',
    'Date Clôture',
    'Symbole',
    'Marché',
    'Direction',
    'Statut',
    'Prix Entrée',
    'Prix Sortie Final',
    'Stop Loss Initial',
    'TP1',
    'TP2',
    'TP3',
    'Quantité Initiale',
    'Quantité Restante',
    'P&L Brut ($)',
    'P&L Net ($)',
    'Frais Payés ($)',
    'Score Confluence',
    'Motif Clôture',
  ];

  const rows = trades.map((t) => [
    t.id,
    new Date(t.entryTime).toISOString(),
    t.closeTime ? new Date(t.closeTime).toISOString() : 'EN COURS',
    t.symbol,
    t.market,
    t.direction,
    t.status,
    t.entryPrice.toFixed(6),
    t.finalExitPrice ? t.finalExitPrice.toFixed(6) : '',
    t.initialStopLoss.toFixed(6),
    t.takeProfit1.toFixed(6),
    t.takeProfit2.toFixed(6),
    t.takeProfit3 ? t.takeProfit3.toFixed(6) : '',
    t.initialQuantity.toFixed(4),
    t.currentQuantity.toFixed(4),
    t.realizedGrossPnl.toFixed(2),
    t.realizedNetPnl.toFixed(2),
    t.totalFeesPaid.toFixed(2),
    t.qualityScore.toString(),
    `"${(t.exitReason || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

/**
 * Export Paper Trades to JSON
 */
export function exportPaperTradesToJSON(trades: PaperTrade[], config: PaperAccountConfig): string {
  return JSON.stringify(
    {
      exportDate: new Date().toISOString(),
      version: 'CryptoEdge_PaperTrading_v1',
      config,
      totalTradesCount: trades.length,
      trades,
    },
    null,
    2
  );
}
