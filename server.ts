import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
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

// Cache for Binance exchangeInfo symbol rules (tickSize, precision)
interface SymbolFilterInfo {
  tickSize: number;
  minPrice: number;
  maxPrice: number;
  pricePrecision: number;
}

const spotSymbolCache = new Map<string, SymbolFilterInfo>();
let futuresExchangeInfoCache: { timestamp: number; symbols: Map<string, SymbolFilterInfo> } | null = null;

async function getSymbolFilters(symbol: string, market: 'spot' | 'futures'): Promise<SymbolFilterInfo | null> {
  try {
    if (market === 'futures') {
      const now = Date.now();
      if (!futuresExchangeInfoCache || now - futuresExchangeInfoCache.timestamp > 3600000) {
        const resp = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        if (resp.ok) {
          const data = await resp.json();
          const map = new Map<string, SymbolFilterInfo>();
          if (Array.isArray(data.symbols)) {
            for (const s of data.symbols) {
              const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
              map.set(s.symbol, {
                tickSize: parseFloat(priceFilter?.tickSize) || 0.00001,
                minPrice: parseFloat(priceFilter?.minPrice) || 0.00001,
                maxPrice: parseFloat(priceFilter?.maxPrice) || 1000000,
                pricePrecision: s.pricePrecision || 5,
              });
            }
          }
          futuresExchangeInfoCache = { timestamp: now, symbols: map };
        }
      }
      return futuresExchangeInfoCache?.symbols.get(symbol) || null;
    } else {
      if (spotSymbolCache.has(symbol)) {
        return spotSymbolCache.get(symbol)!;
      }
      const resp = await fetch(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`);
      if (resp.ok) {
        const data = await resp.json();
        const s = data.symbols?.[0];
        if (s) {
          const priceFilter = s.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
          const info: SymbolFilterInfo = {
            tickSize: parseFloat(priceFilter?.tickSize) || 0.01,
            minPrice: parseFloat(priceFilter?.minPrice) || 0.01,
            maxPrice: parseFloat(priceFilter?.maxPrice) || 1000000,
            pricePrecision: s.quotePrecision || 2,
          };
          spotSymbolCache.set(symbol, info);
          return info;
        }
      }
    }
  } catch (err) {
    console.warn(`[ExchangeInfo] Impossible de charger les filtres pour ${symbol} sur ${market}:`, err);
  }
  return null;
}

// API: Ticker 24h market data from official Binance public endpoints
app.get('/api/market/ticker', async (req, res) => {
  const symbol = ((req.query.symbol as string) || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = (req.query.market as string) || 'spot'; // 'spot' | 'futures'

  const endpoint = market === 'futures'
    ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
    : `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const [tickerRes, filterInfo] = await Promise.all([
      fetch(endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }),
      getSymbolFilters(symbol, market as any),
    ]);
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

      const tickSize = filterInfo?.tickSize || (lastPrice < 0.1 ? 0.00001 : lastPrice < 1 ? 0.0001 : 0.01);
      const pricePrecision = filterInfo?.pricePrecision || (lastPrice < 0.1 ? 5 : lastPrice < 1 ? 4 : 2);

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
      // Binance returned an error (e.g. 400 Invalid Symbol)
      let errorMsg = `La paire ${symbol} est introuvable ou non supportée sur ${market === 'futures' ? 'Binance Futures' : 'Binance Spot'}.`;
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
  const market = (req.query.market as string) || 'spot';

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
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Crypto Edge AI Server] Démarré sur http://localhost:${PORT} (Mode: ${isProduction ? 'Production' : 'Développement'})`);
  });
}

startServer().catch((err) => {
  console.error('[Crypto Edge AI Server Fatal Error]:', err);
  process.exit(1);
});
