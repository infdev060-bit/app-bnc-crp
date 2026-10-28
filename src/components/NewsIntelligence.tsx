import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CryptoNewsItem, NewsIntelligenceSummary, TradeSetup, MarketType } from '../types/crypto';
import { formatCryptoPrice } from '../utils/priceFormatter';
import { combineTechnicalAndNewsVerdict } from '../utils/newsAnalyzer';
import {
  Newspaper,
  Flame,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Sparkles,
  HelpCircle,
  Layers,
  ArrowRight,
  ShieldCheck,
  Radio,
} from 'lucide-react';

interface NewsIntelligenceProps {
  currentSymbol: string;
  currentMarket: MarketType;
  currentPrice: number;
  technicalVerdict: 'LONG' | 'SHORT' | 'NO_TRADE';
  technicalScore: number;
  setup?: TradeSetup;
  onSelectPair?: (symbol: string, market: MarketType) => void;
  onNavigateToDashboard?: () => void;
}

export const NewsIntelligence: React.FC<NewsIntelligenceProps> = ({
  currentSymbol,
  currentMarket,
  currentPrice,
  technicalVerdict,
  technicalScore,
  setup,
  onSelectPair,
  onNavigateToDashboard,
}) => {
  const [articles, setArticles] = useState<CryptoNewsItem[]>([]);
  const [summary, setSummary] = useState<NewsIntelligenceSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'BINANCE' | 'COINTELEGRAPH' | 'COINDESK'>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'NEUTRAL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set());
  const [aiDarijaSynthesis, setAiDarijaSynthesis] = useState<string | null>(null);
  const [isLoadingAiDarija, setIsLoadingAiDarija] = useState<boolean>(false);
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());

  const baseAsset = currentSymbol.replace('USDT', '');

  // Fetch real news from backend
  const fetchNews = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/news/crypto?symbol=${currentSymbol}`);
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles || []);
        setSummary(data.summary || null);
        setLastFetchTime(Date.now());
        // Auto-expand first 2 articles
        if (data.articles && data.articles.length > 0) {
          setExpandedArticles(new Set([data.articles[0].id, data.articles[1]?.id].filter(Boolean)));
        }
      }
    } catch (err) {
      console.warn('[News Fetch Error]:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentSymbol]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // Request in-depth Darija synthesis from Gemini
  const handleRequestAiDarija = async () => {
    if (isLoadingAiDarija) return;
    setIsLoadingAiDarija(true);
    try {
      const res = await fetch('/api/news/explain-darija', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: currentSymbol,
          articles: articles.slice(0, 5),
          currentPrice,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiDarijaSynthesis(data.darijaSynthesis || null);
      }
    } catch (err) {
      console.warn('[AI Darija Error]:', err);
    } finally {
      setIsLoadingAiDarija(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Compute final combined verdict (Technical + News)
  const combinedAnalysis = useMemo(() => {
    const newsScore = summary?.overallImpactScore || 0;
    return combineTechnicalAndNewsVerdict({
      technicalVerdict,
      technicalScore,
      newsImpactScore: newsScore,
      setup,
      symbol: currentSymbol,
      hasStaleData: false,
    });
  }, [technicalVerdict, technicalScore, summary, setup, currentSymbol]);

  // Filtered articles list
  const filteredArticles = useMemo(() => {
    return articles.filter((art) => {
      if (sourceFilter === 'BINANCE' && !art.isOfficial) return false;
      if (sourceFilter === 'COINTELEGRAPH' && !art.source.includes('CoinTelegraph')) return false;
      if (sourceFilter === 'COINDESK' && !art.source.includes('CoinDesk')) return false;

      if (sentimentFilter !== 'ALL' && art.sentiment !== sentimentFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = art.title.toLowerCase().includes(q);
        const inDesc = art.description.toLowerCase().includes(q);
        const inDarija = JSON.stringify(art.darijaExplanation || {}).includes(q);
        if (!inTitle && !inDesc && !inDarija) return false;
      }

      return true;
    });
  }, [articles, sourceFilter, sentimentFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Module Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
              <Newspaper className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>Crypto News Intelligence</span>
                  <span className="text-emerald-400 font-mono font-normal text-xs">
                    (English Sources + الشرح بالدارجة المغربية)
                  </span>
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {currentSymbol} ({currentMarket.toUpperCase()})
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-950 border border-slate-800 flex items-center gap-1">
                  <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                  Flux Réel Binance & Médias Vérifiés
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
                Agrégation continue des actualités officielles et des annonces Binance, avec calcul transparent du score d'impact de marché (-100 à +100) et explications structurées en Darija marocaine naturelle pour chaque fait marquant.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchNews}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
              <span>Actualiser les News</span>
            </button>
          </div>
        </div>

        {/* Global News Score & Impact Strip */}
        {summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 mt-4 border-t border-slate-800/80 text-xs">
            {/* Impact Score */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Score d'Impact Global</span>
                <span
                  className={`font-mono font-bold text-lg ${
                    summary.overallImpactScore > 15
                      ? 'text-emerald-400'
                      : summary.overallImpactScore < -15
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }`}
                >
                  {summary.overallImpactScore > 0 ? `+${summary.overallImpactScore}` : summary.overallImpactScore} / 100
                </span>
              </div>
              <span
                className={`px-2 py-1 rounded text-[10px] font-semibold ${
                  summary.overallImpactScore > 15
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : summary.overallImpactScore < -15
                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-amber-950 text-amber-300 border border-amber-800'
                }`}
              >
                {summary.sentimentLabel}
              </span>
            </div>

            {/* Articles Analyzed */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Articles Spécifiques vs Macro</span>
                <span className="font-mono font-bold text-lg text-slate-100">
                  {summary.coinSpecificArticlesCount ?? 0} spécifiques / {summary.totalArticlesAnalyzed} total
                </span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded border border-emerald-800">
                {summary.officialSourcesCount} Officielles Binance
              </span>
            </div>

            {/* Confidence Index */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Fiabilité & Confiance</span>
                <span className="font-mono font-bold text-lg text-blue-400">
                  {summary.confidenceScore}%
                </span>
              </div>
              <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                Sources vérifiées
              </span>
            </div>

            {/* Data Freshness */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Horodatage des Flux</span>
                <span className="font-mono font-bold text-xs text-slate-200 block mt-1">
                  {new Date(lastFetchTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <span className="px-2 py-1 rounded text-[10px] font-mono text-emerald-300 bg-emerald-950 border border-emerald-800">
                EN DIRECT
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Moroccan Darija Market Summary Banner */}
      {summary && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/60 rounded-xl p-5 shadow-xl relative text-right" dir="rtl">
          <div className="flex items-center justify-between flex-row-reverse mb-3 border-b border-emerald-800/40 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-emerald-300">
                ملخص الأخبار وحالة السوق بالدارجة المغربية
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-900/60 text-emerald-200 border border-emerald-700/60 font-semibold">
                تحليل مباشر لـ {baseAsset}
              </span>
            </div>
            <button
              onClick={handleRequestAiDarija}
              disabled={isLoadingAiDarija}
              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isLoadingAiDarija ? 'animate-spin' : ''}`} />
              <span>{isLoadingAiDarija ? 'جاري التحليل...' : 'تحليل إضافي معمق بالـ IA'}</span>
            </button>
          </div>

          <p className="text-sm text-slate-200 leading-relaxed font-sans">
            {summary.generalSummaryDarija}
          </p>

          {/* Optional Gemini In-Depth Darija Analysis */}
          {aiDarijaSynthesis && (
            <div className="mt-4 p-4 bg-slate-950/80 border border-emerald-700/60 rounded-xl text-xs text-slate-100 leading-relaxed space-y-2 shadow-inner">
              <span className="font-bold text-emerald-400 block text-xs">
                ✨ التحليل الشامل المولد بالذكاء الاصطناعي (Gemini) :
              </span>
              <p className="whitespace-pre-line text-slate-200">
                {aiDarijaSynthesis}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Combined Trading Verdict Card (Technical SMC + News Confluence) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              Verdict Final Couplé (Analyse Technique SMC + News Intelligence)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Les actualités complètent l'analyse technique sans la surcharger aveuglément. En cas de contradiction flagrante, le verdict est WAIT ou NO TRADE.
            </p>
          </div>

          {/* Verdict Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-2 shadow-md ${
                combinedAnalysis.combinedVerdict === 'LONG'
                  ? 'bg-emerald-600 text-white shadow-emerald-950/60'
                  : combinedAnalysis.combinedVerdict === 'SHORT'
                  ? 'bg-rose-600 text-white shadow-rose-950/60'
                  : combinedAnalysis.combinedVerdict === 'WAIT'
                  ? 'bg-amber-600 text-white shadow-amber-950/60'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {combinedAnalysis.combinedVerdict === 'LONG' ? (
                <TrendingUp className="w-4 h-4" />
              ) : combinedAnalysis.combinedVerdict === 'SHORT' ? (
                <TrendingDown className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              <span>VERDICT : {combinedAnalysis.combinedVerdict}</span>
            </span>
          </div>
        </div>

        {/* Verdict Explanation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* French Rationale */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <span className="font-semibold text-slate-300 block uppercase text-[11px] flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              Justification Technique & Fondamentale :
            </span>
            <p className="text-slate-300 leading-relaxed">
              {combinedAnalysis.verdictRationale}
            </p>
            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1">
              <span>Score Technique : {technicalScore}/100</span>
              <span>•</span>
              <span>Impact News : {summary?.overallImpactScore || 0}/100</span>
              <span>•</span>
              <span>Confiance : {combinedAnalysis.confidenceScore}%</span>
            </div>
          </div>

          {/* Darija Rationale */}
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-right" dir="rtl">
            <span className="font-semibold text-emerald-400 block text-[11px]">
              القرار بالدارجة المغربية للمتداول :
            </span>
            <p className="text-slate-200 leading-relaxed font-sans">
              {combinedAnalysis.verdictRationaleDarija}
            </p>
          </div>
        </div>

        {/* If Setup exists, display active trading plan levels */}
        {setup && (combinedAnalysis.combinedVerdict === 'LONG' || combinedAnalysis.combinedVerdict === 'SHORT') && (
          <div className="pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div className="p-2.5 bg-slate-950 border border-blue-900/40 rounded-lg">
                <span className="text-[10px] text-blue-400 block font-semibold uppercase">Entrée</span>
                <span className="font-mono font-bold text-slate-100 text-sm">
                  {formatCryptoPrice(setup.entryPrice, setup.tickSize)}$
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 border border-rose-900/40 rounded-lg">
                <span className="text-[10px] text-rose-400 block font-semibold uppercase">
                  Stop Loss (-{setup.riskPercent.toFixed(2)}%)
                </span>
                <span className="font-mono font-bold text-rose-300 text-sm">
                  {formatCryptoPrice(setup.stopLoss, setup.tickSize)}$
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 border border-emerald-900/40 rounded-lg">
                <span className="text-[10px] text-emerald-400 block font-semibold uppercase">TP1 (Net {setup.netRiskRewardRatioTP1}:1)</span>
                <span className="font-mono font-bold text-emerald-300 text-sm">
                  {formatCryptoPrice(setup.takeProfit1, setup.tickSize)}$
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 border border-emerald-900/40 rounded-lg">
                <span className="text-[10px] text-emerald-400 block font-semibold uppercase">TP2 (Net {setup.netRiskRewardRatioTP2}:1)</span>
                <span className="font-mono font-bold text-emerald-300 text-sm">
                  {formatCryptoPrice(setup.takeProfit2, setup.tickSize)}$
                </span>
              </div>
              {setup.takeProfit3 && (
                <div className="p-2.5 bg-slate-950 border border-emerald-900/40 rounded-lg">
                  <span className="text-[10px] text-emerald-400 block font-semibold uppercase">TP3 (Net {setup.netRiskRewardRatioTP3}:1)</span>
                  <span className="font-mono font-bold text-emerald-300 text-sm">
                    {formatCryptoPrice(setup.takeProfit3, setup.tickSize)}$
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar for News Articles */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 px-4 py-3 rounded-xl shadow-lg text-xs">
        {/* Source Filters */}
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-slate-400 font-medium text-[11px] mr-1">Sources :</span>
          <button
            onClick={() => setSourceFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              sourceFilter === 'ALL'
                ? 'bg-blue-600 text-white font-semibold'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Toutes ({articles.length})
          </button>
          <button
            onClick={() => setSourceFilter('BINANCE')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              sourceFilter === 'BINANCE'
                ? 'bg-amber-600 text-white font-semibold'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Binance Officiel ({articles.filter((a) => a.isOfficial).length})
          </button>
          <button
            onClick={() => setSourceFilter('COINTELEGRAPH')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              sourceFilter === 'COINTELEGRAPH'
                ? 'bg-blue-600 text-white font-semibold'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            CoinTelegraph
          </button>
          <button
            onClick={() => setSourceFilter('COINDESK')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
              sourceFilter === 'COINDESK'
                ? 'bg-blue-600 text-white font-semibold'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            CoinDesk
          </button>
        </div>

        {/* Sentiment Filter & Search */}
        <div className="flex items-center gap-2">
          <select
            value={sentimentFilter}
            onChange={(e) => setSentimentFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:border-blue-500 focus:outline-hidden"
          >
            <option value="ALL">Tous les sentiments</option>
            <option value="BULLISH">Haussier (Bullish)</option>
            <option value="BEARISH">Baissier (Bearish)</option>
            <option value="NEUTRAL">Neutre (Neutral)</option>
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Chercher dans les actualités..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-hidden w-44"
            />
          </div>
        </div>
      </div>

      {/* News Feed with Moroccan Darija Expanders */}
      <div className="space-y-4">
        {filteredArticles.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400 space-y-2">
            <Newspaper className="w-8 h-8 text-slate-500 mx-auto" />
            <p>Aucune actualité ne correspond aux filtres actuels pour {currentSymbol}.</p>
          </div>
        ) : (
          filteredArticles.map((article, idx) => {
            const isExpanded = expandedArticles.has(article.id);
            const isBullish = article.sentiment === 'BULLISH';
            const isBearish = article.sentiment === 'BEARISH';

            return (
              <div
                key={article.id || idx}
                className={`bg-slate-900 border rounded-xl overflow-hidden shadow-lg transition-all ${
                  article.isOfficial
                    ? 'border-amber-900/60'
                    : isBullish
                    ? 'border-emerald-900/40'
                    : isBearish
                    ? 'border-rose-900/40'
                    : 'border-slate-800'
                }`}
              >
                {/* News Header Strip */}
                <div className="p-4 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1.5 max-w-3xl">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                          article.isOfficial
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {article.source}
                      </span>

                      {article.isOfficial && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                          OFFICIEL
                        </span>
                      )}

                      {article.isCoinSpecific ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-950 text-blue-300 border border-blue-800 font-semibold">
                          SPÉCIFIQUE {baseAsset}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800 font-medium">
                          CONTEXTE MACRO & BTC
                        </span>
                      )}

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          isBullish
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : isBearish
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        Impact : {article.impactScore > 0 ? `+${article.impactScore}` : article.impactScore} / 100 ({article.impactLabel})
                      </span>

                      <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(article.publishedAt).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Original English Headline */}
                    <h4 className="text-sm font-bold text-slate-100 hover:text-blue-400 transition-colors">
                      <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5">
                        <span>{article.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-slate-500 hover:text-blue-400" />
                      </a>
                    </h4>

                    {article.description && (
                      <p className="text-xs text-slate-400 line-clamp-2">
                        {article.description}
                      </p>
                    )}
                  </div>

                  {/* Toggle Darija Breakdown Button */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleExpand(article.id)}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-emerald-600 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      <span>الشرح بالدارجة</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Collapsible Moroccan Darija Structured Explanation */}
                {isExpanded && article.darijaExplanation && (
                  <div className="p-4 bg-slate-950/90 border-t border-slate-800/80 space-y-3 text-right" dir="rtl">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <Flame className="w-4 h-4 text-emerald-400" />
                        التفكيك التفصيلي للخبر بالدارجة المغربية (Moroccan Darija Analysis)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400" dir="ltr">
                        {article.source}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs leading-relaxed">
                      {/* Q1: شنو وقع؟ */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-emerald-300 block text-[11px]">
                          1. شنو وقع بالضبط؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.whatHappened}</p>
                      </div>

                      {/* Q2: علاش مهم؟ */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-emerald-300 block text-[11px]">
                          2. علاش هاد الخبر مهم لـ {baseAsset}؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.whyImportant}</p>
                      </div>

                      {/* Q3: واش إيجابي ولا سلبي؟ */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-emerald-300 block text-[11px]">
                          3. واش الخبر إيجابي، سلبي، ولا محايد؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.sentimentVerdict}</p>
                      </div>

                      {/* Q4: تأثير السعر */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-emerald-300 block text-[11px]">
                          4. واش ممكن يأثر على السعر على المدى القريب أو المتوسط؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.priceImpact}</p>
                      </div>

                      {/* Q5: مؤكد ولا إشاعة؟ */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-emerald-300 block text-[11px]">
                          5. واش الخبر مؤكد ولا غير إشاعة؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.isConfirmedVsRumor}</p>
                      </div>

                      {/* Q6: المخاطر للمتداول */}
                      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                        <span className="font-bold text-rose-400 block text-[11px]">
                          6. شنو المخاطر اللي خاصك كمتداول ترد ليها البال؟
                        </span>
                        <p className="text-slate-200">{article.darijaExplanation.risksToWatch}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Safety Notice & Backtesting Calibration Disclosure */}
      <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl flex items-start gap-3 text-xs text-slate-400 leading-relaxed shadow-lg">
        <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-slate-200 block">
            Avertissement de transparence & Modélisation des risques :
          </strong>
          <p>
            Crypto Edge AI ne garantit aucun taux de réussite fixe (pas de promesse irréaliste de 90% de win-rate). L'impact des actualités est une variable contextuelle qui doit impérativement être subordonnée aux seuils stricts d'invalidation Stop Loss et à la gestion prudente de position. Les probabilités historiques sont calibrées avec déduction des frais de courtage et du slippage d'exécution.
          </p>
        </div>
      </div>
    </div>
  );
};
