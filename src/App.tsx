import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Candle,
  IndicatorSnapshot,
  LiveConnectionStatus,
  MarketType,
  SavedAnalysis,
  TickerData,
  Timeframe,
  VisionAnalysisResult,
  TradeSetup,
  QualityScore,
  VerificationCheck,
} from './types/crypto';
import { useBinancePriceStream } from './hooks/useBinancePriceStream';
import { generateTimeframeSnapshot } from './utils/indicators';
import { evaluateMarketSetup, EvaluationResult, validatePriceHierarchy, calculateRiskRewardRatios } from './utils/tradeValidator';
import { formatCryptoPrice, quantizePrice } from './utils/priceFormatter';
import { TradingChart } from './components/TradingChart';
import { MultiTimeframePanel } from './components/MultiTimeframePanel';
import { TradeSetupCard } from './components/TradeSetupCard';
import { ChartVisionUploader } from './components/ChartVisionUploader';
import { RiskCalculator } from './components/RiskCalculator';
import { BacktestModule } from './components/BacktestModule';
import { MarketScanner } from './components/MarketScanner';
import { NewsIntelligence } from './components/NewsIntelligence';
import { NewsSentimentWidget } from './components/NewsSentimentWidget';
import { AnalysisHistoryModal } from './components/AnalysisHistoryModal';
import { PaperTradingDashboard } from './components/PaperTradingDashboard';
import { usePaperTrading } from './hooks/usePaperTrading';
import {
  Search,
  Activity,
  Shield,
  Layers,
  Calculator,
  History,
  Eye,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Radio,
  Sliders,
  ChevronRight,
  Wifi,
  WifiOff,
  Radar,
  Newspaper,
  Wallet,
} from 'lucide-react';

const POPULAR_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SUIUSDT'];

export default function App() {
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [searchInput, setSearchInput] = useState<string>('BTCUSDT');
  const [market, setMarket] = useState<MarketType>('futures');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scanner' | 'paper' | 'news' | 'vision' | 'calculator' | 'backtest'>('dashboard');

  // Paper Trading Hook State
  const {
    config: paperConfig,
    updateConfig: updatePaperConfig,
    trades: paperTrades,
    openPositions: paperOpenPositions,
    closedTrades: paperClosedTrades,
    accountState: paperAccountState,
    stats: paperStats,
    openManualTrade: openPaperManualTrade,
    closeManualTrade: closePaperManualTrade,
    processPriceUpdate: processPaperPriceUpdate,
    autoIngestSignal: autoIngestPaperSignal,
    resetAccount: resetPaperAccount,
    clearClosedHistory: clearPaperClosedHistory,
  } = usePaperTrading();

  // Real-time high-frequency WebSocket + REST stream with mobile lifecycle & race condition guards
  const {
    ticker,
    connectionStatus,
    stalenessSeconds,
    isStale,
    marketError,
    alternativeMarket,
    refreshNow,
    isLoading: isLoadingTicker,
  } = useBinancePriceStream({
    symbol,
    market,
    enabled: true,
  });

  // Candlestick and Snapshot States
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('1h');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(false);

  // Multi-timeframe snapshots
  const [snapshots, setSnapshots] = useState<Partial<Record<Timeframe, IndicatorSnapshot>>>({});

  // Vision Analysis State
  const [visionAnalysis, setVisionAnalysis] = useState<VisionAnalysisResult | null>(null);

  // Setup Verification State
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isAiVerifying, setIsAiVerifying] = useState<boolean>(false);
  const [aiRateLimited, setAiRateLimited] = useState<boolean>(false);
  const [isAiAudited, setIsAiAudited] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [calculatorSetup, setCalculatorSetup] = useState<TradeSetup | null>(null);

  // History State
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [history, setHistory] = useState<SavedAnalysis[]>(() => {
    try {
      const stored = localStorage.getItem('crypto_edge_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Fetch Klines Data for active timeframe
  const fetchKlines = useCallback(async (tf: Timeframe = activeTimeframe, signal?: AbortSignal) => {
    setIsLoadingCandles(true);
    try {
      const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${tf}&limit=100&market=${market}`, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.klines && Array.isArray(data.klines) && data.klines.length > 0) {
          setCandles(data.klines);
          const snap = generateTimeframeSnapshot(data.klines, tf);
          setSnapshots((prev) => ({ ...prev, [tf]: snap }));
        } else {
          setCandles([]);
        }
      } else {
        setCandles([]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Erreur chargement bougies:', err);
        setCandles([]);
      }
    } finally {
      setIsLoadingCandles(false);
    }
  }, [symbol, market, activeTimeframe]);

  // Fetch Multi-Timeframe Background Data (4H, 1H, 15M, 5M)
  const fetchAllTimeframes = useCallback(async (signal?: AbortSignal) => {
    const tfs: Timeframe[] = ['4h', '1h', '15m', '5m'];
    const results: Partial<Record<Timeframe, IndicatorSnapshot>> = {};

    await Promise.all(
      tfs.map(async (tf) => {
        try {
          const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${tf}&limit=70&market=${market}`, { signal });
          if (res.ok) {
            const data = await res.json();
            if (data.klines && Array.isArray(data.klines) && data.klines.length > 0) {
              results[tf] = generateTimeframeSnapshot(data.klines, tf);
            }
          }
        } catch {
          // Keep resilient
        }
      })
    );

    setSnapshots((prev) => ({ ...prev, ...results }));
  }, [symbol, market]);

  // Handle symbol / market transitions cleanly without stale state bleed
  useEffect(() => {
    const abortController = new AbortController();

    // Reset old evaluations to prevent displaying wrong pair results
    setEvaluation(null);
    setCandles([]);
    setSnapshots({});

    fetchKlines(activeTimeframe, abortController.signal);
    fetchAllTimeframes(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [symbol, market, fetchKlines, fetchAllTimeframes, activeTimeframe]);

  // 1. Instant deterministic local evaluation (runs purely algorithmically, consumes 0 API quota)
  const runLocalEvaluation = useCallback(() => {
    if (marketError) {
      setEvaluation({
        outcome: 'NO_TRADE',
        qualityScore: {
          total: 0,
          ratingLabel: 'INSUFFISANT',
          breakdown: {
            htfAlignment: 0,
            marketStructure: 0,
            entryQuality: 0,
            volumeConfirmation: 0,
            riskRewardScore: 0,
            volatilityScore: 0,
            dataReliability: 0,
          },
          explanation: 'Données de marché non disponibles pour cette paire.',
        },
        checklist: [
          {
            id: 'check-1',
            label: 'Fraîcheur et validité des cotations réelles',
            status: 'FAILED',
            comment: marketError,
          },
        ],
        noTradeReasons: [marketError],
        executiveSummary: `AUCUN TRADE RECOMMANDÉ (NO TRADE). ${marketError}`,
      });
      return;
    }

    if (!ticker) {
      return;
    }

    // Staleness guard: if data is stale (> 30s) or stream is lost, strictly block trade setups
    if (isStale || stalenessSeconds > 30) {
      setEvaluation({
        outcome: 'NO_TRADE',
        qualityScore: {
          total: 0,
          ratingLabel: 'INSUFFISANT',
          breakdown: {
            htfAlignment: 0,
            marketStructure: 0,
            entryQuality: 0,
            volumeConfirmation: 0,
            riskRewardScore: 0,
            volatilityScore: 0,
            dataReliability: 0,
          },
          explanation: 'Flux de cotations interrompu ou figé sur votre appareil.',
        },
        checklist: [
          {
            id: 'check-1',
            label: 'Fraîcheur et validité des cotations réelles',
            status: 'FAILED',
            comment: `Cotations figées depuis ${stalenessSeconds}s (seuil max 30s). Flux WebSocket/REST interrompu.`,
          },
        ],
        noTradeReasons: [
          `Cotations interrompues ou figées depuis ${stalenessSeconds} secondes. Par mesure stricte de préservation du capital, aucune configuration n'est autorisée sur des données de marché obsolètes.`,
        ],
        executiveSummary: `AUCUN TRADE RECOMMANDÉ (NO TRADE). Cotations de marché obsolètes ou déconnectées sur votre terminal.`,
      });
      return;
    }

    const localResult = evaluateMarketSetup({
      symbol,
      market,
      currentPrice: ticker.price,
      ticker,
      timeframe4h: snapshots['4h'],
      timeframe1h: snapshots['1h'],
      timeframe15m: snapshots['15m'],
      timeframe5m: snapshots['5m'],
      userRiskPercent: 1.0,
    });

    setEvaluation(localResult);
  }, [symbol, market, ticker, snapshots, marketError, isStale, stalenessSeconds]);

  // 2. On-demand AI Deep Verification (called explicitly by user, handles 429 quota limits gracefully)
  const runAiDeepAnalysis = useCallback(async () => {
    if (!ticker || ticker.price <= 0 || isAiVerifying) return;
    setIsAiVerifying(true);

    try {
      const localResult = evaluateMarketSetup({
        symbol,
        market,
        currentPrice: ticker.price,
        ticker,
        timeframe4h: snapshots['4h'],
        timeframe1h: snapshots['1h'],
        timeframe15m: snapshots['15m'],
        timeframe5m: snapshots['5m'],
        userRiskPercent: 1.0,
      });

      const aiRes = await fetch('/api/ai/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          market,
          currentPrice: ticker.price,
          technicalData: snapshots,
          visionData: visionAnalysis,
          userParameters: { maxRiskPercent: 1.0 },
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();

        if (aiData.rateLimited) {
          setAiRateLimited(true);
          // Keep local evaluation intact
          setEvaluation(localResult);
          return;
        }

        if (aiData.success && aiData.verdict) {
          setAiRateLimited(false);
          setIsAiAudited(true);
          const v = aiData.verdict;
          const tick = ticker.tickSize || 0.01;
          const frictionPct = market === 'futures' ? 0.12 : 0.24;

          let validatedAiSetup: TradeSetup | undefined = undefined;
          let aiOutcome: 'LONG' | 'SHORT' | 'NO_TRADE' = v.outcome === 'LONG' || v.outcome === 'SHORT' ? v.outcome : 'NO_TRADE';
          const extraReasons: string[] = [];

          if (aiOutcome !== 'NO_TRADE' && v.setup) {
            const rawEntry = v.setup.entryPrice || ticker.price;
            const rawSL = v.setup.stopLoss;
            const rawTP1 = v.setup.takeProfit1;
            const rawTP2 = v.setup.takeProfit2;
            const rawTP3 = v.setup.takeProfit3;

            // Quantize with correct directional bias
            const qEntry = quantizePrice(rawEntry, tick, 'round');
            const qSL = quantizePrice(rawSL, tick, aiOutcome === 'LONG' ? 'floor' : 'ceil');
            const qTP1 = quantizePrice(rawTP1, tick, aiOutcome === 'LONG' ? 'ceil' : 'floor');
            const qTP2 = quantizePrice(rawTP2, tick, aiOutcome === 'LONG' ? 'ceil' : 'floor');
            const qTP3 = rawTP3 ? quantizePrice(rawTP3, tick, aiOutcome === 'LONG' ? 'ceil' : 'floor') : undefined;

            const hierarchy = validatePriceHierarchy(aiOutcome, qEntry, qSL, qTP1, qTP2, qTP3);
            if (!hierarchy.isValid) {
              aiOutcome = 'NO_TRADE';
              extraReasons.push(hierarchy.errorReason || 'Incohérence stricte de la hiérarchie de prix de la proposition IA.');
            } else {
              const rrTP1 = calculateRiskRewardRatios(aiOutcome, qEntry, qSL, qTP1, frictionPct);
              const rrTP2 = calculateRiskRewardRatios(aiOutcome, qEntry, qSL, qTP2, frictionPct);
              const rrTP3 = qTP3 !== undefined ? calculateRiskRewardRatios(aiOutcome, qEntry, qSL, qTP3, frictionPct) : undefined;

              if (!rrTP1.isValid || rrTP1.grossRR < 1.3 || rrTP1.netRR < 1.0) {
                aiOutcome = 'NO_TRADE';
                extraReasons.push(`Ratio R/R insuffisant ou négatif après frais (${rrTP1.errorReason || `Net R/R TP1: ${rrTP1.netRR.toFixed(2)}:1`}).`);
              } else {
                validatedAiSetup = {
                  direction: aiOutcome,
                  pair: symbol,
                  market,
                  entryPrice: qEntry,
                  entryZone: v.setup.entryZone || `${qEntry}$`,
                  stopLoss: qSL,
                  invalidationCondition: v.setup.invalidationCondition || 'Clôture hors de la zone structurelle.',
                  takeProfit1: qTP1,
                  takeProfit2: qTP2,
                  ...(qTP3 !== undefined ? { takeProfit3: qTP3 } : {}),
                  riskRewardRatioTP1: parseFloat(rrTP1.grossRR.toFixed(2)),
                  riskRewardRatioTP2: parseFloat(rrTP2.grossRR.toFixed(2)),
                  ...(rrTP3?.isValid ? { riskRewardRatioTP3: parseFloat(rrTP3.grossRR.toFixed(2)) } : {}),
                  netRiskRewardRatioTP1: parseFloat(rrTP1.netRR.toFixed(2)),
                  netRiskRewardRatioTP2: parseFloat(rrTP2.netRR.toFixed(2)),
                  ...(rrTP3?.isValid ? { netRiskRewardRatioTP3: parseFloat(rrTP3.netRR.toFixed(2)) } : {}),
                  grossGainPercentTP1: parseFloat(rrTP1.grossGainPct.toFixed(2)),
                  netGainPercentTP1: parseFloat(rrTP1.netGainPct.toFixed(2)),
                  grossGainPercentTP2: parseFloat(rrTP2.grossGainPct.toFixed(2)),
                  netGainPercentTP2: parseFloat(rrTP2.netGainPct.toFixed(2)),
                  ...(rrTP3?.isValid ? { grossGainPercentTP3: parseFloat(rrTP3.grossGainPct.toFixed(2)) } : {}),
                  ...(rrTP3?.isValid ? { netGainPercentTP3: parseFloat(rrTP3.netGainPct.toFixed(2)) } : {}),
                  riskPercent: parseFloat(rrTP1.riskPct.toFixed(2)),
                  tickSize: tick,
                  suggestedRiskPercent: v.setup.suggestedRiskPercent || 1.0,
                  keyConfluences: v.setup.keyConfluences || localResult.setup?.keyConfluences || [],
                  mainRisks: v.setup.mainRisks || localResult.setup?.mainRisks || [],
                  dataTimestamp: Date.now(),
                };
              }
            }
          }

          // Harmonize AI output with programmatic safety checks
          const harmonized: EvaluationResult = {
            outcome: aiOutcome,
            setup: validatedAiSetup,
            qualityScore: {
              total: aiOutcome === 'NO_TRADE' ? Math.min(v.qualityScore || 45, 55) : (v.qualityScore || localResult.qualityScore.total),
              ratingLabel: aiOutcome === 'NO_TRADE' ? 'INSUFFISANT' : ((v.qualityScore || localResult.qualityScore.total) >= 80 ? 'EXCELLENT' : 'BON'),
              breakdown: v.scoreBreakdown || localResult.qualityScore.breakdown,
              explanation: 'Audit assisté par Gemini harmonisé avec les règles SMC strictes.',
            },
            checklist: v.verificationChecklist || localResult.checklist,
            noTradeReasons: [...(v.noTradeReasons || localResult.noTradeReasons), ...extraReasons],
            executiveSummary: aiOutcome === 'NO_TRADE' && extraReasons.length > 0
              ? `AUCUN TRADE RECOMMANDÉ (NO TRADE). Invalidation mathématique : ${extraReasons[0]}`
              : (v.executiveSummary || localResult.executiveSummary),
          };

          setEvaluation(harmonized);
          return;
        }
      }
    } catch (aiErr) {
      console.warn('AI Verification notice:', aiErr);
    } finally {
      setIsAiVerifying(false);
    }
  }, [symbol, market, ticker, snapshots, visionAnalysis, isAiVerifying]);

  // Alias for manual re-evaluation button
  const runVerification = useCallback(() => {
    setIsVerifying(true);
    runLocalEvaluation();
    setTimeout(() => setIsVerifying(false), 200);
  }, [runLocalEvaluation]);

  // Auto-run local evaluation whenever new ticker and snapshots arrive (NO external API calls)
  useEffect(() => {
    if (ticker && ticker.price > 0 && snapshots['1h']) {
      runLocalEvaluation();
    }
  }, [ticker?.price, snapshots['1h']?.trend, snapshots['4h']?.trend, runLocalEvaluation]);

  // Reset AI state when switching active symbol or market
  useEffect(() => {
    setIsAiAudited(false);
    setAiRateLimited(false);
  }, [symbol, market]);

  // Handle Search Submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean) {
      setSymbol(clean.endsWith('USDT') ? clean : `${clean}USDT`);
    }
  };

  const handleSelectPopular = (pair: string) => {
    setSymbol(pair);
    setSearchInput(pair);
  };

  // Transfer setup to Risk Calculator
  const handleApplyToCalculator = (setup: TradeSetup) => {
    setCalculatorSetup(setup);
    setActiveTab('calculator');
  };

  // Transfer setup to Paper Trading
  const handleOpenPaperTrade = (setup: TradeSetup) => {
    const res = openPaperManualTrade(setup);
    setActiveTab('paper');
  };

  // Continuous real-time price updates into Paper Trading engine
  useEffect(() => {
    if (ticker && ticker.price > 0) {
      processPaperPriceUpdate(
        ticker.symbol,
        ticker.market,
        ticker.price,
        Boolean(isStale || stalenessSeconds >= 25)
      );
    }
  }, [ticker?.symbol, ticker?.market, ticker?.price, isStale, stalenessSeconds, processPaperPriceUpdate]);

  // Auto-ingest signals if Paper Trading auto-monitoring is active
  useEffect(() => {
    if (
      paperConfig.isAutoTradingActive &&
      !paperConfig.isPaused &&
      evaluation &&
      evaluation.outcome !== 'NO_TRADE' &&
      evaluation.setup &&
      evaluation.qualityScore.total >= 65
    ) {
      autoIngestPaperSignal(evaluation.setup, evaluation.qualityScore.total);
    }
  }, [evaluation, paperConfig.isAutoTradingActive, paperConfig.isPaused, autoIngestPaperSignal]);

  // Polling for other open positions that are not the currently selected active symbol
  useEffect(() => {
    if (paperOpenPositions.length === 0) return;
    const interval = setInterval(async () => {
      for (const pos of paperOpenPositions) {
        if (pos.symbol === symbol && pos.market === market) continue;
        try {
          const endpoint = pos.market === 'futures'
            ? `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${pos.symbol}`
            : `https://api.binance.com/api/v3/ticker/price?symbol=${pos.symbol}`;
          const res = await fetch(endpoint);
          if (res.ok) {
            const data = await res.json();
            const p = parseFloat(data.price);
            if (p > 0) {
              processPaperPriceUpdate(pos.symbol, pos.market, p, false);
            }
          }
        } catch {
          // Ignore network glitch
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [paperOpenPositions, symbol, market, processPaperPriceUpdate]);

  // Save Setup to History
  const handleSaveToHistory = () => {
    if (!evaluation || !ticker) return;

    const newEntry: SavedAnalysis = {
      id: `analysis-${Date.now()}`,
      symbol,
      market,
      timestamp: Date.now(),
      verdict: evaluation.outcome,
      entryPrice: evaluation.setup?.entryPrice || ticker.price,
      stopLoss: evaluation.setup?.stopLoss || 0,
      tp1: evaluation.setup?.takeProfit1 || 0,
      tp2: evaluation.setup?.takeProfit2 || 0,
      qualityScore: evaluation.qualityScore.total,
      summary: evaluation.executiveSummary,
    };

    const updated = [newEntry, ...history.slice(0, 49)];
    setHistory(updated);
    try {
      localStorage.setItem('crypto_edge_history', JSON.stringify(updated));
    } catch {
      // Ignored
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem('crypto_edge_history');
    } catch {
      // Ignored
    }
  };

  const handleSelectSaved = (item: SavedAnalysis) => {
    setSymbol(item.symbol);
    setMarket(item.market);
    setActiveTab('dashboard');
  };

  const handleSelectFromScanner = useCallback((selectedSymbol: string, targetMarket: MarketType) => {
    setMarket(targetMarket);
    setSymbol(selectedSymbol);
    setSearchInput(selectedSymbol);
    setActiveTab('dashboard');
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Risk Alert Top Ticker */}
      <div className="bg-amber-950/70 border-b border-amber-900/60 px-4 py-1.5 text-xs text-amber-200/90 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 truncate">
          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-semibold text-amber-300">Avertissement de Risque :</span>
          <span className="truncate">
            Le trading comporte un risque substantiel de perte en capital. Crypto Edge AI priorise la préservation du capital et rejette les trades sans confluence.
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-amber-300/80 shrink-0">
          <Clock className="w-3 h-3" />
          {new Date().toLocaleDateString('fr-FR')} • Marché Crypto 24/7
        </div>
      </div>

      {/* Main Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Logo & Platform Info */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  Crypto Edge AI
                </h1>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  v3.8 PRO
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Analyse Pré-Trade & Confluence Smart Money Concept (SMC)
              </p>
            </div>
          </div>

          {/* Search & Exchange Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={handleSearch} className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-3 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                placeholder="Ex: BTCUSDT..."
                className="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 font-mono focus:border-blue-500 focus:outline-hidden w-36 sm:w-44"
              />
            </form>

            {/* Exchange Market Type Selector */}
            <div className="flex items-center bg-slate-950 rounded-lg border border-slate-800 p-0.5 text-xs">
              <button
                onClick={() => setMarket('spot')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  market === 'spot'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Binance Spot
              </button>
              <button
                onClick={() => setMarket('futures')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  market === 'futures'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Binance Futures
              </button>
            </div>

            <button
              onClick={() => {
                refreshNow();
                fetchKlines();
                fetchAllTimeframes();
              }}
              disabled={isLoadingTicker}
              title="Rafraîchir les flux"
              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingTicker ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quick Select Symbols Bar */}
        <div className="bg-slate-950/60 border-t border-slate-800/80 px-4 sm:px-6 py-1.5 overflow-x-auto flex items-center gap-2 text-xs">
          <span className="text-[11px] text-slate-500 font-medium shrink-0">Actifs majeurs :</span>
          <div className="flex items-center gap-1.5">
            {POPULAR_PAIRS.map((p) => (
              <button
                key={p}
                onClick={() => handleSelectPopular(p)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors shrink-0 cursor-pointer ${
                  symbol === p
                    ? 'bg-blue-950 border border-blue-600 text-blue-300 font-semibold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {p.replace('USDT', '')}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Live Market Ticker Strip */}
      <section className="bg-slate-900/90 border-b border-slate-800 px-4 sm:px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col gap-2">
          {/* Mismatch Market Notification / Error Banner */}
          {marketError && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 bg-amber-950/70 border border-amber-800/80 rounded-xl text-amber-200 text-xs shadow-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{marketError}</span>
              </div>
              {alternativeMarket && (
                <button
                  onClick={() => setMarket(alternativeMarket)}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs shadow-md shadow-amber-950/40 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <span>Passer sur {alternativeMarket === 'futures' ? 'Binance Futures' : 'Binance Spot'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-6 text-xs">
            <div className="flex items-center flex-wrap gap-3">
              <span className="font-mono font-bold text-base text-slate-100 flex items-center gap-1.5">
                {symbol}
                <span className="text-[10px] font-sans font-normal uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  {market === 'futures' ? 'Perpétuel USDⓈ-M' : 'Marché Spot'}
                </span>
              </span>

              {/* Live Connection and Freshness Badge */}
              <div className="flex items-center gap-2">
                {/* 1. Stale alert badge: strictly when truly stale (>= 25s) */}
                {(isStale || stalenessSeconds >= 25) && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-950/80 border border-rose-700/60 text-rose-300 text-[11px] font-mono">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>COTATIONS FIGÉES ({stalenessSeconds}s)</span>
                    <button
                      onClick={refreshNow}
                      className="underline hover:text-white ml-1 cursor-pointer font-sans"
                    >
                      Actualiser
                    </button>
                  </div>
                )}

                {/* 2. Reconnecting badge */}
                {connectionStatus === 'RECONNECTING' && !isStale && stalenessSeconds < 25 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-amber-400 text-[11px] font-mono">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>RECONNEXION...</span>
                  </div>
                )}

                {/* 3. Live streaming badge */}
                {connectionStatus === 'CONNECTED' && !isStale && stalenessSeconds < 25 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 text-[11px] font-mono">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>EN DIRECT {stalenessSeconds > 1 ? `(${stalenessSeconds}s)` : ''}</span>
                  </div>
                )}
              </div>

              {ticker && ticker.price > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono font-bold text-slate-100">
                    {formatCryptoPrice(ticker.price, ticker.tickSize)} USDT
                  </span>
                  <span
                    className={`flex items-center gap-0.5 font-mono font-semibold px-2 py-0.5 rounded ${
                      ticker.change24h >= 0
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                        : 'bg-rose-950/80 text-rose-400 border border-rose-800'
                    }`}
                  >
                    {ticker.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {ticker.change24h >= 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>

            {ticker && ticker.price > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-400 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500">Haut 24h : </span>
                  <span className="text-slate-200">{formatCryptoPrice(ticker.high24h, ticker.tickSize)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Bas 24h : </span>
                  <span className="text-slate-200">{formatCryptoPrice(ticker.low24h, ticker.tickSize)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Vol 24h : </span>
                  <span className="text-slate-200">
                    {ticker.volume24h.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {symbol.replace('USDT', '')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Radio className="w-3 h-3 text-blue-400 animate-pulse" />
                  <span>{ticker.source}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Tabs Navigation */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <nav className="flex space-x-1 sm:space-x-3 text-xs font-medium">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === 'dashboard'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Tableau de Bord & Setup</span>
            </button>

            <button
              onClick={() => setActiveTab('scanner')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'scanner'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radar className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span>Scanner IA</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                PRO
              </span>
            </button>

            <button
              onClick={() => setActiveTab('paper')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'paper'
                  ? 'border-emerald-500 text-emerald-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>Paper Trading</span>
              {paperOpenPositions.length > 0 ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                  {paperOpenPositions.length}
                </span>
              ) : paperConfig.isAutoTradingActive ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Surveillance active" />
              ) : null}
            </button>

            <button
              onClick={() => setActiveTab('news')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'news'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Newspaper className="w-4 h-4 text-amber-400" />
              <span>News Intelligence</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                DARIJA
              </span>
            </button>

            <button
              onClick={() => setActiveTab('vision')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === 'vision'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>Vision Graphique IA</span>
              {visionAnalysis && (
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('calculator')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === 'calculator'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calculator className="w-4 h-4" />
              <span>Calculateur de Risque</span>
            </button>

            <button
              onClick={() => setActiveTab('backtest')}
              className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === 'backtest'
                  ? 'border-blue-500 text-blue-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Backtest & Validation</span>
            </button>
          </nav>

          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
          >
            <History className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Historique</span>
            <span className="font-mono font-semibold px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
              {history.length}
            </span>
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6 w-full">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Top: Chart & Action Bar */}
            <div className="space-y-4">
              <TradingChart
                candles={candles}
                symbol={symbol}
                timeframe={activeTimeframe}
                onTimeframeChange={(tf) => {
                  setActiveTimeframe(tf);
                  fetchKlines(tf);
                }}
                setup={evaluation?.setup}
                isLoading={isLoadingCandles}
                onRefresh={() => fetchKlines(activeTimeframe)}
              />

              {/* Multi-Timeframe Snapshots Cards */}
              <MultiTimeframePanel
                snapshots={snapshots}
                activeTimeframe={activeTimeframe}
                onSelectTimeframe={(tf) => {
                  setActiveTimeframe(tf);
                  fetchKlines(tf);
                }}
              />
            </div>

            {/* AI Verification & Trade Setup Result Section */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Délibération & Filtrage de Trade (Processus en 10 Points)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Chaque trade est soumis à une checklist rigoureuse. En cas de doute ou de risque asymétrique défavorable, le verdict est NO TRADE.
                  </p>
                </div>

                <button
                  onClick={runVerification}
                  disabled={isVerifying}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                  {isVerifying ? 'Vérification en cours...' : 'Réévaluer le Marché'}
                </button>
              </div>

              {evaluation ? (
                <TradeSetupCard
                  outcome={evaluation.outcome}
                  setup={evaluation.setup}
                  qualityScore={evaluation.qualityScore}
                  checklist={evaluation.checklist}
                  noTradeReasons={evaluation.noTradeReasons}
                  executiveSummary={evaluation.executiveSummary}
                  onApplyToCalculator={handleApplyToCalculator}
                  onOpenPaperTrade={handleOpenPaperTrade}
                  onSaveToHistory={handleSaveToHistory}
                  onRunAiAudit={runAiDeepAnalysis}
                  isAiVerifying={isAiVerifying}
                  aiRateLimited={aiRateLimited}
                  isAiAudited={isAiAudited}
                />
              ) : (
                <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-400 mx-auto" />
                  <p className="text-xs text-slate-300 font-medium">
                    Calcul et audit des conditions de marché en cours pour {symbol}...
                  </p>
                </div>
              )}

              {/* Live News Sentiment & Moroccan Darija Confluence Widget */}
              <NewsSentimentWidget
                symbol={symbol}
                market={market}
                technicalVerdict={evaluation?.outcome || 'NO_TRADE'}
                technicalScore={evaluation?.qualityScore.total || 0}
                setup={evaluation?.setup}
                onOpenNewsTab={() => setActiveTab('news')}
              />
            </div>
          </div>
        )}

        {/* Tab: Intelligent Market Scanner */}
        {activeTab === 'scanner' && (
          <div className="space-y-5">
            <MarketScanner
              currentMarket={market}
              onSelectPair={handleSelectFromScanner}
              onOpenPaperTrade={(s) => {
                const res = openPaperManualTrade(s);
                if (res.success) setActiveTab('paper');
              }}
            />
          </div>
        )}

        {/* Tab: Paper Trading Virtuel */}
        {activeTab === 'paper' && (
          <div className="space-y-5">
            <PaperTradingDashboard
              accountState={paperAccountState}
              stats={paperStats}
              openPositions={paperOpenPositions}
              closedTrades={paperClosedTrades}
              config={paperConfig}
              onUpdateConfig={updatePaperConfig}
              onCloseManualTrade={closePaperManualTrade}
              onResetAccount={resetPaperAccount}
              onClearClosedHistory={clearPaperClosedHistory}
              onSelectPair={(pSym, pMkt) => {
                setSymbol(pSym);
                setMarket(pMkt);
                setActiveTab('dashboard');
              }}
            />
          </div>
        )}

        {/* Tab: Crypto News Intelligence in Moroccan Darija */}
        {activeTab === 'news' && (
          <div className="space-y-5">
            <NewsIntelligence
              currentSymbol={symbol}
              currentMarket={market}
              currentPrice={ticker?.price || 0}
              technicalVerdict={evaluation?.outcome || 'NO_TRADE'}
              technicalScore={evaluation?.qualityScore.total || 0}
              setup={evaluation?.setup}
              onSelectPair={(newSymbol, newMarket) => {
                setSymbol(newSymbol);
                setMarket(newMarket);
              }}
              onNavigateToDashboard={() => setActiveTab('dashboard')}
            />
          </div>
        )}

        {/* Tab 2: Chart Image Vision Analysis */}
        {activeTab === 'vision' && (
          <div className="space-y-5">
            <ChartVisionUploader
              currentSymbol={symbol}
              activeVisionResult={visionAnalysis}
              onAnalysisComplete={(result) => {
                setVisionAnalysis(result);
                // Trigger setup re-evaluation with vision findings
                runVerification();
              }}
            />
          </div>
        )}

        {/* Tab 3: Risk Calculator */}
        {activeTab === 'calculator' && (
          <div className="space-y-5">
            <RiskCalculator
              initialSetup={calculatorSetup || evaluation?.setup}
              currentPrice={ticker?.price || 65000}
              symbol={symbol}
            />
          </div>
        )}

        {/* Tab 4: Backtesting & Validation */}
        {activeTab === 'backtest' && (
          <div className="space-y-5">
            <BacktestModule
              candles={candles}
              symbol={symbol}
            />
          </div>
        )}
      </main>

      {/* Analysis History Modal */}
      <AnalysisHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onSelectSaved={handleSelectSaved}
        onClearHistory={handleClearHistory}
      />

      {/* Footer & Comprehensive Risk Disclaimer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-6 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-300">Crypto Edge AI</span>
              <span>— Outil d’Aide à la Décision et d’Analyse Technique</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
              <span>Modèle IA : Gemini 3.8 Flash</span>
              <span>•</span>
              <span>Méthodologie : Price Action / Smart Money Concept (SMC)</span>
            </div>
          </div>

          <div className="text-[11px] leading-relaxed text-slate-400 space-y-2">
            <p>
              <strong className="text-slate-300">MENTION LÉGALE & AVERTISSEMENT SUR LES RISQUES :</strong> Le trading de cryptomonnaies, de contrats à terme (Futures) et d’actifs dérivés comporte un risque de perte financière substantiel pouvant excéder les capitaux investis. Crypto Edge AI est exclusivement conçu comme un système d’analyse technique et statistique et ne constitue en aucune manière un conseil financier, un conseil d’investissement ou une incitation à négocier des instruments financiers.
            </p>
            <p>
              Crypto Edge AI ne garantit aucun profit ni aucune issue favorable sur les marchés. L’utilisateur demeure seul et unique responsable de ses décisions d'allocation de capital et de ses exécutions d'ordres.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
