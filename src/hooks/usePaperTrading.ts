import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TradeSetup, MarketType } from '../types/crypto';
import {
  PaperTrade,
  PaperAccountConfig,
  PaperAccountState,
  PaperTradingStats,
} from '../types/paperTrading';
import {
  DEFAULT_PAPER_CONFIG,
  loadPaperConfigFromStorage,
  loadPaperTradesFromStorage,
  savePaperConfigToStorage,
  savePaperTradesToStorage,
  clearPaperTradesStorage,
} from '../utils/paperTradingStorage';
import {
  createPaperTradeFromSetup,
  updateTradeWithCurrentPrice,
  manualClosePaperTrade,
  calculateAccountState,
  calculatePaperTradingStats,
} from '../utils/paperTradingEngine';

export function usePaperTrading() {
  const [config, setConfig] = useState<PaperAccountConfig>(DEFAULT_PAPER_CONFIG);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // In-memory set of recently registered signals to prevent rapid duplicate opens
  const recentlyRegisteredSignals = useRef<Set<string>>(new Set());

  // Load from IndexedDB / localStorage on mount
  useEffect(() => {
    let isMounted = true;
    async function init() {
      try {
        const [savedConfig, savedTrades] = await Promise.all([
          loadPaperConfigFromStorage(),
          loadPaperTradesFromStorage(),
        ]);
        if (isMounted) {
          setConfig(savedConfig);
          setTrades(savedTrades);
          setIsLoaded(true);

          // Populate recently registered set with open trade symbols
          for (const t of savedTrades) {
            if (t.currentQuantity > 0) {
              recentlyRegisteredSignals.current.add(`${t.market}:${t.symbol}`);
            }
          }
        }
      } catch (err) {
        console.error('[usePaperTrading] Erreur chargement initial:', err);
        if (isMounted) setIsLoaded(true);
      }
    }
    init();
    return () => {
      isMounted = false;
    };
  }, []);

  // Save changes to storage whenever trades or config change
  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  const configRef = useRef(config);
  configRef.current = config;

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const persistState = useCallback(() => {
    if (!isLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      savePaperTradesToStorage(tradesRef.current);
      savePaperConfigToStorage(configRef.current);
    }, 200);
  }, [isLoaded]);

  // Update Config
  const updateConfig = useCallback((newConfig: Partial<PaperAccountConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...newConfig };
      configRef.current = updated;
      savePaperConfigToStorage(updated);
      return updated;
    });
  }, []);

  // Compute derived state
  const accountState: PaperAccountState = useMemo(() => {
    return calculateAccountState(trades, config);
  }, [trades, config]);

  const stats: PaperTradingStats = useMemo(() => {
    return calculatePaperTradingStats(trades);
  }, [trades]);

  const openPositions = useMemo(() => {
    return trades.filter((t) => t.currentQuantity > 0 && t.status !== 'SL_HIT' && t.status !== 'TP3_HIT' && t.status !== 'MANUAL_CLOSED');
  }, [trades]);

  const closedTrades = useMemo(() => {
    return trades.filter((t) => t.currentQuantity <= 0 || t.status === 'SL_HIT' || t.status === 'TP3_HIT' || t.status === 'MANUAL_CLOSED');
  }, [trades]);

  // Open manual trade from setup
  const openManualTrade = useCallback(
    (setup: TradeSetup): { success: boolean; message: string } => {
      if (!setup || setup.direction === 'NO_TRADE') {
        return { success: false, message: 'Configuration de trade invalide ou en NO_TRADE.' };
      }

      if (openPositions.length >= config.maxOpenPositions) {
        return {
          success: false,
          message: `Limite maximale de positions ouvertes atteinte (${config.maxOpenPositions} positions).`,
        };
      }

      const existingOpen = openPositions.find(
        (p) => p.symbol === setup.pair && p.market === setup.market && p.direction === setup.direction
      );
      if (existingOpen) {
        return {
          success: false,
          message: `Une position ${setup.direction} sur ${setup.pair} (${setup.market}) est déjà ouverte.`,
        };
      }

      const newTrade = createPaperTradeFromSetup(setup, accountState.availableBalance, config);
      if (!newTrade) {
        return { success: false, message: 'Fonds disponibles insuffisants ou calcul de quantité invalide.' };
      }

      setTrades((prev) => [newTrade, ...prev]);
      recentlyRegisteredSignals.current.add(`${setup.market}:${setup.pair}`);
      persistState();

      return { success: true, message: `Position simulée ${setup.direction} sur ${setup.pair} ouverte avec succès.` };
    },
    [openPositions, config, accountState.availableBalance, persistState]
  );

  // Auto Ingest Signal from Scanner / Dashboard
  const autoIngestSignal = useCallback(
    (setup: TradeSetup, score: number): boolean => {
      if (!config.isAutoTradingActive || config.isPaused) return false;
      if (!setup || setup.direction === 'NO_TRADE') return false;
      if (score < 65) return false; // Minimum confluence threshold

      const key = `${setup.market}:${setup.pair}`;
      if (recentlyRegisteredSignals.current.has(key)) return false;

      if (openPositions.length >= config.maxOpenPositions) return false;

      const newTrade = createPaperTradeFromSetup(setup, accountState.availableBalance, config);
      if (!newTrade) return false;

      newTrade.qualityScore = score;
      setTrades((prev) => [newTrade, ...prev]);
      recentlyRegisteredSignals.current.add(key);
      persistState();
      return true;
    },
    [config, openPositions.length, accountState.availableBalance, persistState]
  );

  // Manual Close Trade
  const closeManualTrade = useCallback(
    (tradeId: string, currentPrice?: number) => {
      setTrades((prev) => {
        return prev.map((t) => {
          if (t.id !== tradeId) return t;
          const exitPrice = currentPrice && currentPrice > 0 ? currentPrice : t.currentMarketPrice;
          const closed = manualClosePaperTrade(t, exitPrice);
          recentlyRegisteredSignals.current.delete(`${t.market}:${t.symbol}`);
          return closed;
        });
      });
      persistState();
    },
    [persistState]
  );

  // Process a live price tick for a symbol
  const processPriceUpdate = useCallback(
    (symbol: string, market: MarketType, price: number, isStale: boolean) => {
      if (price <= 0 || !isFinite(price)) return;

      setTrades((prev) => {
        let hasChanges = false;
        const now = Date.now();

        const updated = prev.map((t) => {
          if (t.symbol !== symbol || t.market !== market || t.currentQuantity <= 0) {
            return t;
          }

          const processed = updateTradeWithCurrentPrice(t, price, now, isStale, config);
          if (
            processed.currentMarketPrice !== t.currentMarketPrice ||
            processed.status !== t.status ||
            processed.currentQuantity !== t.currentQuantity ||
            processed.unrealizedNetPnl !== t.unrealizedNetPnl
          ) {
            hasChanges = true;
          }

          if (processed.currentQuantity <= 0) {
            recentlyRegisteredSignals.current.delete(`${processed.market}:${processed.symbol}`);
          }

          return processed;
        });

        if (hasChanges) {
          persistState();
          return updated;
        }
        return prev;
      });
    },
    [config, persistState]
  );

  // Reset Account & History
  const resetAccount = useCallback(async () => {
    await clearPaperTradesStorage();
    recentlyRegisteredSignals.current.clear();
    setTrades([]);
    setConfig((prev) => {
      const reset = { ...prev, isAutoTradingActive: false, isPaused: false };
      savePaperConfigToStorage(reset);
      return reset;
    });
  }, []);

  // Clear Closed Trades Only
  const clearClosedHistory = useCallback(async () => {
    setTrades((prev) => {
      const onlyOpen = prev.filter((t) => t.currentQuantity > 0 && t.status !== 'SL_HIT' && t.status !== 'TP3_HIT' && t.status !== 'MANUAL_CLOSED');
      savePaperTradesToStorage(onlyOpen);
      return onlyOpen;
    });
  }, []);

  return {
    isLoaded,
    config,
    updateConfig,
    trades,
    openPositions,
    closedTrades,
    accountState,
    stats,
    openManualTrade,
    closeManualTrade,
    processPriceUpdate,
    autoIngestSignal,
    resetAccount,
    clearClosedHistory,
  };
}
