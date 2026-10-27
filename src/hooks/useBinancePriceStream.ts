import { useState, useEffect, useRef, useCallback } from 'react';
import { LiveConnectionStatus, MarketType, TickerData } from '../types/crypto';

interface UseBinancePriceStreamOptions {
  symbol: string;
  market: MarketType;
  enabled?: boolean;
}

interface UseBinancePriceStreamReturn {
  ticker: TickerData | null;
  connectionStatus: LiveConnectionStatus;
  stalenessSeconds: number;
  isStale: boolean;
  marketError: string | null;
  alternativeMarket: MarketType | null;
  refreshNow: () => Promise<void>;
  isLoading: boolean;
}

export function useBinancePriceStream({
  symbol,
  market,
  enabled = true,
}: UseBinancePriceStreamOptions): UseBinancePriceStreamReturn {
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<LiveConnectionStatus>('RECONNECTING');
  const [stalenessSeconds, setStalenessSeconds] = useState<number>(0);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [alternativeMarket, setAlternativeMarket] = useState<MarketType | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Synchronization refs to prevent race conditions & out-of-order state overwrites
  const wsRef = useRef<WebSocket | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const lastLiveReceivedRef = useRef<number>(Date.now());
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isComponentMountedRef = useRef<boolean>(true);
  const currentSymbolRef = useRef<string>(symbol);
  const currentMarketRef = useRef<MarketType>(market);
  const hasInvalidSymbolErrorRef = useRef<boolean>(false);

  // Keep refs synchronized with props
  currentSymbolRef.current = symbol;
  currentMarketRef.current = market;

  // 1. Authoritative REST Fetcher (Sync / Initial / Fallback)
  const fetchRestTicker = useCallback(async (isInitial = false) => {
    const targetSymbol = currentSymbolRef.current;
    const targetMarket = currentMarketRef.current;

    if (isInitial) {
      setIsLoading(true);
    }

    try {
      const res = await fetch(`/api/market/ticker?symbol=${targetSymbol}&market=${targetMarket}`);
      
      // If symbol or market changed during in-flight fetch, ignore response to avoid state corruption
      if (currentSymbolRef.current !== targetSymbol || currentMarketRef.current !== targetMarket) {
        return;
      }

      if (res.ok) {
        const data: TickerData = await res.json();
        
        // Race condition guard: discard if WebSocket or newer REST already delivered more recent data
        if (data.timestamp && data.timestamp < lastTimestampRef.current) {
          console.debug(`[Binance REST] Paquet REST ignoré (obsolète: ${data.timestamp} < ${lastTimestampRef.current})`);
          return;
        }

        const now = Date.now();
        lastTimestampRef.current = data.timestamp || now;
        lastLiveReceivedRef.current = now;
        hasInvalidSymbolErrorRef.current = false;
        setMarketError(null);
        setAlternativeMarket(null);

        setTicker((prev) => ({
          ...data,
          tickSize: data.tickSize ?? prev?.tickSize,
          pricePrecision: data.pricePrecision ?? prev?.pricePrecision,
          stalenessSeconds: 0,
          isStale: false,
          connectionStatus: 'CONNECTED',
        }));

        setStalenessSeconds(0);
        setIsStale(false);
        setConnectionStatus('CONNECTED');
        console.log(`[Binance REST: ${targetSymbol}] Cotation actualisée avec succès : ${data.price} USDT (timestamp: ${data.timestamp})`);
      } else {
        const errJson = await res.json().catch(() => ({}));
        hasInvalidSymbolErrorRef.current = true;
        const msg = errJson.error || `Paire ${targetSymbol} introuvable sur Binance ${targetMarket}.`;
        setMarketError(msg);
        setAlternativeMarket(errJson.alternativeMarket || null);
        setTicker(null);
        setConnectionStatus('DISCONNECTED');
        console.warn(`[Binance REST: ${targetSymbol}] Erreur serveur:`, msg);
        
        // Close WebSocket since symbol does not exist on this market
        if (wsRef.current) {
          try {
            wsRef.current.close(1000, 'Invalid symbol on market');
          } catch {
            // Ignored
          }
          wsRef.current = null;
        }
      }
    } catch (err: any) {
      if (currentSymbolRef.current === targetSymbol && currentMarketRef.current === targetMarket) {
        console.warn(`[Binance REST: ${targetSymbol}] Erreur réseau:`, err?.message);
      }
    } finally {
      if (isInitial && isComponentMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // 2. High-Frequency Real-Time WebSocket Connector
  const connectWebSocket = useCallback(() => {
    if (!enabled || !symbol || hasInvalidSymbolErrorRef.current) {
      return;
    }

    // Clean up previous socket cleanly if any
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'Switching symbol connection');
      } catch {
        // Ignored
      }
      wsRef.current = null;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const cleanSymbol = symbol.toLowerCase().trim();
    const wsUrl = market === 'futures'
      ? `wss://fstream.binance.com/ws/${cleanSymbol}@ticker`
      : `wss://stream.binance.com:9443/ws/${cleanSymbol}@ticker`;

    console.log(`[Binance WS: ${symbol}] Tentative de connexion sur ${market} (${wsUrl})`);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        console.log(`[Binance WS: ${symbol}] Connexion établie avec succès sur Binance ${market}`);
        setConnectionStatus('CONNECTED');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const raw = JSON.parse(event.data);
          // Binance 24hrTicker payload: { e: '24hrTicker', E: timestamp, s: 'BTCUSDT', c: lastPrice, ... }
          if (raw.c && raw.s && raw.s.toUpperCase() === currentSymbolRef.current.toUpperCase()) {
            const lastPrice = parseFloat(raw.c);
            const eventTime = raw.E || Date.now();

            // Strict race condition guard: discard older packets
            if (eventTime < lastTimestampRef.current) {
              console.debug(`[Binance WS: ${raw.s}] Paquet WS rejeté car plus ancien (${eventTime} < ${lastTimestampRef.current})`);
              return;
            }

            const now = Date.now();
            lastTimestampRef.current = eventTime;
            lastLiveReceivedRef.current = now;

            setTicker((prev) => {
              const tickSize = prev?.tickSize || (lastPrice < 0.1 ? 0.00001 : lastPrice < 1 ? 0.0001 : 0.01);
              const pricePrecision = prev?.pricePrecision || (lastPrice < 0.1 ? 5 : lastPrice < 1 ? 4 : 2);

              return {
                symbol: currentSymbolRef.current,
                market: currentMarketRef.current,
                price: lastPrice,
                change24h: parseFloat(raw.P) || 0,
                change24hAmount: parseFloat(raw.p) || 0,
                high24h: parseFloat(raw.h) || lastPrice,
                low24h: parseFloat(raw.l) || lastPrice,
                volume24h: parseFloat(raw.v) || 0,
                quoteVolume24h: parseFloat(raw.q) || 0,
                timestamp: eventTime,
                isLive: true,
                source: currentMarketRef.current === 'futures' ? 'Binance USDⓈ-M Futures (WebSocket)' : 'Binance Spot (WebSocket)',
                tickSize,
                pricePrecision,
                stalenessSeconds: 0,
                isStale: false,
                connectionStatus: 'CONNECTED',
              };
            });

            setStalenessSeconds(0);
            setIsStale(false);
            setConnectionStatus('CONNECTED');
          }
        } catch (err: any) {
          console.warn(`[Binance WS: ${symbol}] Erreur de parsing du message:`, err?.message);
        }
      };

      ws.onerror = (e: Event) => {
        if (wsRef.current !== ws) return;
        console.warn(`[Binance WS: ${symbol}] Erreur réseau détectée sur la WebSocket Binance`, e);
        setConnectionStatus('RECONNECTING');
      };

      ws.onclose = (e: CloseEvent) => {
        if (wsRef.current !== ws) return;
        console.log(`[Binance WS: ${symbol}] WebSocket fermée (code: ${e.code}, raison: "${e.reason || 'N/A'}")`);
        wsRef.current = null;

        // Normal close code 1000 or component unmounting or known invalid symbol
        if (e.code === 1000 || !isComponentMountedRef.current || hasInvalidSymbolErrorRef.current) {
          return;
        }

        // Automatic reconnection with exponential backoff + jitter
        setConnectionStatus('RECONNECTING');
        const attempts = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempts), 8000) + Math.random() * 500;
        reconnectAttemptsRef.current += 1;
        console.log(`[Binance WS: ${symbol}] Reconnexion programmée dans ${Math.round(delay)} ms (tentative #${reconnectAttemptsRef.current})`);

        reconnectTimerRef.current = setTimeout(() => {
          if (isComponentMountedRef.current && !hasInvalidSymbolErrorRef.current) {
            connectWebSocket();
            fetchRestTicker();
          }
        }, delay);
      };
    } catch (wsErr: any) {
      console.warn(`[Binance WS: ${symbol}] Erreur d'initialisation WebSocket:`, wsErr?.message);
      setConnectionStatus('RECONNECTING');
    }
  }, [enabled, symbol, market, fetchRestTicker]);

  // 3. Mount / Symbol / Market Lifecycle
  useEffect(() => {
    isComponentMountedRef.current = true;
    lastTimestampRef.current = 0;
    lastLiveReceivedRef.current = Date.now();
    reconnectAttemptsRef.current = 0;
    hasInvalidSymbolErrorRef.current = false;
    
    // Clear previous ticker immediately on symbol/market transition to prevent stale bleed
    setTicker(null);
    setMarketError(null);
    setAlternativeMarket(null);
    setConnectionStatus('RECONNECTING');
    setIsStale(false);
    setStalenessSeconds(0);

    // Initial immediate REST fetch
    fetchRestTicker(true);

    // Establish WebSocket stream
    connectWebSocket();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close(1000, 'Component re-rendered or unmounted');
        } catch {
          // Ignored
        }
        wsRef.current = null;
      }
    };
  }, [symbol, market, fetchRestTicker, connectWebSocket]);

  // 4. Mobile Device Lifecycle (Phone Unlock, Tab Visibility Change, Screen Wake)
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceLastQuote = Date.now() - lastLiveReceivedRef.current;
        console.log(`[Binance Lifecycle] Retour application au premier plan (${Math.round(timeSinceLastQuote / 1000)}s depuis dernière cotation)`);
        
        // If inactive for > 2 seconds, or socket is broken, refresh immediately via REST
        if (timeSinceLastQuote > 2000 || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          fetchRestTicker(false);
          if (!hasInvalidSymbolErrorRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
            connectWebSocket();
          }
        }
      }
    };

    const handleOnline = () => {
      console.log('[Binance Lifecycle] Réseau reconnecté (événement online)');
      fetchRestTicker(false);
      if (!hasInvalidSymbolErrorRef.current) {
        connectWebSocket();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [fetchRestTicker, connectWebSocket]);

  // 5. Watchdog Heartbeat (Checks every 1s, triggers REST sync if slow, flags stale if > 25s)
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      if (!enabled || hasInvalidSymbolErrorRef.current) return;

      const elapsedSec = Math.max(0, Math.floor((Date.now() - lastLiveReceivedRef.current) / 1000));
      setStalenessSeconds(elapsedSec);

      // Only flag truly stale if >= 25 seconds without any valid tick or REST quote
      if (elapsedSec >= 25) {
        setIsStale(true);
        setConnectionStatus('STALE');
      } else {
        setIsStale(false);
        // If elapsed is under 25s, restore to CONNECTED or RECONNECTING accurately
        setConnectionStatus((prev) => {
          if (prev === 'STALE') {
            return wsRef.current?.readyState === WebSocket.OPEN ? 'CONNECTED' : 'RECONNECTING';
          }
          return prev;
        });
      }

      // If no quote received for 10s, perform a quiet background REST sync to refresh
      if (elapsedSec >= 10 && elapsedSec % 10 === 0) {
        console.debug(`[Binance Watchdog] Synchronisation REST de secours après ${elapsedSec}s de silence`);
        fetchRestTicker(false);
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          connectWebSocket();
        }
      }
    }, 1000);

    return () => clearInterval(watchdogInterval);
  }, [enabled, fetchRestTicker, connectWebSocket]);

  const refreshNow = useCallback(async () => {
    setIsLoading(true);
    await fetchRestTicker(false);
    if (!hasInvalidSymbolErrorRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
      connectWebSocket();
    }
    setIsLoading(false);
  }, [fetchRestTicker, connectWebSocket]);

  return {
    ticker,
    connectionStatus,
    stalenessSeconds,
    isStale,
    marketError,
    alternativeMarket,
    refreshNow,
    isLoading,
  };
}
