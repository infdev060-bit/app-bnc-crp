import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { generateTimeframeSnapshot } from './src/utils/indicators';
import { evaluateMarketSetup } from './src/utils/tradeValidator';
import { calculateNewsImpactScore, generateDarijaExplanation, isArticleMatchingCoin, isSimilarStory } from './src/utils/newsAnalyzer';
import { IndicatorSnapshot, Timeframe, TickerData, MarketType, CryptoNewsItem, NewsIntelligenceSummary } from './src/types/crypto';

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '25mb' }));

// Initialize Gemini SDK with User-Agent header as required
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// API: Health status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Cache for Binance exchangeInfo symbol rules (tickSize, precision, status, market availability)
interface SymbolFilterInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string; // 'TRADING', 'BREAK', 'HALT', etc.
  tickSize: number;
  minPrice: number;
  maxPrice: number;
  pricePrecision: number;
  market: 'spot' | 'futures';
  isTrading: boolean;
}

let spotExchangeInfoCache: { timestamp: number; symbols: Map<string, SymbolFilterInfo> } | null = null;
let futuresExchangeInfoCache: { timestamp: number; symbols: Map<string, SymbolFilterInfo> } | null = null;

async function getExchangeInfo(market: 'spot' | 'futures'): Promise<Map<string, SymbolFilterInfo>> {
  const now = Date.now();
  const CACHE_TTL_MS = 3600000; // 1 hour

  if (market === 'futures') {
    if (futuresExchangeInfoCache && now - futuresExchangeInfoCache.timestamp < CACHE_TTL_MS) {
      return futuresExchangeInfoCache.symbols;
    }
    try {
      const resp = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
      if (resp.ok) {
        const data = await resp.json();
        const map = new Map<string, SymbolFilterInfo>();
        if (Array.isArray(data.symbols)) {
          for (const s of data.symbols) {
            const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
            map.set(s.symbol, {
              symbol: s.symbol,
              baseAsset: s.baseAsset || '',
              quoteAsset: s.quoteAsset || '',
              status: s.status || '',
              tickSize: parseFloat(priceFilter?.tickSize) || 0.0001,
              minPrice: parseFloat(priceFilter?.minPrice) || 0.0001,
              maxPrice: parseFloat(priceFilter?.maxPrice) || 1000000,
              pricePrecision: typeof s.pricePrecision === 'number' ? s.pricePrecision : 4,
              market: 'futures',
              isTrading: s.status === 'TRADING' && s.contractType === 'PERPETUAL',
            });
          }
        }
        futuresExchangeInfoCache = { timestamp: now, symbols: map };
        return map;
      }
    } catch (err) {
      console.warn('[ExchangeInfo] Erreur lors du chargement de fapi exchangeInfo:', err);
      if (futuresExchangeInfoCache) return futuresExchangeInfoCache.symbols;
    }
    return new Map();
  } else {
    if (spotExchangeInfoCache && now - spotExchangeInfoCache.timestamp < CACHE_TTL_MS) {
      return spotExchangeInfoCache.symbols;
    }
    try {
      const resp = await fetch('https://api.binance.com/api/v3/exchangeInfo');
      if (resp.ok) {
        const data = await resp.json();
        const map = new Map<string, SymbolFilterInfo>();
        if (Array.isArray(data.symbols)) {
          for (const s of data.symbols) {
            const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
            map.set(s.symbol, {
              symbol: s.symbol,
              baseAsset: s.baseAsset || '',
              quoteAsset: s.quoteAsset || '',
              status: s.status || '',
              tickSize: parseFloat(priceFilter?.tickSize) || 0.01,
              minPrice: parseFloat(priceFilter?.minPrice) || 0.01,
              maxPrice: parseFloat(priceFilter?.maxPrice) || 1000000,
              pricePrecision: typeof s.quotePrecision === 'number' ? s.quotePrecision : 2,
              market: 'spot',
              isTrading: s.status === 'TRADING' && s.isSpotTradingAllowed !== false,
            });
          }
        }
        spotExchangeInfoCache = { timestamp: now, symbols: map };
        return map;
      }
    } catch (err) {
      console.warn('[ExchangeInfo] Erreur lors du chargement de api/v3 exchangeInfo:', err);
      if (spotExchangeInfoCache) return spotExchangeInfoCache.symbols;
    }
    return new Map();
  }
}

interface ValidationResult {
  symbol: string;
  normalizedSymbol: string;
  market: 'spot' | 'futures';
  isValidOnTarget: boolean;
  isTradingOnTarget: boolean;
  existsOnAlternative: boolean;
  isTradingOnAlternative: boolean;
  alternativeMarket: 'spot' | 'futures' | null;
  message?: string;
  tickSize?: number;
  pricePrecision?: number;
}

async function validateMarketSymbol(rawSymbol: string, targetMarket: 'spot' | 'futures'): Promise<ValidationResult> {
  const symbol = rawSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const altMarket: 'spot' | 'futures' = targetMarket === 'futures' ? 'spot' : 'futures';

  const [targetMap, altMap] = await Promise.all([
    getExchangeInfo(targetMarket),
    getExchangeInfo(altMarket),
  ]);

  const targetInfo = targetMap.get(symbol);
  const altInfo = altMap.get(symbol);

  if (targetInfo && targetInfo.isTrading) {
    return {
      symbol,
      normalizedSymbol: symbol,
      market: targetMarket,
      isValidOnTarget: true,
      isTradingOnTarget: true,
      existsOnAlternative: Boolean(altInfo),
      isTradingOnAlternative: Boolean(altInfo?.isTrading),
      alternativeMarket: altInfo?.isTrading ? altMarket : null,
      tickSize: targetInfo.tickSize,
      pricePrecision: targetInfo.pricePrecision,
    };
  }

  // Not trading or missing on target market
  if (altInfo && altInfo.isTrading) {
    const targetLabel = targetMarket === 'futures' ? 'Binance USDⓈ-M Futures' : 'Binance Spot';
    const altLabel = altMarket === 'futures' ? 'Binance USDⓈ-M Futures' : 'Binance Spot';
    return {
      symbol,
      normalizedSymbol: symbol,
      market: targetMarket,
      isValidOnTarget: false,
      isTradingOnTarget: false,
      existsOnAlternative: true,
      isTradingOnAlternative: true,
      alternativeMarket: altMarket,
      tickSize: altInfo.tickSize,
      pricePrecision: altInfo.pricePrecision,
      message: `La paire ${symbol} n'est pas négociable sur ${targetLabel}, mais elle est active sur ${altLabel}.`,
    };
  }

  // Symbol not found on either market
  return {
    symbol,
    normalizedSymbol: symbol,
    market: targetMarket,
    isValidOnTarget: false,
    isTradingOnTarget: false,
    existsOnAlternative: false,
    isTradingOnAlternative: false,
    alternativeMarket: null,
    message: `Le symbole "${symbol}" est introuvable sur Binance (ni sur Spot, ni sur Futures). Aucun graphique ni cotation simulée.`,
  };
}

// In-memory klines cache to avoid hitting Binance rate limits during scans
const scannerKlinesCache = new Map<string, { timestamp: number; klines: any[] }>();

async function fetchKlinesForScanner(
  symbol: string,
  market: 'spot' | 'futures',
  interval: string,
  limit: number = 70
): Promise<any[]> {
  const cacheKey = `${market}:${symbol}:${interval}:${limit}`;
  const now = Date.now();
  const cached = scannerKlinesCache.get(cacheKey);
  if (cached && now - cached.timestamp < 60000) {
    return cached.klines;
  }

  const endpoint = market === 'futures'
    ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const raw = await resp.json();
      if (Array.isArray(raw)) {
        const klines = raw.map((k: any) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
        scannerKlinesCache.set(cacheKey, { timestamp: now, klines });
        return klines;
      }
    }
  } catch (err: any) {
    console.warn(`[Scanner Klines] Erreur ${symbol} ${interval}:`, err?.message);
  }
  return [];
}

const scannerTickersCache: {
  spot?: { timestamp: number; data: any[] };
  futures?: { timestamp: number; data: any[] };
} = {};

// API: Scanner Tickers (Top liquid pairs from Binance)
app.get('/api/market/scanner-tickers', async (req, res) => {
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';
  const minVolume = parseFloat(req.query.minVolume as string) || (market === 'futures' ? 5000000 : 1000000);
  const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 30, 5), 100);
  const now = Date.now();

  const cached = scannerTickersCache[market];
  if (cached && now - cached.timestamp < 30000) {
    return res.json({
      market,
      timestamp: cached.timestamp,
      tickers: cached.data.slice(0, limit),
      totalAvailable: cached.data.length,
    });
  }

  const endpoint = market === 'futures'
    ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
    : 'https://api.binance.com/api/v3/ticker/24hr';

  try {
    const [tickerResp, exchangeMap] = await Promise.all([
      fetch(endpoint, { headers: { 'Accept': 'application/json' } }),
      getExchangeInfo(market),
    ]);

    if (!tickerResp.ok) {
      return res.status(502).json({ error: 'Impossible de récupérer les tickers 24h Binance' });
    }

    const rawList = await tickerResp.json();
    if (!Array.isArray(rawList)) {
      return res.status(502).json({ error: 'Format invalide de réponse Binance' });
    }

    const validTickers: any[] = [];
    for (const item of rawList) {
      const sym = item.symbol;
      if (!sym || !sym.endsWith('USDT')) continue;

      const filterInfo = exchangeMap.get(sym);
      if (!filterInfo || !filterInfo.isTrading) continue;

      const lastPrice = parseFloat(item.lastPrice || item.c);
      const quoteVolume = parseFloat(item.quoteVolume || item.q);
      const volume = parseFloat(item.volume || item.v);
      const change24h = parseFloat(item.priceChangePercent || item.P) || 0;
      const high24h = parseFloat(item.highPrice || item.h) || lastPrice;
      const low24h = parseFloat(item.lowPrice || item.l) || lastPrice;

      if (isNaN(lastPrice) || lastPrice <= 0 || isNaN(quoteVolume) || quoteVolume < minVolume) {
        continue;
      }

      validTickers.push({
        symbol: sym,
        market,
        price: lastPrice,
        change24h,
        high24h,
        low24h,
        volume24h: volume,
        quoteVolume24h: quoteVolume,
        tickSize: filterInfo.tickSize,
        pricePrecision: filterInfo.pricePrecision,
      });
    }

    // Sort descending by 24h quoteVolume (highest liquidity first)
    validTickers.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

    scannerTickersCache[market] = {
      timestamp: now,
      data: validTickers,
    };

    return res.json({
      market,
      timestamp: now,
      tickers: validTickers.slice(0, limit),
      totalAvailable: validTickers.length,
    });
  } catch (err: any) {
    console.error('[Scanner Tickers] Erreur:', err);
    return res.status(500).json({ error: err?.message || 'Erreur interne scanner' });
  }
});

// API: Scanner Analyze Pair (Deep multi-timeframe analysis for a candidate)
app.get('/api/market/scanner-analyze-pair', async (req, res) => {
  const symbol = ((req.query.symbol as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';

  if (!symbol) {
    return res.status(400).json({ error: 'Symbole manquant.' });
  }

  const validation = await validateMarketSymbol(symbol, market);
  if (!validation.isValidOnTarget) {
    return res.status(404).json({
      error: validation.message,
      symbol,
      market,
      existsOnTarget: false,
      alternativeMarket: validation.alternativeMarket,
    });
  }

  try {
    const tickerEndpoint = market === 'futures'
      ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
      : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;

    const tickerResp = await fetch(tickerEndpoint, { headers: { 'Accept': 'application/json' } });
    if (!tickerResp.ok) {
      return res.status(502).json({ error: `Impossible de récupérer le ticker ${symbol}` });
    }
    const tickerJson = await tickerResp.json();
    const lastPrice = parseFloat(tickerJson.lastPrice || tickerJson.c);
    const quoteVolume = parseFloat(tickerJson.quoteVolume || tickerJson.q) || 0;
    const volume = parseFloat(tickerJson.volume || tickerJson.v) || 0;
    const change24h = parseFloat(tickerJson.priceChangePercent || tickerJson.P) || 0;
    const high24h = parseFloat(tickerJson.highPrice || tickerJson.h) || lastPrice;
    const low24h = parseFloat(tickerJson.lowPrice || tickerJson.l) || lastPrice;

    const tickSize = validation.tickSize || (lastPrice < 0.1 ? 0.00001 : lastPrice < 1 ? 0.0001 : 0.01);
    const pricePrecision = validation.pricePrecision || (lastPrice < 0.1 ? 5 : lastPrice < 1 ? 4 : 2);

    const tickerData: TickerData = {
      symbol,
      market,
      price: lastPrice,
      change24h,
      change24hAmount: parseFloat(tickerJson.priceChange || tickerJson.p) || 0,
      high24h,
      low24h,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      timestamp: tickerJson.closeTime || Date.now(),
      isLive: true,
      source: market === 'futures' ? 'Binance USDⓈ-M Futures' : 'Binance Spot',
      tickSize,
      pricePrecision,
      stalenessSeconds: 0,
      isStale: false,
    };

    // Parallel fetch for 4H, 1H, 15M, 5M klines
    const [k4h, k1h, k15m, k5m] = await Promise.all([
      fetchKlinesForScanner(symbol, market, '4h', 70),
      fetchKlinesForScanner(symbol, market, '1h', 70),
      fetchKlinesForScanner(symbol, market, '15m', 70),
      fetchKlinesForScanner(symbol, market, '5m', 70),
    ]);

    const snap4h = generateTimeframeSnapshot(k4h, '4h');
    const snap1h = generateTimeframeSnapshot(k1h, '1h');
    const snap15m = generateTimeframeSnapshot(k15m, '15m');
    const snap5m = generateTimeframeSnapshot(k5m, '5m');

    const evaluation = evaluateMarketSetup({
      symbol,
      market,
      currentPrice: lastPrice,
      ticker: tickerData,
      timeframe4h: snap4h,
      timeframe1h: snap1h,
      timeframe15m: snap15m,
      timeframe5m: snap5m,
      userRiskPercent: 1.0,
    });

    let category: 'BEST_LONG' | 'BEST_SHORT' | 'WATCHLIST' | 'REJECTED' = 'REJECTED';
    if (evaluation.outcome === 'LONG' && evaluation.qualityScore.total >= 65 && (evaluation.setup?.netRiskRewardRatioTP1 || 0) >= 1.2) {
      category = 'BEST_LONG';
    } else if (evaluation.outcome === 'SHORT' && evaluation.qualityScore.total >= 65 && (evaluation.setup?.netRiskRewardRatioTP1 || 0) >= 1.2) {
      category = 'BEST_SHORT';
    } else if (
      evaluation.qualityScore.total >= 45 ||
      evaluation.checklist.some((c) => c.id === 'check-4' && (c.status === 'PASSED' || c.status === 'WARNING')) ||
      Boolean(evaluation.setup)
    ) {
      category = 'WATCHLIST';
    } else {
      category = 'REJECTED';
    }

    return res.json({
      symbol,
      market,
      currentPrice: lastPrice,
      change24h,
      volume24h: volume,
      quoteVolume24h: quoteVolume,
      tickSize,
      pricePrecision,
      outcome: evaluation.outcome,
      category,
      qualityScore: evaluation.qualityScore,
      setup: evaluation.setup,
      checklist: evaluation.checklist,
      noTradeReasons: evaluation.noTradeReasons,
      executiveSummary: evaluation.executiveSummary,
      timestamp: Date.now(),
      stalenessSeconds: 0,
      snapshots: {
        '4h': snap4h,
        '1h': snap1h,
        '15m': snap15m,
        '5m': snap5m,
      },
    });
  } catch (err: any) {
    console.error(`[Scanner Analysis] Erreur sur ${symbol}:`, err);
    return res.status(500).json({ error: err?.message || 'Erreur analyse pair' });
  }
});

// API: Validate Symbol and Check Cross-Market Availability
app.get('/api/market/validate-symbol', async (req, res) => {
  const symbol = ((req.query.symbol as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';

  if (!symbol) {
    return res.status(400).json({ error: 'Symbole manquant.' });
  }

  const result = await validateMarketSymbol(symbol, market);
  return res.json(result);
});

// API: Search Symbols with Cross-Market Availability Intelligence
app.get('/api/market/search-symbols', async (req, res) => {
  const query = ((req.query.q as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';
  const altMarket: 'spot' | 'futures' = market === 'futures' ? 'spot' : 'futures';

  if (!query) {
    return res.json({ query: '', results: [] });
  }

  const [targetMap, altMap] = await Promise.all([
    getExchangeInfo(market),
    getExchangeInfo(altMarket),
  ]);

  const matches: Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    isTradingOnCurrent: boolean;
    isTradingOnAlternative: boolean;
    alternativeMarket: 'spot' | 'futures' | null;
  }> = [];

  const seen = new Set<string>();

  // 1. Direct match with or without USDT
  const directCandidates = [
    query,
    query.endsWith('USDT') ? query : `${query}USDT`,
    market === 'futures' && !query.startsWith('1000') ? `1000${query.endsWith('USDT') ? query : `${query}USDT`}` : '',
  ].filter(Boolean);

  for (const cand of directCandidates) {
    if (targetMap.has(cand) || altMap.has(cand)) {
      if (!seen.has(cand)) {
        seen.add(cand);
        const tInfo = targetMap.get(cand);
        const aInfo = altMap.get(cand);
        matches.push({
          symbol: cand,
          baseAsset: tInfo?.baseAsset || aInfo?.baseAsset || '',
          quoteAsset: tInfo?.quoteAsset || aInfo?.quoteAsset || 'USDT',
          isTradingOnCurrent: Boolean(tInfo?.isTrading),
          isTradingOnAlternative: Boolean(aInfo?.isTrading),
          alternativeMarket: aInfo?.isTrading ? altMarket : null,
        });
      }
    }
  }

  // 2. Base asset match or prefix match
  for (const [sym, info] of targetMap.entries()) {
    if (matches.length >= 10) break;
    if (seen.has(sym)) continue;
    if (info.isTrading && (info.baseAsset === query || sym.startsWith(query))) {
      seen.add(sym);
      const aInfo = altMap.get(sym);
      matches.push({
        symbol: sym,
        baseAsset: info.baseAsset,
        quoteAsset: info.quoteAsset,
        isTradingOnCurrent: true,
        isTradingOnAlternative: Boolean(aInfo?.isTrading),
        alternativeMarket: aInfo?.isTrading ? altMarket : null,
      });
    }
  }

  // 3. Alternative market matches if target market has few results
  if (matches.length < 5) {
    for (const [sym, info] of altMap.entries()) {
      if (matches.length >= 10) break;
      if (seen.has(sym)) continue;
      if (info.isTrading && (info.baseAsset === query || sym.startsWith(query))) {
        seen.add(sym);
        matches.push({
          symbol: sym,
          baseAsset: info.baseAsset,
          quoteAsset: info.quoteAsset,
          isTradingOnCurrent: false,
          isTradingOnAlternative: true,
          alternativeMarket: altMarket,
        });
      }
    }
  }

  return res.json({ query, results: matches });
});

// ============================================================================
// MODULE: CRYPTO NEWS INTELLIGENCE — LIVE ENGLISH FEEDS + MOROCCAN DARIJA
// ============================================================================

let globalNewsCache: {
  timestamp: number;
  items: CryptoNewsItem[];
} | null = null;

function parseRssXml(xml: string, sourceName: string): CryptoNewsItem[] {
  const items: CryptoNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  let idx = 0;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 25) {
    const itemContent = match[1];
    const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemContent);
    const linkMatch = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(itemContent);
    const pubDateMatch = /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i.exec(itemContent);
    const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(itemContent);

    if (titleMatch && linkMatch) {
      const title = titleMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
      const link = linkMatch[1].trim();
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
      const rawDesc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const publishedAt = pubDate ? new Date(pubDate).getTime() || Date.now() : Date.now();
      const scored = calculateNewsImpactScore({ title, description: rawDesc, source: sourceName, isOfficial: false, publishedAt });

      items.push({
        id: `news-${sourceName.toLowerCase()}-${publishedAt}-${idx++}`,
        title,
        source: sourceName,
        sourceUrl: link,
        publishedAt,
        publishedDateStr: pubDate || new Date(publishedAt).toISOString(),
        description: rawDesc.slice(0, 350),
        isOfficial: false,
        language: 'EN',
        impactScore: scored.impactScore,
        impactLabel: scored.impactLabel,
        isConfirmed: scored.isConfirmed,
        sentiment: scored.sentiment,
      });
    }
  }
  return items;
}

async function fetchAllLiveCryptoNews(): Promise<CryptoNewsItem[]> {
  const now = Date.now();
  if (globalNewsCache && now - globalNewsCache.timestamp < 90000) {
    return globalNewsCache.items;
  }

  const results: CryptoNewsItem[] = [];

  try {
    const [ctRes, cdRes, bnGeneral, bnListings] = await Promise.allSettled([
      // 1. CoinTelegraph RSS
      fetch('https://cointelegraph.com/rss').then((r) => r.text()),
      // 2. CoinDesk RSS
      fetch('https://www.coindesk.com/arc/outboundfeeds/rss/').then((r) => r.text()),
      // 3. Binance Official Announcements (General activities)
      fetch('https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=1&pageSize=12', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      }).then((r) => r.json()),
      // 4. Binance New Listings & Delistings
      fetch('https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=49&pageNo=1&pageSize=12', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      }).then((r) => r.json()),
    ]);

    // Process Binance Official
    const bnArticles = [
      ...(bnGeneral.status === 'fulfilled' ? bnGeneral.value?.data?.articles || [] : []),
      ...(bnListings.status === 'fulfilled' ? bnListings.value?.data?.articles || [] : []),
    ];

    for (let i = 0; i < bnArticles.length; i++) {
      const art = bnArticles[i];
      if (!art || !art.title) continue;
      const title = art.title.trim();
      const publishedAt = art.releaseDate || (now - i * 3600000);
      const scored = calculateNewsImpactScore({ title, description: title, source: 'Binance Official', isOfficial: true, publishedAt });

      results.push({
        id: `news-binance-${art.code || i}`,
        title,
        source: 'Binance Official',
        sourceUrl: `https://www.binance.com/en/support/announcement/${art.code || ''}`,
        publishedAt,
        publishedDateStr: new Date(publishedAt).toISOString(),
        description: `Annonce officielle Binance : ${title}`,
        isOfficial: true,
        language: 'EN',
        impactScore: scored.impactScore,
        impactLabel: scored.impactLabel,
        isConfirmed: true,
        sentiment: scored.sentiment,
      });
    }

    // Process CoinTelegraph RSS
    if (ctRes.status === 'fulfilled' && typeof ctRes.value === 'string') {
      const ctItems = parseRssXml(ctRes.value, 'CoinTelegraph');
      results.push(...ctItems);
    }

    // Process CoinDesk RSS
    if (cdRes.status === 'fulfilled' && typeof cdRes.value === 'string') {
      const cdItems = parseRssXml(cdRes.value, 'CoinDesk');
      results.push(...cdItems);
    }

    // Deduplicate by exact normalized title AND story similarity (Jaccard token overlap)
    const uniqueResults: CryptoNewsItem[] = [];
    for (const item of results) {
      const normalized = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isDuplicate = uniqueResults.some(
        (existing) =>
          existing.title.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized ||
          isSimilarStory(existing.title, item.title)
      );

      if (!isDuplicate) {
        uniqueResults.push(item);
      }
    }

    // Sort descending by publication date
    uniqueResults.sort((a, b) => b.publishedAt - a.publishedAt);

    globalNewsCache = {
      timestamp: now,
      items: uniqueResults,
    };

    return uniqueResults;
  } catch (err: any) {
    console.error('[News Intelligence Engine Error]:', err?.message);
    return globalNewsCache ? globalNewsCache.items : [];
  }
}

// API: Get live crypto news with Moroccan Darija breakdown for the target coin
app.get('/api/news/crypto', async (req, res) => {
  const symbol = ((req.query.symbol as string) || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const baseAsset = symbol.replace('USDT', '').replace(/[^A-Z0-9]/g, '');

  try {
    const allNews = await fetchAllLiveCryptoNews();

    // 1. Separate coin-specific articles and general macro market articles using entity resolution
    const coinSpecific: CryptoNewsItem[] = [];
    const macroNews: CryptoNewsItem[] = [];

    for (const item of allNews) {
      const isCoinMatch = isArticleMatchingCoin(item.title, item.description, baseAsset);
      if (isCoinMatch) {
        coinSpecific.push({ ...item, coin: baseAsset, isCoinSpecific: true, category: 'COIN_SPECIFIC' });
      } else {
        macroNews.push({ ...item, isCoinSpecific: false, category: 'MACRO_MARKET' });
      }
    }

    // 2. Strict isolation: If no specific news exists for this coin, the score MUST be 0 (Neutral).
    // A Bitcoin or macro rally must NEVER artificially inflate the fundamental score of an unrelated altcoin!
    let overallImpactScore = 0;
    let dominantSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'CONFLICTING' = 'NEUTRAL';
    let sentimentLabel = 'Neutre / متوازن';
    let confidenceScore = 20;
    let officialCount = 0;

    if (coinSpecific.length > 0) {
      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const art of coinSpecific) {
        const weight = art.isOfficial ? 2.5 : 1.0;
        totalWeightedScore += art.impactScore * weight;
        totalWeight += weight;
        if (art.isOfficial) officialCount++;
      }

      overallImpactScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

      if (overallImpactScore >= 35) {
        dominantSentiment = 'BULLISH';
        sentimentLabel = 'Haussier Fort / إيجابي بزاف';
      } else if (overallImpactScore >= 12) {
        dominantSentiment = 'BULLISH';
        sentimentLabel = 'Haussier Modéré / متفائل';
      } else if (overallImpactScore <= -35) {
        dominantSentiment = 'BEARISH';
        sentimentLabel = 'Baissier Fort / سلبي بزاف';
      } else if (overallImpactScore <= -12) {
        dominantSentiment = 'BEARISH';
        sentimentLabel = 'Baissier Modéré / حذر وسلبي';
      } else {
        dominantSentiment = 'NEUTRAL';
        sentimentLabel = 'Neutre / متوازن';
      }

      confidenceScore = Math.min(
        95,
        Math.max(35, coinSpecific.length * 15 + officialCount * 20)
      );
    } else {
      // 0 specific news found for this token
      overallImpactScore = 0;
      dominantSentiment = 'NEUTRAL';
      sentimentLabel = 'Neutre / Aucune actualité spécifique (0/100)';
      confidenceScore = 20; // Reflects purely technical regime
    }

    // 3. Assemble articles: Coin-specific first, followed by contextual macro market news
    const selectedArticles: CryptoNewsItem[] = [
      ...coinSpecific,
      ...macroNews.slice(0, Math.max(3, 15 - coinSpecific.length)),
    ];

    // Enrich each article with structured Moroccan Darija explanations with truthfulness flag
    const enrichedArticles: CryptoNewsItem[] = selectedArticles.map((art) => ({
      ...art,
      darijaExplanation: generateDarijaExplanation(
        art.title,
        art.description,
        art.source,
        baseAsset,
        art.impactScore,
        art.isConfirmed,
        Boolean(art.isCoinSpecific)
      ),
    }));

    // Synthesis in Moroccan Darija
    let generalSummaryDarija = '';
    if (coinSpecific.length === 0) {
      generalSummaryDarija = `ما كاين حتى خبر خاص أو مؤكد كيهضر مباشرة على عملة ${baseAsset} في هاد اللحظة. الأخبار المعروضة لتحت هي أخبار عامة ديال السوق (Macro Crypto / Bitcoin). القرار الاستثماري كيعتمد 100% على التحليل التقني SMC ومراقبة حركة الشموع.`;
    } else if (dominantSentiment === 'BULLISH') {
      generalSummaryDarija = `الأخبار الحالية ديال سوق الكريبتو كتعطي معنويات إيجابية وتفاؤل خاص بخصوص ${baseAsset}. كاين تدفق ديال السيولة واهتمام ملحوظ، ولكن ديما رد البال من الشراء في القمة وماتنساش الـ Stop Loss.`;
    } else if (dominantSentiment === 'BEARISH') {
      generalSummaryDarija = `الأخبار الأخيرة فيها ضغوطات سلبية وتخوف (FUD) كيقدر يأثر مباشرة على عملة ${baseAsset}. المتداولين الكبار واخدين الحيطة، خاصك تكون حذر وما تدخلش بلا وقف خسارة محكم.`;
    } else {
      generalSummaryDarija = `الأخبار المباشرة لعملة ${baseAsset} متوازنة ومحايدة (Neutral). ما كاينش شي خبر صادم اللي يغير الاتجاه جذرياً، والتحليل التقني للشموع هو الفيصل الأول.`;
    }

    const summary: NewsIntelligenceSummary = {
      symbol,
      overallImpactScore,
      confidenceScore,
      dominantSentiment,
      sentimentLabel,
      totalArticlesAnalyzed: enrichedArticles.length,
      coinSpecificArticlesCount: coinSpecific.length,
      officialSourcesCount: officialCount,
      lastUpdated: Date.now(),
      generalSummaryDarija,
      keyCatalysts: [
        coinSpecific.length > 0
          ? `${coinSpecific.length} actualité(s) spécifique(s) auditée(s) pour ${baseAsset}`
          : `Aucun catalyseur spécifique pour ${baseAsset} : régime 100% technique`,
        `${officialCount} annonce(s) officielle(s) Binance auditée(s)`,
        `Indice de confiance fondamentale : ${confidenceScore}%`,
      ],
      mainRisks: [
        'Volatilité accrue lors des annonces macroéconomiques ou régulations',
        'Effet d’annonce potentiellement déjà intégré dans les prix (Priced in)',
        'Risque de rumeurs non vérifiées sur les réseaux sociaux',
      ],
      combinedVerdict: 'NO_TRADE',
      verdictRationale: 'En attente de couplage avec le setup technique.',
      verdictRationaleDarija: 'في انتظار الدمج مع التحليل التقني SMC.',
    };

    return res.json({
      success: true,
      symbol,
      baseAsset,
      summary,
      articles: enrichedArticles,
      totalCount: enrichedArticles.length,
      coinSpecificCount: coinSpecific.length,
      lastUpdated: Date.now(),
      isLiveFeed: true,
    });
  } catch (err: any) {
    console.error(`[News API Error for ${symbol}]:`, err?.message);
    return res.status(500).json({
      error: `Erreur lors de la récupération des actualités pour ${symbol} : ${err?.message || 'Erreur réseau'}`,
      symbol,
      articles: [],
      summary: null,
    });
  }
});

// API: In-depth Moroccan Darija explanation via Gemini (with resilient local fallback)
app.post('/api/news/explain-darija', async (req, res) => {
  const { symbol, articles, currentPrice } = req.body;
  const baseAsset = ((symbol as string) || 'BTCUSDT').replace('USDT', '');

  const ai = getGeminiClient();
  if (!ai) {
    // Graceful fallback to deterministic local Darija generator
    return res.json({
      success: true,
      fallbackUsed: true,
      darijaSynthesis: `تحليل الأخبار بالدارجة المغربية لعملة ${baseAsset} : الأوضاع الحالية كتطلب مراقبة مستويات السيولة وشموع الـ 15 دقيقة و 1 ساعة. حافظ على رأس مالك وتجنب التداول وقت الأخبار العنيفة.`,
    });
  }

  try {
    const prompt = `أنت خبير ومحلل مالي محترف في الكريبتو والتداول (Trading / Smart Money Concept) وتتكلم بالدارجة المغربية الفصيحة والواضحة (Moroccan Darija).
قدم للمتداولين المغاربة تحليلاً وشرحاً مبسطاً وعميقاً للأخبار الحالية ديال عملة ${baseAsset} (السعر الحالي: ${currentPrice || 'N/A'}$).

عناوين الأخبار الأخيرة:
${(articles || []).slice(0, 5).map((a: any, i: number) => `${i + 1}. [${a.source}] ${a.title}`).join('\n')}

المطلوب منك بالدارجة المغربية:
1. شنو واقع دابا في السوق لهاد العملة؟
2. واش هاد الأخبار كتشجع على الشراء ولا خاص الحذر؟
3. نصيحة للمتداول بالدارجة بخصوص حماية رأس المال.

أجب بنص واضح وسلس بالدارجة المغربية (بدون تعقيد ولا فرنسية غير مفهومة).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.3,
      },
    });

    return res.json({
      success: true,
      darijaSynthesis: response.text || '',
    });
  } catch (err: any) {
    return res.json({
      success: true,
      fallbackUsed: true,
      darijaSynthesis: `ملخص الأخبار بالدارجة المغربية لـ ${baseAsset} : الأخبار الحالية كتطلب مراقبة مستويات الدعم والمقاومة، مع احترام صارم للـ Stop Loss لتفادي تقلبات السوق المفاجئة.`,
    });
  }
});

// API: Ticker 24h market data from official Binance public endpoints
app.get('/api/market/ticker', async (req, res) => {
  const symbol = ((req.query.symbol as string) || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';

  // 1. Validate symbol against official Exchange Info before requesting Binance API
  const validation = await validateMarketSymbol(symbol, market);
  if (!validation.isValidOnTarget) {
    return res.status(404).json({
      error: validation.message,
      symbol,
      market,
      existsOnTarget: false,
      existsOnAlternative: validation.existsOnAlternative,
      alternativeMarket: validation.alternativeMarket,
      isLive: false,
    });
  }

  const endpoint = market === 'futures'
    ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
    : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const tickerRes = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    const rateLimitWeight = tickerRes.headers.get('x-mbx-used-weight-1m') || 'N/A';

    if (tickerRes.ok) {
      const data = await tickerRes.json();
      const lastPrice = parseFloat(data.lastPrice);
      if (isNaN(lastPrice) || lastPrice <= 0) {
        return res.status(404).json({
          error: `Données de cotation invalides retournées par Binance pour ${symbol}.`,
          symbol,
          market,
          isLive: false,
        });
      }

      const tickSize = validation.tickSize || (lastPrice < 0.1 ? 0.00001 : lastPrice < 1 ? 0.0001 : 0.01);
      const pricePrecision = validation.pricePrecision || (lastPrice < 0.1 ? 5 : lastPrice < 1 ? 4 : 2);

      return res.json({
        symbol,
        market,
        price: lastPrice,
        change24h: parseFloat(data.priceChangePercent) || 0,
        change24hAmount: parseFloat(data.priceChange) || 0,
        high24h: parseFloat(data.highPrice) || lastPrice,
        low24h: parseFloat(data.lowPrice) || lastPrice,
        volume24h: parseFloat(data.volume) || 0,
        quoteVolume24h: parseFloat(data.quoteVolume) || 0,
        timestamp: data.closeTime || Date.now(),
        isLive: true,
        source: market === 'futures' ? 'Binance USDⓈ-M Futures' : 'Binance Spot',
        rateLimitWeight,
        tickSize,
        pricePrecision,
      });
    } else {
      let errorMsg = `La paire ${symbol} est introuvable ou indisponible sur ${market === 'futures' ? 'Binance Futures' : 'Binance Spot'}.`;
      try {
        const errorJson = await tickerRes.json();
        if (errorJson.msg) {
          errorMsg = `Binance API : ${errorJson.msg} (${symbol} sur ${market})`;
        }
      } catch {
        // Ignored
      }

      return res.status(tickerRes.status === 400 ? 404 : tickerRes.status).json({
        error: errorMsg,
        symbol,
        market,
        existsOnTarget: false,
        existsOnAlternative: validation.existsOnAlternative,
        alternativeMarket: validation.alternativeMarket,
        isLive: false,
      });
    }
  } catch (err: any) {
    console.error(`[Market API] Erreur réseau Binance pour ${symbol}:`, err?.message);
    return res.status(503).json({
      error: `Impossible de joindre l'API publique Binance (${err?.message || 'Erreur réseau'}). Aucun prix simulé n'est inventé.`,
      symbol,
      market,
      isLive: false,
    });
  }
});

// API: Klines / Candlestick data from official Binance public endpoints
app.get('/api/market/klines', async (req, res) => {
  const symbol = ((req.query.symbol as string) || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const interval = (req.query.interval as string) || '1h'; // 5m, 15m, 1h, 4h, 1d
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 80, 200);
  const market = (req.query.market as string) === 'futures' ? 'futures' : 'spot';

  // 1. Validate symbol against official Exchange Info before requesting Binance API
  const validation = await validateMarketSymbol(symbol, market);
  if (!validation.isValidOnTarget) {
    return res.status(404).json({
      error: validation.message,
      symbol,
      interval,
      market,
      existsOnTarget: false,
      existsOnAlternative: validation.existsOnAlternative,
      alternativeMarket: validation.alternativeMarket,
      isLive: false,
      klines: [],
    });
  }

  const endpoint = market === 'futures'
    ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    : `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (response.ok) {
      const rawKlines = await response.json();
      if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
        return res.status(404).json({
          error: `Aucun chandelier disponible pour ${symbol} sur l'unité de temps ${interval}.`,
          symbol,
          interval,
          market,
          isLive: false,
          klines: [],
        });
      }

      const klines = rawKlines.map((k: any) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      return res.json({
        symbol,
        interval,
        market,
        isLive: true,
        source: market === 'futures' ? 'Binance USDⓈ-M Futures' : 'Binance Spot',
        candleCount: klines.length,
        lastCandleTime: klines[klines.length - 1]?.time,
        klines,
      });
    } else {
      let errorMsg = `Impossible de récupérer les chandeliers pour ${symbol} (${interval}) sur Binance ${market}.`;
      try {
        const errorJson = await response.json();
        if (errorJson.msg) {
          errorMsg = `Binance Klines API : ${errorJson.msg}`;
        }
      } catch {
        // Ignored
      }

      return res.status(response.status === 400 ? 404 : response.status).json({
        error: errorMsg,
        symbol,
        interval,
        market,
        existsOnTarget: false,
        existsOnAlternative: validation.existsOnAlternative,
        alternativeMarket: validation.alternativeMarket,
        isLive: false,
        klines: [],
      });
    }
  } catch (err: any) {
    console.error(`[Klines API] Erreur réseau Binance pour ${symbol}:`, err?.message);
    return res.status(503).json({
      error: `Erreur de connexion à Binance pour l'historique de ${symbol} (${err?.message || 'Timeout'}). Aucun chandelier n'est simulé.`,
      symbol,
      interval,
      market,
      isLive: false,
      klines: [],
    });
  }
});

// API: AI Chart Vision Analysis
app.post('/api/ai/analyze-chart', async (req, res) => {
  const { imageBase64, mimeType, symbol, timeframe, userNotes } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: "Aucune image de graphique transmise." });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(500).json({
      error: "Clé API Gemini non configurée sur le serveur. Veuillez configurer GEMINI_API_KEY.",
    });
  }

  try {
    const prompt = `Tu es un analyste professionnel senior en trading de cryptomonnaies, spécialisé dans le Price Action pur et le Smart Money Concept (SMC).
Analyse minutieusement cette capture d'écran de graphique crypto.
La paire analysée déclarée est : "${symbol || 'Non spécifiée'}".
L'unité de temps déclarée est : "${timeframe || 'À identifier par la vision'}".
Notes supplémentaires du trader : "${userNotes || 'Aucune'}".

INSTRUCTIONS STRICTES ET OBLIGATOIRES :
1. RÈGLE D'OR : N'invente AUCUN niveau de prix, indicateur ou structure qui n'est pas clairement lisible visuellement sur l'image.
2. Distingue rigoureusement les "OBSERVATIONS CERTAINES" (visibles avec certitude) des "INTERPRÉTATIONS PROBABILISTES" (hypothèses techniques).
3. Ne promets JAMAIS de profits garantis. Sois prudent, pragmatique et focalisé sur la préservation du capital.
4. Si l'image est floue ou si l'unité de temps est introuvable, mentionne-le expressément.
5. Tout le contenu et les explications doivent être rédigés en FRANÇAIS avec une terminologie de trading professionnelle (Order Block, Fair Value Gap, Liquidity Sweep, BOS, CHoCH, Invalidation, etc.).

Tu dois retourner impérativement une réponse au format JSON strict respectant exactement cette structure :
{
  "chartReadability": "EXCELLENTE" | "MOYENNE" | "DIFFICILEMENT_LISIBLE",
  "detectedPair": string,
  "detectedTimeframe": string,
  "candlestickStructure": {
    "dominantType": string,
    "description": string,
    "wicksAndRejections": string
  },
  "trend": {
    "direction": "HAUSSIERE" | "BAISSIERE" | "RANGE_CONSOLIDATION" | "INCERTAINE",
    "strength": "FORTE" | "MODEREE" | "AFFAIBLIE",
    "rationale": string
  },
  "smcElements": {
    "breakOfStructure": { "present": boolean, "details": string },
    "changeOfCharacter": { "present": boolean, "details": string },
    "orderBlocks": [
      { "type": "BULLISH" | "BEARISH", "priceZone": string, "mitigated": boolean, "notes": string }
    ],
    "fairValueGaps": [
      { "type": "HAUSSIER" | "BAISSIER", "priceZone": string, "filled": boolean, "notes": string }
    ],
    "liquiditySweeps": { "detected": boolean, "side": "BUY_SIDE" | "SELL_SIDE" | "AUCUN", "details": string }
  },
  "supportResistanceLevels": [
    { "level": string, "type": "SUPPORT" | "RESISTANCE", "reliability": "HAUTE" | "MOYENNE" | "APPROXIMATIVE" }
  ],
  "potentialEntryZones": [
    { "zone": string, "bias": "ACHAT" | "VENTE" | "ATTENTE", "rationale": string, "invalidation": string }
  ],
  "verificationAlerts": [string],
  "overallEvaluation": string,
  "tradeVerdict": "CONFIG_LONG_ENVISAGEABLE" | "CONFIG_SHORT_ENVISAGEABLE" | "NO_TRADE_ATTENTE"
}
IMPORTANT: Ne renvoie aucun markdown (pas de backticks \`\`\`json) en dehors du JSON pur.`;

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2, // Low temperature for high analytical precision and consistency
      },
    });

    const text = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch (parseErr) {
      // Clean possible stray markdown
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    return res.json({
      success: true,
      analysis: parsedData,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const isRateLimit =
      err?.status === 429 ||
      err?.error?.code === 429 ||
      String(err?.message || '').includes('429') ||
      String(err?.message || '').includes('quota') ||
      String(err?.message || '').includes('RESOURCE_EXHAUSTED');

    if (isRateLimit) {
      console.warn('[AI Chart Vision Notice] Quota journalier Gemini atteint (429 RESOURCE_EXHAUSTED).');
      return res.status(200).json({
        success: false,
        rateLimited: true,
        error: "Le quota de requêtes journalières de l'API Gemini est temporairement atteint. L'analyse visuelle sera de nouveau disponible après réinitialisation du quota.",
      });
    }

    console.warn('[AI Chart Vision Warning]:', err?.message || err);
    return res.status(500).json({
      error: `Erreur lors de l'analyse visuelle par l'IA : ${err.message || 'Erreur inconnue'}`,
    });
  }
});

// API: AI Trade Setup Verification & Synthesis
app.post('/api/ai/verify-setup', async (req, res) => {
  const { symbol, market, currentPrice, technicalData, visionData, userParameters } = req.body;

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(500).json({
      error: "Clé API Gemini non configurée sur le serveur.",
    });
  }

  try {
    const prompt = `Tu es le moteur d'arbitrage de risque et d'analyse technique de "Crypto Edge AI".
Ta mission fondamentale est la PRÉSERVATION DU CAPITAL et le rejet systématique des trades médiocres ou contradictoires.
Le trading de crypto est hautement risqué. Ne cherche JAMAIS à forcer un trade pour faire plaisir.

DONNÉES DU MARCHÉ ANALYSÉ :
- Paire : ${symbol}
- Marché : ${market}
- Prix actuel : ${currentPrice}
- Données techniques & indicateurs : ${JSON.stringify(technicalData || {})}
- Données de l'analyse visuelle du graphique (si dispo) : ${JSON.stringify(visionData || {})}
- Paramètres de risque du trader : ${JSON.stringify(userParameters || {})}

PROCESSUS DE VÉRIFICATION EN 10 POINTS :
1. Fraîcheur des données de marché
2. Correspondance exacte de la paire et de l'exchange
3. Alignement de la tendance sur unité de temps supérieure (HTF)
4. Justification technique de la zone d'entrée (SMC, rejet, confluence)
5. Niveau logique d'invalidation pour le Stop Loss (SL sous un creux/sommet clé ou hors de l'OB)
6. Ratio Rendement/Risque (R/R) strictement >= 1.5:1 sur TP1
7. Volatilité ATR modérée (pas de pic anormal incontrôlé)
8. Volume et liquidité suffisants
9. Absence de signaux contradictoires (ex: RSI surachat en tendance baissière mais tentative de long sans CHoCH)
10. Contexte événementiel et prudence macroéconomique

RÈGLES DU RÉSULTAT DU VERDICT :
Si au moins une condition critique échoue ou si des signaux se contredisent, le résultat DOIT être "NO_TRADE".
Ne produis "LONG" ou "SHORT" QUE si la confluence est solide et le risque maîtrisé.
Pour un LONG : SL < Entry, TP1 > Entry, TP2 > TP1, TP3 > TP2.
Pour un SHORT : SL > Entry, TP1 < Entry, TP2 < TP1, TP3 < TP2.

Calcule également un Setup Quality Score rigoureux de 0 à 100 basé sur :
- Alignement HTF (0-20)
- Structure de marché & SMC (0-20)
- Précision de l'entrée (0-15)
- Confirmation volume/momentum (0-15)
- Ratio Risque/Rendement (0-15)
- Volatilité adéquate (0-10)
- Fiabilité des données (0-5)
(Note : Le score représente la qualité technique de la configuration, et en aucun cas une probabilité mathématique de gain.)

Réponds en JSON strict au format :
{
  "outcome": "LONG" | "SHORT" | "NO_TRADE",
  "qualityScore": number,
  "scoreBreakdown": {
    "htfAlignment": number,
    "marketStructure": number,
    "entryQuality": number,
    "volumeConfirmation": number,
    "riskRewardScore": number,
    "volatilityScore": number,
    "dataReliability": number
  },
  "verificationChecklist": [
    { "id": string, "label": string, "status": "PASSED" | "FAILED" | "WARNING", "comment": string }
  ],
  "setup": {
    "direction": "LONG" | "SHORT" | "AUCUN",
    "entryPrice": number,
    "entryZone": string,
    "stopLoss": number,
    "invalidationCondition": string,
    "takeProfit1": number,
    "takeProfit2": number,
    "takeProfit3": number,
    "riskRewardRatioTP1": number,
    "riskRewardRatioTP2": number,
    "suggestedRiskPercent": number,
    "keyConfluences": [string],
    "mainRisks": [string]
  },
  "noTradeReasons": [string],
  "executiveSummary": string,
  "disclaimer": "Le trading comporte un risque substantiel de perte financière. Ce setup est une analyse technique et non une incitation à investir."
}
IMPORTANT : Renvoie uniquement le JSON pur sans balise markdown.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.15,
      },
    });

    const text = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedData = JSON.parse(cleaned);
    }

    return res.json({
      success: true,
      verdict: parsedData,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    const isRateLimit =
      err?.status === 429 ||
      err?.error?.code === 429 ||
      String(err?.message || '').includes('429') ||
      String(err?.message || '').includes('quota') ||
      String(err?.message || '').includes('RESOURCE_EXHAUSTED');

    if (isRateLimit) {
      console.warn('[AI Verify Setup Notice] Quota journalier Gemini atteint (429 RESOURCE_EXHAUSTED). Bascule automatique sur moteur algorithmique.');
      return res.status(200).json({
        success: false,
        rateLimited: true,
        error: "Quota API Gemini temporairement épuisé (20 requêtes/jour sur Free Tier). Le moteur algorithmique haute précision local assure 100% des vérifications.",
      });
    }

    console.warn('[AI Verify Setup Warning]:', err?.message || err);
    return res.status(500).json({
      error: `Erreur lors de la validation du setup : ${err.message || 'Erreur inconnue'}`,
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Crypto Edge AI Server] Démarré sur http://localhost:${PORT} (Mode: ${isProduction ? 'Production' : 'Développement'})`);
  });
}

startServer().catch((err) => {
  console.error('[Crypto Edge AI Server Fatal Error]:', err);
  process.exit(1);
});
