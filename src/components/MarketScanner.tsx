import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MarketType, Timeframe, ScannedOpportunity } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import {
  Radar,
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  Filter,
  SlidersHorizontal,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  Layers,
  Sparkles,
  Info,
  DollarSign,
  Activity,
  Flame,
  Eye,
  Sliders,
  CheckSquare,
  BarChart2,
  Percent,
  Check,
  AlertTriangle,
  Wallet,
} from 'lucide-react';
import { TradeSetup } from '../types/crypto';

interface MarketScannerProps {
  currentMarket: MarketType;
  onSelectPair: (symbol: string, market: MarketType) => void;
  onOpenPaperTrade?: (setup: TradeSetup, score?: number) => void;
}

type CategoryTab = 'best_long' | 'best_short' | 'watchlist' | 'all';

export const MarketScanner: React.FC<MarketScannerProps> = ({
  currentMarket,
  onSelectPair,
  onOpenPaperTrade,
}) => {
  // Scanner configuration state
  const [selectedMarket, setSelectedMarket] = useState<MarketType>(currentMarket);
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [minVolumeUsd, setMinVolumeUsd] = useState<number>(selectedMarket === 'futures' ? 10000000 : 2000000);
  const [minScore, setMinScore] = useState<number>(65);
  const [minNetRR, setMinNetRR] = useState<number>(1.2);
  const [candidateLimit, setCandidateLimit] = useState<number>(25);
  const [sortBy, setSortBy] = useState<'score' | 'netRR' | 'volume' | 'change'>('score');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('best_long');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Scanning execution state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentSymbol: string }>({
    current: 0,
    total: 0,
    currentSymbol: '',
  });
  const [results, setResults] = useState<ScannedOpportunity[]>([]);
  const [scanTimestamp, setScanTimestamp] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshingSymbols, setRefreshingSymbols] = useState<Set<string>>(new Set());

  // Abort controller ref for stopping scans mid-flight
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync selectedMarket when prop changes initially
  useEffect(() => {
    setSelectedMarket(currentMarket);
  }, [currentMarket]);

  // Adjust default volume threshold when market toggles
  const handleMarketChange = (newMarket: MarketType) => {
    setSelectedMarket(newMarket);
    setMinVolumeUsd(newMarket === 'futures' ? 10000000 : 2000000);
  };

  // Launch market scan
  const startScan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setErrorMessage(null);
    setResults([]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Step 1: Fetch top liquid tradable tickers from Binance
      const tickerRes = await fetch(
        `/api/market/scanner-tickers?market=${selectedMarket}&minVolume=${minVolumeUsd}&limit=${candidateLimit}`,
        { signal: abortController.signal }
      );

      if (!tickerRes.ok) {
        throw new Error('Impossible de récupérer la liste des cryptomonnaies négociables sur Binance.');
      }

      const tickerData = await tickerRes.json();
      const candidates: any[] = tickerData.tickers || [];

      if (candidates.length === 0) {
        setErrorMessage(
          `Aucune paire ${selectedMarket === 'futures' ? 'Binance Futures' : 'Binance Spot'} ne répond au seuil de volume minimum de ${(minVolumeUsd / 1000000).toFixed(0)}M USDT.`
        );
        setIsScanning(false);
        return;
      }

      setProgress({ current: 0, total: candidates.length, currentSymbol: candidates[0]?.symbol || '' });

      const evaluatedResults: ScannedOpportunity[] = [];

      // Step 2: Concurrently evaluate candidate pairs in small controlled batches (2-3 concurrent requests)
      // This respects Binance rate limits while finishing the full scan in 4-8 seconds
      const BATCH_SIZE = 3;
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        if (abortController.signal.aborted) break;

        const batch = candidates.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (cand) => {
          try {
            setProgress((prev) => ({
              ...prev,
              current: Math.min(i + 1, candidates.length),
              currentSymbol: cand.symbol,
            }));

            const analysisRes = await fetch(
              `/api/market/scanner-analyze-pair?symbol=${cand.symbol}&market=${selectedMarket}`,
              { signal: abortController.signal }
            );

            if (analysisRes.ok) {
              const resData: ScannedOpportunity = await analysisRes.json();
              return resData;
            }
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              console.warn(`[Scanner] Erreur analyse ${cand.symbol}:`, err?.message);
            }
          }
          return null;
        });

        const batchOutputs = await Promise.all(batchPromises);
        for (const out of batchOutputs) {
          if (out) {
            evaluatedResults.push(out);
            // Incrementally update UI so user sees live streaming results
            setResults([...evaluatedResults]);
          }
        }

        setProgress((prev) => ({
          ...prev,
          current: Math.min(i + batch.length, candidates.length),
        }));
      }

      setScanTimestamp(Date.now());
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err?.message || 'Erreur lors du scan du marché.');
      }
    } finally {
      setIsScanning(false);
      abortControllerRef.current = null;
    }
  }, [selectedMarket, minVolumeUsd, candidateLimit, isScanning]);

  const stopScan = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsScanning(false);
  };

  // Refresh single candidate pair individually without restarting full scan
  const refreshSinglePair = async (symbol: string, market: MarketType) => {
    if (refreshingSymbols.has(symbol)) return;

    setRefreshingSymbols((prev) => new Set(prev).add(symbol));
    try {
      const res = await fetch(`/api/market/scanner-analyze-pair?symbol=${symbol}&market=${market}`);
      if (res.ok) {
        const updatedPair: ScannedOpportunity = await res.json();
        setResults((prev) => prev.map((item) => (item.symbol === symbol ? updatedPair : item)));
      }
    } catch (err) {
      console.warn(`[Scanner Refresh] Erreur sur ${symbol}:`, err);
    } finally {
      setRefreshingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }
  };

  // Categorize opportunities according to explicit thresholds
  const categorizedOpportunities = useMemo(() => {
    const bestLong: ScannedOpportunity[] = [];
    const bestShort: ScannedOpportunity[] = [];
    const watchlist: ScannedOpportunity[] = [];
    const rejected: ScannedOpportunity[] = [];

    for (const item of results) {
      const isLong = item.outcome === 'LONG';
      const isShort = item.outcome === 'SHORT';
      const scorePasses = item.qualityScore.total >= minScore;
      const netRR = item.setup?.netRiskRewardRatioTP1 || 0;
      const netRRPasses = netRR >= minNetRR;

      if (isLong && scorePasses && netRRPasses) {
        bestLong.push({ ...item, category: 'BEST_LONG' });
      } else if (isShort && scorePasses && netRRPasses) {
        bestShort.push({ ...item, category: 'BEST_SHORT' });
      } else if (
        item.qualityScore.total >= 45 ||
        (item.setup && netRR >= 1.0) ||
        item.checklist?.some((c) => c.id === 'check-4' && (c.status === 'PASSED' || c.status === 'WARNING'))
      ) {
        watchlist.push({ ...item, category: 'WATCHLIST' });
      } else {
        rejected.push({ ...item, category: 'REJECTED' });
      }
    }

    return { bestLong, bestShort, watchlist, rejected, all: results };
  }, [results, minScore, minNetRR]);

  // Filter and sort items based on current active tab and sorting preference
  const displayedResults = useMemo(() => {
    let list: ScannedOpportunity[] = [];

    if (categoryTab === 'best_long') {
      list = [...categorizedOpportunities.bestLong];
    } else if (categoryTab === 'best_short') {
      list = [...categorizedOpportunities.bestShort];
    } else if (categoryTab === 'watchlist') {
      list = [...categorizedOpportunities.watchlist];
    } else {
      list = [...results];
    }

    // Secondary direction filter in toolbar
    if (directionFilter === 'LONG') {
      list = list.filter((r) => r.outcome === 'LONG');
    } else if (directionFilter === 'SHORT') {
      list = list.filter((r) => r.outcome === 'SHORT');
    }

    // Search filter
    if (searchFilter.trim()) {
      const q = searchFilter.toUpperCase().trim();
      list = list.filter((r) => r.symbol.includes(q));
    }

    // Deterministic sorting
    list.sort((a, b) => {
      if (sortBy === 'score') {
        return b.qualityScore.total - a.qualityScore.total;
      }
      if (sortBy === 'netRR') {
        const netRRa = a.setup?.netRiskRewardRatioTP1 || 0;
        const netRRb = b.setup?.netRiskRewardRatioTP1 || 0;
        return netRRb - netRRa;
      }
      if (sortBy === 'volume') {
        return b.quoteVolume24h - a.quoteVolume24h;
      }
      if (sortBy === 'change') {
        return Math.abs(b.change24h) - Math.abs(a.change24h);
      }
      return 0;
    });

    return list;
  }, [categorizedOpportunities, categoryTab, directionFilter, searchFilter, sortBy, results]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Scanner Description */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-56 h-56 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
              <Radar className={`w-6 h-6 ${isScanning ? 'animate-spin text-blue-400' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-100">
                  Scanner Intelligent du Marché Crypto
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-900/60 border border-blue-700/60 text-blue-300">
                  AUDIT SMC & MTF EN DIRECT
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-950 border border-slate-800">
                  Binance API Publique
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
                Explore automatiquement les cryptomonnaies négociables sur Binance, analyse la structure institutionnelle (Order Blocks, FVG, Balayages de liquidité, BOS/CHoCH) et filtre les configurations selon la confluence 4H, 1H, 15M et 5M avec calcul complet des TP1, TP2, TP3 et ratios R/R nets après friction.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isScanning ? (
              <button
                onClick={stopScan}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-rose-950/40 transition-all cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Arrêter le scan</span>
              </button>
            ) : (
              <button
                onClick={startScan}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-blue-950/40 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Lancer le scan</span>
              </button>
            )}
          </div>
        </div>

        {/* Configuration Filters Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 mt-4 border-t border-slate-800/80 text-xs">
          {/* 1. Market Selection */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Marché Binance
            </label>
            <div className="flex bg-slate-950 rounded-lg border border-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => handleMarketChange('futures')}
                disabled={isScanning}
                className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer text-xs ${
                  selectedMarket === 'futures'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Futures
              </button>
              <button
                type="button"
                onClick={() => handleMarketChange('spot')}
                disabled={isScanning}
                className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer text-xs ${
                  selectedMarket === 'spot'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Spot
              </button>
            </div>
          </div>

          {/* 2. Direction Filter */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Direction
            </label>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as any)}
              disabled={isScanning}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value="ALL">LONG & SHORT (Tous)</option>
              <option value="LONG">LONG uniquement</option>
              <option value="SHORT">SHORT uniquement</option>
            </select>
          </div>

          {/* 3. Minimum Volume */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Volume 24h Minimal
            </label>
            <select
              value={minVolumeUsd}
              onChange={(e) => setMinVolumeUsd(parseInt(e.target.value, 10))}
              disabled={isScanning}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value={1000000}>1M+ USDT</option>
              <option value={5000000}>5M+ USDT</option>
              <option value={10000000}>10M+ USDT</option>
              <option value={50000000}>50M+ USDT</option>
            </select>
          </div>

          {/* 4. Score Minimum */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Score Min (/100)
            </label>
            <select
              value={minScore}
              onChange={(e) => setMinScore(parseInt(e.target.value, 10))}
              disabled={isScanning}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value={60}>≥ 60 (Modéré)</option>
              <option value={65}>≥ 65 (Standard PRO)</option>
              <option value={70}>≥ 70 (Exigeant)</option>
              <option value={75}>≥ 75 (Haute Confiance)</option>
              <option value={80}>≥ 80 (Élite SMC)</option>
            </select>
          </div>

          {/* 5. Net R/R Minimum */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              R/R Net Min
            </label>
            <select
              value={minNetRR}
              onChange={(e) => setMinNetRR(parseFloat(e.target.value))}
              disabled={isScanning}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value={1.2}>≥ 1.2:1 (Tolérant)</option>
              <option value={1.5}>≥ 1.5:1 (Standard)</option>
              <option value={1.8}>≥ 1.8:1 (Optimal)</option>
              <option value={2.0}>≥ 2.0:1 (Asymétrique)</option>
            </select>
          </div>

          {/* 6. Scan Limit & Sorting */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Étendue & Tri
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={candidateLimit}
                onChange={(e) => setCandidateLimit(parseInt(e.target.value, 10))}
                disabled={isScanning}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium text-[11px]"
              >
                <option value={15}>Top 15</option>
                <option value={25}>Top 25</option>
                <option value={40}>Top 40</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium text-[11px]"
              >
                <option value="score">Score</option>
                <option value="netRR">R/R Net</option>
                <option value="volume">Volume</option>
                <option value="change">Volatilité</option>
              </select>
            </div>
          </div>
        </div>

        {/* Live Progress Bar when scanning */}
        {isScanning && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-400 font-mono font-medium flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Analyse de {progress.currentSymbol} en cours ({progress.current} / {progress.total} paires)...
              </span>
              <span className="text-slate-300 font-mono font-semibold">
                {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500 transition-all duration-300 rounded-full"
                style={{
                  width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              ></div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-950/40 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Results Categories Segmented Bar */}
      {results.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 px-4 py-3 rounded-xl shadow-lg">
          {/* 3 Categories + All Tab */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {/* Category 1: Best LONG */}
            <button
              onClick={() => setCategoryTab('best_long')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                categoryTab === 'best_long'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/80 shadow-xs'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Opportunités LONG</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-emerald-700/60 text-emerald-300">
                {categorizedOpportunities.bestLong.length}
              </span>
            </button>

            {/* Category 2: Best SHORT */}
            <button
              onClick={() => setCategoryTab('best_short')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                categoryTab === 'best_short'
                  ? 'bg-rose-950 text-rose-300 border border-rose-700/80 shadow-xs'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Opportunités SHORT</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-rose-700/60 text-rose-300">
                {categorizedOpportunities.bestShort.length}
              </span>
            </button>

            {/* Category 3: Watchlist / Incomplete */}
            <button
              onClick={() => setCategoryTab('watchlist')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                categoryTab === 'watchlist'
                  ? 'bg-amber-950 text-amber-300 border border-amber-700/80 shadow-xs'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              <span>À Surveiller (Incomplètes)</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-amber-700/60 text-amber-300">
                {categorizedOpportunities.watchlist.length}
              </span>
            </button>

            {/* Category 4: All pairs & rejections */}
            <button
              onClick={() => setCategoryTab('all')}
              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                categoryTab === 'all'
                  ? 'bg-blue-950 text-blue-300 border border-blue-700/80 shadow-xs'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Toutes les Paires ({results.length})</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-slate-700 text-slate-400">
                {categorizedOpportunities.rejected.length} Rejetées
              </span>
            </button>
          </div>

          {/* Search by Symbol & Freshness */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrer par symbole..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 font-mono focus:border-blue-500 focus:outline-hidden w-40 sm:w-44"
              />
            </div>

            {scanTimestamp && (
              <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                <Clock className="w-3 h-3 text-blue-400" />
                <span>Mis à jour : {new Date(scanTimestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Results Container */}
      {results.length === 0 && !isScanning ? (
        /* Initial Empty State before first scan */
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mx-auto">
            <Radar className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-200">
              Aucun scan en cours
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Sélectionnez vos critères de marché ci-dessus puis cliquez sur « Lancer le scan » pour analyser en direct les {candidateLimit} paires les plus liquides de Binance avec filtrage institutionnel SMC / MTF.
            </p>
          </div>
          <button
            onClick={startScan}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-lg shadow-blue-950/40 transition-all cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Lancer le scan Binance</span>
          </button>
        </div>
      ) : displayedResults.length === 0 && !isScanning ? (
        /* Capital-Preservation Empty State: No opportunities match current tab / filters */
        <div className="bg-slate-900 border border-amber-900/60 rounded-xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
              {categoryTab === 'best_long'
                ? 'Aucune opportunité LONG ne satisfait les critères stricts'
                : categoryTab === 'best_short'
                ? 'Aucune opportunité SHORT ne satisfait les critères stricts'
                : categoryTab === 'watchlist'
                ? 'Aucune configuration incomplète à surveiller'
                : 'Aucune opportunité ne correspond à ces critères'}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Sur les <span className="font-mono font-bold text-slate-100">{results.length}</span> cryptomonnaies scannées, aucune ne réunit actuellement une confluence technique suffisante (Score &ge; {minScore}/100, R/R net réel après frais &ge; {minNetRR}:1 et structure SMC alignée).
            </p>
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-[11px] text-slate-400 text-left space-y-1">
              <span className="font-semibold text-slate-200 block">Règle d'Or de Préservation du Capital :</span>
              <p>
                Ne jamais forcer un trade dans un marché en consolidation ou sans avantage asymétrique net. Cliquez sur « À Surveiller » ou « Toutes les Paires » pour inspecter les motifs d'invalidation détaillés de chaque crypto.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setCategoryTab('watchlist')}
              className="px-4 py-2 rounded-lg bg-amber-950/60 border border-amber-700/60 text-amber-300 hover:text-white text-xs font-medium cursor-pointer"
            >
              Voir les configurations à surveiller ({categorizedOpportunities.watchlist.length})
            </button>
            <button
              onClick={() => setCategoryTab('all')}
              className="px-4 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium cursor-pointer"
            >
              Voir toutes les {results.length} paires analysées
            </button>
          </div>
        </div>
      ) : (
        /* Classified Opportunities Grid */
        <div className="space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>
              {displayedResults.length} configuration{displayedResults.length > 1 ? 's' : ''} dans la catégorie{' '}
              <strong className="text-slate-200">
                {categoryTab === 'best_long'
                  ? 'Opportunités LONG'
                  : categoryTab === 'best_short'
                  ? 'Opportunités SHORT'
                  : categoryTab === 'watchlist'
                  ? 'À Surveiller'
                  : 'Toutes les Paires'}
              </strong>
            </span>
            <span className="text-[11px] font-normal text-slate-500 hidden sm:inline">
              Trié par {sortBy === 'score' ? 'score technique' : sortBy === 'netRR' ? 'R/R net' : sortBy === 'volume' ? 'volume' : 'volatilité'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {displayedResults.map((item, index) => {
              const hasSetup = item.outcome !== 'NO_TRADE' && item.setup;
              const isLong = item.outcome === 'LONG';
              const isShort = item.outcome === 'SHORT';
              const isWatchlist = !hasSetup && item.qualityScore.total >= 45;
              const isRefreshing = refreshingSymbols.has(item.symbol);

              return (
                <div
                  key={`${item.market}-${item.symbol}`}
                  className={`bg-slate-900 border rounded-xl overflow-hidden shadow-xl transition-all hover:border-slate-700 ${
                    isLong && hasSetup
                      ? 'border-emerald-900/60'
                      : isShort && hasSetup
                      ? 'border-rose-900/60'
                      : isWatchlist
                      ? 'border-amber-900/50'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Card Header Bar */}
                  <div className="px-5 py-3.5 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Rank Number */}
                      <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-300 text-xs font-mono font-bold flex items-center justify-center shrink-0">
                        #{index + 1}
                      </span>

                      {/* Symbol & Market */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold font-mono text-slate-100">
                            {item.symbol}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-slate-900 border border-slate-700 text-slate-300">
                            {item.market === 'futures' ? 'FUTURES' : 'SPOT'}
                          </span>
                          {/* Timeframe Badges (4H, 1H, 15M, 5M) */}
                          <div className="hidden sm:flex items-center gap-1 ml-2">
                            {(['4h', '1h', '15m', '5m'] as Timeframe[]).map((tf) => {
                              const snap = item.snapshots?.[tf];
                              const trend = snap?.trend;
                              const isBull = trend === 'HAUSSIÈRE';
                              const isBear = trend === 'BAISSIÈRE';
                              return (
                                <span
                                  key={tf}
                                  title={`${tf.toUpperCase()}: ${trend || 'Neutre'}`}
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                                    isBull
                                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80'
                                      : isBear
                                      ? 'bg-rose-950/80 text-rose-400 border border-rose-800/80'
                                      : 'bg-slate-900 text-slate-500 border border-slate-800'
                                  }`}
                                >
                                  {tf.toUpperCase()}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                          <span>Vol 24h: {(item.quoteVolume24h / 1000000).toFixed(1)}M$</span>
                          <span>•</span>
                          <span>{formatCryptoPrice(item.currentPrice, item.tickSize)} USDT</span>
                          <span
                            className={
                              item.change24h >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'
                            }
                          >
                            ({item.change24h >= 0 ? '+' : ''}{item.change24h.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Verdict & Score Badges + Direct Action Buttons */}
                    <div className="flex items-center gap-2.5">
                      {/* Direction Badge */}
                      <span
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 ${
                          isLong && hasSetup
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : isShort && hasSetup
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : isWatchlist
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {isLong && hasSetup ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isShort && hasSetup ? (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                        ) : isWatchlist ? (
                          <Eye className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>
                          {isLong && hasSetup
                            ? 'CONFIG LONG'
                            : isShort && hasSetup
                            ? 'CONFIG SHORT'
                            : isWatchlist
                            ? 'À SURVEILLER'
                            : 'NO TRADE'}
                        </span>
                      </span>

                      {/* Score Badge */}
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                        <span className="text-[10px] text-slate-400 uppercase font-medium">Score</span>
                        <span
                          className={`font-mono font-bold text-sm ${
                            item.qualityScore.total >= 75
                              ? 'text-emerald-400'
                              : item.qualityScore.total >= 65
                              ? 'text-blue-400'
                              : item.qualityScore.total >= 50
                              ? 'text-amber-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.qualityScore.total}/100
                        </span>
                      </div>

                      {/* Individual Refresh Pair Button */}
                      <button
                        onClick={() => refreshSinglePair(item.symbol, item.market)}
                        disabled={isRefreshing}
                        title="Actualiser les cotations et l'analyse de cette paire en direct"
                        className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                      </button>

                      {/* Direct Paper Trading Button if setup exists */}
                      {hasSetup && item.setup && onOpenPaperTrade && (
                        <button
                          onClick={() => onOpenPaperTrade(item.setup!, item.qualityScore.total)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-emerald-950/50 transition-all cursor-pointer"
                          title="Ouvrir directement cette opportunité en Paper Trading simulé"
                        >
                          <Wallet className="w-3.5 h-3.5 text-emerald-300" />
                          <span>Simuler</span>
                        </button>
                      )}

                      {/* Select Pair Action Button */}
                      <button
                        onClick={() => onSelectPair(item.symbol, item.market)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-blue-950/50 transition-all cursor-pointer"
                        title="Ouvrir l'analyse détaillée et les graphiques de cette paire dans le Dashboard"
                      >
                        <span>Analyser cette crypto</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-4">
                    {hasSetup && item.setup ? (
                      /* Active Trade Levels Strip with Unit Risk & Gains */
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                          {/* Entry */}
                          <div className="p-2.5 bg-slate-950/80 border border-blue-900/40 rounded-lg">
                            <span className="text-[10px] text-blue-400 block font-semibold uppercase">Entrée Indicative</span>
                            <span className="font-mono font-bold text-slate-100 text-sm">
                              {formatCryptoPrice(item.setup.entryPrice, item.tickSize)}$
                            </span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
                              Zone: {item.setup.entryZone.split('-')[0].trim() || 'Actuel'}
                            </span>
                          </div>

                          {/* Stop Loss */}
                          <div className="p-2.5 bg-slate-950/80 border border-rose-900/40 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-rose-400 font-semibold uppercase">Stop Loss</span>
                              <span className="text-[9px] font-mono text-rose-400">
                                -{item.setup.riskPercent.toFixed(2)}%
                              </span>
                            </div>
                            <span className="font-mono font-bold text-rose-300 text-sm">
                              {formatCryptoPrice(item.setup.stopLoss, item.tickSize)}$
                            </span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
                              Risque: {formatCryptoPrice(item.setup.unitRisk ?? Math.abs(item.setup.entryPrice - item.setup.stopLoss), item.tickSize)}$ / unité
                            </span>
                          </div>

                          {/* TP1 */}
                          <div className="p-2.5 bg-slate-950/80 border border-emerald-900/40 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP1</span>
                              <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded font-bold">
                                Net {item.setup.netRiskRewardRatioTP1}:1
                              </span>
                            </div>
                            <span className="font-mono font-bold text-emerald-300 text-sm">
                              {formatCryptoPrice(item.setup.takeProfit1, item.tickSize)}$
                            </span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
                              Gain: +{item.setup.grossGainPercentTP1}% (+{formatCryptoPrice(item.setup.unitGainTP1 ?? Math.abs(item.setup.takeProfit1 - item.setup.entryPrice), item.tickSize)}$)
                            </span>
                          </div>

                          {/* TP2 */}
                          <div className="p-2.5 bg-slate-950/80 border border-emerald-900/30 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP2</span>
                              <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded font-bold">
                                Net {item.setup.netRiskRewardRatioTP2 ?? item.setup.riskRewardRatioTP2}:1
                              </span>
                            </div>
                            <span className="font-mono font-bold text-emerald-300 text-sm">
                              {formatCryptoPrice(item.setup.takeProfit2, item.tickSize)}$
                            </span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
                              Gain: +{item.setup.grossGainPercentTP2 ?? (item.setup.grossGainPercentTP1 * 1.6).toFixed(1)}% (+{formatCryptoPrice(item.setup.unitGainTP2 ?? Math.abs(item.setup.takeProfit2 - item.setup.entryPrice), item.tickSize)}$)
                            </span>
                          </div>

                          {/* TP3 */}
                          {item.setup.takeProfit3 !== undefined && (
                            <div className="p-2.5 bg-slate-950/80 border border-emerald-900/30 rounded-lg">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP3</span>
                                <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded font-bold">
                                  Net {item.setup.netRiskRewardRatioTP3 ?? (item.setup.riskRewardRatioTP3 ? (item.setup.riskRewardRatioTP3 * 0.96).toFixed(2) : 4.4)}:1
                                </span>
                              </div>
                              <span className="font-mono font-bold text-emerald-300 text-sm">
                                {formatCryptoPrice(item.setup.takeProfit3, item.tickSize)}$
                              </span>
                              <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
                                Gain: +{item.setup.grossGainPercentTP3 ?? (item.setup.grossGainPercentTP1 * 2.4).toFixed(1)}% (+{formatCryptoPrice(item.setup.unitGainTP3 ?? Math.abs(item.setup.takeProfit3 - item.setup.entryPrice), item.tickSize)}$)
                              </span>
                            </div>
                          )}

                          {/* Friction & Overall R/R Net Summary */}
                          <div className="p-2.5 bg-slate-950/80 border border-indigo-900/40 rounded-lg">
                            <span className="text-[10px] text-indigo-400 block font-semibold uppercase">Frais & Slippage</span>
                            <span className="font-mono font-bold text-slate-100 text-xs block mt-0.5">
                              Frais A/R : {item.setup.estimatedFeesPercent ?? (item.market === 'futures' ? 0.08 : 0.20)}%
                            </span>
                            <span className="text-[9px] text-slate-400 block font-mono">
                              Slippage : {item.setup.estimatedSlippagePercent ?? 0.05}%
                            </span>
                            <span className="text-[9px] text-indigo-300 font-semibold block mt-1">
                              R/R Brut: {item.setup.riskRewardRatioTP1}:1 | Net: {item.setup.netRiskRewardRatioTP1}:1
                            </span>
                          </div>
                        </div>

                        {/* Invalidation Condition Alert */}
                        <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between gap-3 text-xs">
                          <span className="text-slate-400 text-[11px]">
                            <strong className="text-slate-300">Condition d'invalidation : </strong>
                            {item.setup.invalidationCondition}
                          </span>
                          {item.setup.confirmedTimeframes && item.setup.confirmedTimeframes.length > 0 && (
                            <span className="text-[10px] text-emerald-400 font-mono shrink-0">
                              Timeframes confirmés : {item.setup.confirmedTimeframes.join(', ')}
                            </span>
                          )}
                        </div>

                        {/* Spot SHORT Margin Notice */}
                        {isShort && item.market === 'spot' && (
                          <div className="p-2.5 bg-amber-950/40 border border-amber-800/80 rounded-lg flex items-start gap-2.5 text-xs text-amber-200">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="text-amber-300">Spécificité Spot :</strong> Cette opportunité SHORT nécessite un compte Margin avec emprunt d'actifs ou un basculement vers Binance USDⓈ-M Futures (le compte Spot au comptant ordinaire ne permet pas la vente à découvert directe).
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Disqualification Reasons Banner when NO TRADE or Incomplete */
                      <div className="p-3 bg-amber-950/20 border border-amber-900/50 rounded-lg text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-300 flex items-center gap-1.5 uppercase text-[11px]">
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                            {isWatchlist ? 'Configuration en cours de formation (À Surveiller) :' : 'Motifs d\'invalidation (Capital préservé) :'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Dernier tick : il y a {item.stalenessSeconds || 0}s
                          </span>
                        </div>
                        <ul className="text-slate-300 space-y-0.5 list-disc list-inside">
                          {item.noTradeReasons.slice(0, 3).map((reason, rIdx) => (
                            <li key={rIdx} className="leading-snug">{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Confluences & Quality Breakdown Footer */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
                      {item.setup && item.setup.keyConfluences.length > 0 ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-slate-400 font-medium">Confluences :</span>
                          {item.setup.keyConfluences.slice(0, 3).map((conf, cIdx) => (
                            <span
                              key={cIdx}
                              className="px-2 py-0.5 rounded text-[10px] bg-slate-950 border border-slate-800 text-emerald-300 font-mono"
                            >
                              ✓ {conf.replace(/\.$/, '')}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">
                          {item.executiveSummary}
                        </div>
                      )}

                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => onSelectPair(item.symbol, item.market)}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                        >
                          <span>Voir les chandeliers & SMC</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Safety & Compliance Notice */}
      <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl flex items-start gap-3 text-xs text-slate-400 leading-relaxed shadow-lg">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-200">Avertissement de transparence pré-trade :</strong> Le scanner Crypto Edge AI classe les opportunités de marché à partir de données publiques Binance et d'un algorithme déterministe SMC / MTF. Les scores de qualité mesurent l'alignement technique et ne constituent en aucun cas une promesse ou garantie mathématique de gain. Aucun ordre automatique n'est exécuté.
        </div>
      </div>
    </div>
  );
};
