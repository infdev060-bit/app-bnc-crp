import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';

interface MarketScannerProps {
  currentMarket: MarketType;
  onSelectPair: (symbol: string, market: MarketType) => void;
}

export const MarketScanner: React.FC<MarketScannerProps> = ({
  currentMarket,
  onSelectPair,
}) => {
  // Scanner configuration state
  const [selectedMarket, setSelectedMarket] = useState<MarketType>(currentMarket);
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [minVolumeUsd, setMinVolumeUsd] = useState<number>(selectedMarket === 'futures' ? 10000000 : 2000000);
  const [candidateLimit, setCandidateLimit] = useState<number>(25);
  const [sortBy, setSortBy] = useState<'score' | 'netRR' | 'volume' | 'change'>('score');
  const [viewFilter, setViewFilter] = useState<'validated' | 'all'>('validated');
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

  // Filter and sort results
  const filteredAndSortedResults = React.useMemo(() => {
    let list = [...results];

    // Direction filter
    if (directionFilter === 'LONG') {
      list = list.filter((r) => r.outcome === 'LONG');
    } else if (directionFilter === 'SHORT') {
      list = list.filter((r) => r.outcome === 'SHORT');
    }

    // View filter: validated (score >= 65 and outcome !== NO_TRADE) vs all
    if (viewFilter === 'validated') {
      list = list.filter((r) => r.outcome !== 'NO_TRADE' && r.qualityScore.total >= 65);
    }

    // Search query filter
    if (searchFilter.trim()) {
      const q = searchFilter.toUpperCase().trim();
      list = list.filter((r) => r.symbol.includes(q));
    }

    // Sorting
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
  }, [results, directionFilter, viewFilter, searchFilter, sortBy]);

  const validatedCount = results.filter((r) => r.outcome !== 'NO_TRADE' && r.qualityScore.total >= 65).length;
  const noTradeCount = results.filter((r) => r.outcome === 'NO_TRADE' || r.qualityScore.total < 65).length;

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
                Explore automatiquement les cryptomonnaies les plus liquides sur Binance, analyse la structure institutionnelle (Order Blocks, FVG, Balayages de liquidité) et filtre les configurations selon la confluence 4H, 1H, 15M et 5M avec calcul complet des TP1, TP2, TP3 et ratios R/R nets après friction.
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
                <span>Scanner le marché</span>
              </button>
            )}
          </div>
        </div>

        {/* Configuration Filters Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4 mt-4 border-t border-slate-800/80 text-xs">
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
                className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
                  selectedMarket === 'futures'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                USDⓈ-M Futures
              </button>
              <button
                type="button"
                onClick={() => handleMarketChange('spot')}
                disabled={isScanning}
                className={`flex-1 py-1 rounded text-center font-medium transition-colors cursor-pointer ${
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
              Direction Recherchée
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
              <option value={1000000}>1M+ USDT (Large sélection)</option>
              <option value={5000000}>5M+ USDT (Liquidité saine)</option>
              <option value={10000000}>10M+ USDT (Haute liquidité)</option>
              <option value={50000000}>50M+ USDT (Mega caps uniquement)</option>
            </select>
          </div>

          {/* 4. Number of Pairs */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Étendue du Scan
            </label>
            <select
              value={candidateLimit}
              onChange={(e) => setCandidateLimit(parseInt(e.target.value, 10))}
              disabled={isScanning}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value={15}>Top 15 paires (Ultra rapide)</option>
              <option value={25}>Top 25 paires (Équilibré)</option>
              <option value={40}>Top 40 paires (Approfondi)</option>
            </select>
          </div>

          {/* 5. Sort By */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 text-[11px]">
              Trier les Opportunités
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:border-blue-500 focus:outline-hidden font-medium"
            >
              <option value="score">Score de Qualité (Décroissant)</option>
              <option value="netRR">Ratio R/R Net (Meilleur profil)</option>
              <option value="volume">Volume 24h (Plus liquide)</option>
              <option value="change">Volatilité 24h (% absolu)</option>
            </select>
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

      {/* Results Header Toolbar (Filter between Validated & All, search input, stats) */}
      {results.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 px-4 py-3 rounded-xl shadow-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewFilter('validated')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                viewFilter === 'validated'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/80'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Configurations Validées</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-current">
                {validatedCount}
              </span>
            </button>

            <button
              onClick={() => setViewFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
                viewFilter === 'all'
                  ? 'bg-blue-950 text-blue-300 border border-blue-700/80'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Toutes les Paires ({results.length})</span>
              <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-slate-900 border border-current">
                {noTradeCount} NO TRADE
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrer par symbole..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 font-mono focus:border-blue-500 focus:outline-hidden w-44"
              />
            </div>

            {scanTimestamp && (
              <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(scanTimestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
              Sélectionnez vos critères ci-dessus puis cliquez sur « Scanner le marché » pour analyser en direct les {candidateLimit} paires les plus liquides de Binance.
            </p>
          </div>
          <button
            onClick={startScan}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-lg shadow-blue-950/40 transition-all cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Lancer un premier scan</span>
          </button>
        </div>
      ) : filteredAndSortedResults.length === 0 ? (
        /* Rigorous Capital-Preservation Empty State: No opportunities match current filter */
        <div className="bg-slate-900 border border-amber-900/60 rounded-xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
              Aucune opportunité ne satisfait les critères d'exigence
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Sur les <span className="font-mono font-bold text-slate-100">{results.length}</span> cryptomonnaies scannées, aucune ne réunit actuellement une confluence technique suffisante (Score &ge; 65/100, structure SMC alignée, et ratio R/R net réel après frais &ge; 1,2:1).
            </p>
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg text-[11px] text-slate-400 text-left space-y-1">
              <span className="font-semibold text-slate-200 block">Règle Crypto Edge AI de Préservation du Capital :</span>
              <p>
                Ne jamais forcer un trade dans un marché en consolidation ou sans avantage asymétrique net. Cliquez sur « Toutes les Paires » ci-dessus pour inspecter les motifs d'invalidation détaillés de chaque crypto.
              </p>
            </div>
          </div>
          <button
            onClick={() => setViewFilter('all')}
            className="px-4 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium cursor-pointer"
          >
            Voir les {results.length} paires analysées et leurs motifs de rejet
          </button>
        </div>
      ) : (
        /* Classified Opportunities Grid */
        <div className="space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>
              {filteredAndSortedResults.length} configuration{filteredAndSortedResults.length > 1 ? 's' : ''} affichée{filteredAndSortedResults.length > 1 ? 's' : ''} (Triée{filteredAndSortedResults.length > 1 ? 's' : ''} par {sortBy === 'score' ? 'score technique' : sortBy === 'netRR' ? 'R/R net' : sortBy === 'volume' ? 'volume' : 'volatilité'})
            </span>
            <span className="text-[11px] font-normal text-slate-500">
              Cliquez sur « Analyser » pour basculer sur le graphique détaillé
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredAndSortedResults.map((item, index) => {
              const hasSetup = item.outcome !== 'NO_TRADE' && item.setup;
              const isLong = item.outcome === 'LONG';
              const isShort = item.outcome === 'SHORT';

              return (
                <div
                  key={`${item.market}-${item.symbol}`}
                  className={`bg-slate-900 border rounded-xl overflow-hidden shadow-xl transition-all hover:border-slate-700 ${
                    isLong
                      ? 'border-emerald-900/60'
                      : isShort
                      ? 'border-rose-900/60'
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

                    {/* Verdict & Score Badges + Direct Action Button */}
                    <div className="flex items-center gap-3">
                      {/* Direction Badge */}
                      <span
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 ${
                          isLong
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : isShort
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {isLong ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isShort ? (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>
                          {isLong ? 'CONFIG LONG' : isShort ? 'CONFIG SHORT' : 'NO TRADE'}
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
                              : 'text-amber-400'
                          }`}
                        >
                          {item.qualityScore.total}/100
                        </span>
                      </div>

                      {/* Select Pair Action Button */}
                      <button
                        onClick={() => onSelectPair(item.symbol, item.market)}
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-blue-950/50 transition-all cursor-pointer"
                        title="Ouvrir l'analyse détaillée et les graphiques de cette paire"
                      >
                        <span>Analyser cette crypto</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-4">
                    {hasSetup && item.setup ? (
                      /* Active Trade Levels Strip */
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                        {/* Entry */}
                        <div className="p-2.5 bg-slate-950/80 border border-blue-900/40 rounded-lg">
                          <span className="text-[10px] text-blue-400 block font-semibold uppercase">Entrée</span>
                          <span className="font-mono font-bold text-slate-100 text-sm">
                            {formatCryptoPrice(item.setup.entryPrice, item.tickSize)}$
                          </span>
                        </div>

                        {/* Stop Loss */}
                        <div className="p-2.5 bg-slate-950/80 border border-rose-900/40 rounded-lg">
                          <span className="text-[10px] text-rose-400 block font-semibold uppercase">
                            Stop Loss (-{item.setup.riskPercent.toFixed(2)}%)
                          </span>
                          <span className="font-mono font-bold text-rose-300 text-sm">
                            {formatCryptoPrice(item.setup.stopLoss, item.tickSize)}$
                          </span>
                        </div>

                        {/* TP1 */}
                        <div className="p-2.5 bg-slate-950/80 border border-emerald-900/40 rounded-lg">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP1</span>
                            <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded">
                              Net {item.setup.netRiskRewardRatioTP1}:1
                            </span>
                          </div>
                          <span className="font-mono font-bold text-emerald-300 text-sm">
                            {formatCryptoPrice(item.setup.takeProfit1, item.tickSize)}$
                          </span>
                        </div>

                        {/* TP2 */}
                        <div className="p-2.5 bg-slate-950/80 border border-emerald-900/30 rounded-lg">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP2</span>
                            <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded">
                              Net {item.setup.netRiskRewardRatioTP2 ?? item.setup.riskRewardRatioTP2}:1
                            </span>
                          </div>
                          <span className="font-mono font-bold text-emerald-300 text-sm">
                            {formatCryptoPrice(item.setup.takeProfit2, item.tickSize)}$
                          </span>
                        </div>

                        {/* TP3 */}
                        {item.setup.takeProfit3 !== undefined && (
                          <div className="p-2.5 bg-slate-950/80 border border-emerald-900/30 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-emerald-400 font-semibold uppercase">TP3</span>
                              <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950 px-1 rounded">
                                Net {item.setup.netRiskRewardRatioTP3 ?? (item.setup.riskRewardRatioTP3 ? item.setup.riskRewardRatioTP3 * 0.95 : 4.4)}:1
                              </span>
                            </div>
                            <span className="font-mono font-bold text-emerald-300 text-sm">
                              {formatCryptoPrice(item.setup.takeProfit3, item.tickSize)}$
                            </span>
                          </div>
                        )}

                        {/* Overall R/R Net Summary Pill */}
                        <div className="p-2.5 bg-slate-950/80 border border-indigo-900/40 rounded-lg">
                          <span className="text-[10px] text-indigo-400 block font-semibold uppercase">R/R Brut / Net</span>
                          <span className="font-mono font-bold text-slate-100 text-sm">
                            {item.setup.riskRewardRatioTP1}:1 / {item.setup.netRiskRewardRatioTP1}:1
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* Disqualification Reasons Banner when NO TRADE */
                      <div className="p-3 bg-amber-950/20 border border-amber-900/50 rounded-lg text-xs space-y-1">
                        <span className="font-semibold text-amber-300 flex items-center gap-1.5 uppercase text-[11px]">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                          Motifs d'invalidation (Capital préservé) :
                        </span>
                        <ul className="text-slate-300 space-y-0.5 list-disc list-inside">
                          {item.noTradeReasons.slice(0, 2).map((reason, rIdx) => (
                            <li key={rIdx} className="leading-snug">{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Confluences & Risks Chips */}
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

      {/* Safety Notice */}
      <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl flex items-start gap-3 text-xs text-slate-400 leading-relaxed shadow-lg">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <strong className="text-slate-200">Avertissement de transparence pré-trade :</strong> Le scanner Crypto Edge AI classe les opportunités de marché à partir de données publiques Binance et d'un algorithme déterministe SMC / MTF. Les scores de qualité mesurent l'alignement technique et ne constituent en aucun cas une promesse ou garantie mathématique de gain. Aucun ordre automatique n'est exécuté.
        </div>
      </div>
    </div>
  );
};
