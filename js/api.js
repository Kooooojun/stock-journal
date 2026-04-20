// api.js - 股價 API 串接

const StockAPI = {
    // CORS Proxy 列表（依序嘗試）
    CORS_PROXIES: [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?',
        ''  // 最後嘗試直接呼叫（可能在某些環境下可用）
    ],

    async getQuote(ticker) {
        // 台股代號格式: 2330.TW (上市) 或 2330.TWO (上櫃)
        // ^ 開頭為 Yahoo Finance 指數代號（如 ^TWII），不需要加後綴
        const symbol = ticker.startsWith('^') || ticker.includes('.') ? ticker : `${ticker}.TW`;
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;

        // 依序嘗試不同的 proxy
        for (const proxy of this.CORS_PROXIES) {
            try {
                const url = proxy ? proxy + encodeURIComponent(yahooUrl) : yahooUrl;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: proxy ? {} : { 'User-Agent': 'Mozilla/5.0' }
                });

                if (!response.ok) continue;

                const data = await response.json();
                if (!data.chart || !data.chart.result) continue;

                const result = data.chart.result[0];
                const meta = result.meta;

                const currentPrice = meta.regularMarketPrice;
                const previousClose = meta.previousClose || meta.chartPreviousClose;

                // 先嘗試從本地股票名稱對照表（window.TaiwanStockNames）取得正確的中文名稱
                let fallbackName = meta.shortName || ticker;
                const baseTicker = ticker.split('.')[0];
                if (window.TaiwanStockNames && window.TaiwanStockNames[baseTicker]) {
                    fallbackName = window.TaiwanStockNames[baseTicker];
                } else if (/^[A-Za-z0-9 \.,\-\(\)]+$/.test(fallbackName)) {
                    // 若傳回之名稱全為英文且不在對照表內，才嘗試呼叫 Yahoo Search API
                    try {
                        const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&lang=zh-Hant-TW&region=TW&quotesCount=1&newsCount=0`;
                        const proxySearchUrl = proxy ? proxy + encodeURIComponent(searchUrl) : searchUrl;
                        const searchRes = await fetch(proxySearchUrl);
                        if (searchRes.ok) {
                            const searchData = await searchRes.json();
                            if (searchData.quotes && searchData.quotes.length > 0) {
                                fallbackName = searchData.quotes[0].shortname || searchData.quotes[0].longname || fallbackName;
                            }
                        }
                    } catch (err) {
                        console.log(`Fallback search failed for ${ticker}:`, err.message);
                    }
                }

                return {
                    symbol: symbol,
                    name: fallbackName,
                    price: currentPrice,
                    previousClose: previousClose,
                    change: currentPrice - previousClose,
                    changePercent: ((currentPrice - previousClose) / previousClose) * 100,
                    timestamp: new Date(meta.regularMarketTime * 1000)
                };
            } catch (error) {
                console.log(`Proxy ${proxy || 'direct'} failed for ${ticker}:`, error.message);
                continue;
            }
        }

        // 如果 .TW 失敗，嘗試 .TWO (上櫃)
        if (!ticker.includes('.TWO') && !ticker.includes('.TW')) {
            try {
                return await this.getQuote(`${ticker}.TWO`);
            } catch (e) {
                // 都失敗就返回 null
            }
        }

        return null;
    },

    // 取得台灣期交所 (TAIFEX) 即時報價
    async getFuturesQuotes(tickers) {
        const results = {};
        
        // 判斷需要抓取的種類
        const needsTMF = tickers.some(t => t.includes('微') || t.includes('TMF'));
        const needsMTX = tickers.some(t => t.includes('小') && !t.includes('股期') || t.includes('MTX'));
        const needsTX  = tickers.some(t => t.includes('大') || t === '台指期' || t.includes('TX'));
        
        // 篩選出需要抓個股期貨的代碼 (單純數字的股票代號)
        const stockFutureTickers = tickers.filter(t => /^\d+$/.test(t) || t.includes('股期'));
        const needsStockFutures = stockFutureTickers.length > 0;
        
        const fetchTaifex = async (cid, kindId = "1", rowSize = 10) => {
            try {
                const proxy = this.CORS_PROXIES[1]; // corsproxy.io usually works for POST
                const url = proxy + encodeURIComponent('https://mis.taifex.com.tw/futures/api/getQuoteList');
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        "MarketType": "0",
                        "SymbolType": "F",
                        "KindID": kindId,
                        "CID": cid,
                        "ExpireMonths": "",
                        "RowSize": rowSize,
                        "PageNo": 1,
                        "SortColumn": "",
                        "AscDesc": "A"
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.RtCode === "0" && data.RtData && data.RtData.QuoteList) {
                        return data.RtData.QuoteList;
                    }
                }
            } catch (e) {
                console.log(`Failed to fetch TAIFEX API (KindID: ${kindId}):`, e);
            }
            return null;
        };

        const parseIndexFutures = (quoteList) => {
            if (!quoteList) return null;
            const futures = quoteList.find(q => q.SymbolID && q.SymbolID.endsWith('-F'));
            if (futures) {
                return {
                    price: parseFloat(futures.CLastPrice) || parseFloat(futures.CRefPrice),
                    previousClose: parseFloat(futures.CRefPrice),
                    name: futures.DispCName,
                    timestamp: new Date().toISOString()
                };
            }
            return null;
        };

        let tmfData = null, mtxData = null, txData = null;
        let stockFuturesMap = {};

        if (needsTMF) tmfData = parseIndexFutures(await fetchTaifex('TMF', "1", 10));
        if (needsMTX) mtxData = parseIndexFutures(await fetchTaifex('MXF', "1", 10)); // 小台代號為 MXF
        if (needsTX)  txData = parseIndexFutures(await fetchTaifex('TXF', "1", 10));
        
        // 如果有需要個股期貨，抓取 KindID 4 (所有個股期貨)
        if (needsStockFutures) {
            const sfList = await fetchTaifex('', "4", 2000);
            if (sfList) {
                const relevant = sfList.filter(q => q.SymbolID && q.SymbolID.endsWith("-F"));
                for (let q of relevant) {
                    if (q.SpotID) {
                        // 如果同一個股票有多個合約，選成交量最大的或是保留第一個
                        if (!stockFuturesMap[q.SpotID] || parseInt(q.CTotalVolume || 0) > parseInt(stockFuturesMap[q.SpotID].CTotalVolume || 0)) {
                            stockFuturesMap[q.SpotID] = {
                                price: parseFloat(q.CLastPrice) || parseFloat(q.CRefPrice),
                                previousClose: parseFloat(q.CRefPrice),
                                name: q.DispCName,
                                timestamp: new Date().toISOString()
                            };
                        }
                    }
                }
            }
        }
        
        for (const ticker of tickers) {
            // 大盤指數期貨判斷
            if (ticker.includes('微') || ticker.includes('TMF')) {
                if (tmfData) results[ticker] = { ...tmfData, symbol: ticker, name: ticker }; 
            } else if ((ticker.includes('小') && !ticker.includes('股期')) || ticker.includes('MTX')) {
                if (mtxData) results[ticker] = { ...mtxData, symbol: ticker, name: ticker };
            } else if (ticker.includes('大') || ticker === '台指期' || ticker.includes('TX')) {
                if (txData) results[ticker] = { ...txData, symbol: ticker, name: ticker };
            } 
            // 個股期貨判斷 (如果只打數字代號，或者是打XXX股期)
            else if (needsStockFutures) {
                // 萃取出股票代號數字
                const match = ticker.match(/\d+/);
                if (match) {
                    const spotId = match[0];
                    if (stockFuturesMap[spotId]) {
                        results[ticker] = { ...stockFuturesMap[spotId], symbol: ticker, name: ticker };
                    }
                }
            }
        }
        
        return results;
    },

    // 批次取得多檔股票（與期貨）報價
    async getQuotes(tickers) {
        const results = {};
        const stockTickers = [];
        const futuresTickers = [];

        // 分類股票與期貨
        for (const ticker of tickers) {
            let isFutures = false;
            if (typeof Storage !== 'undefined') {
                const holding = Storage.getPortfolioCache()[ticker];
                // 如果來源標記為 manual，或是 holding.isFutures 為 true (儲存在本機的 trades)
                // 但因為 getQuotes 通常是在呼叫前只給 ticker，我們先依賴快取的 name 來看
                const name = holding?.name || ticker;
                if (holding?.source === 'manual' || name.includes('期') || name.includes('指') || isNaN(parseInt(ticker.charAt(0)))) {
                    isFutures = true;
                }
                
                // 更準確地依據 Storage.getTrades() 來判斷是否持有該股票的期貨
                const trades = Storage.getTrades().filter(t => t.ticker === ticker && t.type === '期貨');
                if (trades.length > 0) {
                    isFutures = true;
                }
            } else {
                isFutures = isNaN(parseInt(ticker.charAt(0)));
            }
                
            if (isFutures) {
                futuresTickers.push(ticker);
            } else {
                stockTickers.push(ticker);
            }
        }

        // 處理期貨報價
        if (futuresTickers.length > 0) {
            const futuresResults = await this.getFuturesQuotes(futuresTickers);
            Object.assign(results, futuresResults);
        }

        // 處理股票報價：並行請求，但限制同時數量
        const batchSize = 5;
        for (let i = 0; i < stockTickers.length; i += batchSize) {
            const batch = stockTickers.slice(i, i + batchSize);
            const promises = batch.map(ticker => this.getQuote(ticker));
            const batchResults = await Promise.all(promises);

            batch.forEach((ticker, index) => {
                if (batchResults[index]) {
                    results[ticker] = batchResults[index];
                }
            });

            // 避免請求過快
            if (i + batchSize < stockTickers.length) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        return results;
    },

    // 搜尋股票（根據代號或名稱）
    async searchStock(query) {
        // 如果查詢是純數字（股票代號），直接使用新 API 查詢
        const cleanQuery = query.trim();
        const isNumeric = /^\d+$/.test(cleanQuery);
        
        if (isNumeric) {
            // 嘗試上市（tse）和上櫃（otc）
            const markets = ['tse', 'otc'];
            const results = [];
            
            for (const market of markets) {
                try {
                    const proxyBase = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.STOCK_QUOTE_PROXY_URL) ? APP_CONFIG.STOCK_QUOTE_PROXY_URL : '';
                    if (!proxyBase) break; // 沒設定 proxy 就跳過，由下方 Yahoo Finance 備用
                    const url = `${proxyBase}/quote?symbol=${cleanQuery}&market=${market}`;
                    const response = await fetch(url);
                    
                    if (response.ok) {
                        const data = await response.json();
                        // 如果 API 返回成功，將結果加入
                        if (data && data.symbol) {
                            let chineseName = data.name || data.symbol || cleanQuery;
                            if (window.TaiwanStockNames && window.TaiwanStockNames[cleanQuery]) {
                                chineseName = window.TaiwanStockNames[cleanQuery];
                            }

                            results.push({
                                symbol: data.symbol || `${cleanQuery}.${market === 'tse' ? 'TW' : 'TWO'}`,
                                name: chineseName,
                                type: market === 'tse' ? '上市' : '上櫃'
                            });
                        }
                    }
                } catch (error) {
                    console.log(`Search ${market} failed for ${cleanQuery}:`, error.message);
                    continue;
                }
            }
            
            if (results.length > 0) {
                return results;
            }
        }
        
        // 如果不是純數字或新 API 查詢失敗，使用 Yahoo Finance 作為備用
        const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;

        for (const proxy of this.CORS_PROXIES) {
            try {
                const url = proxy ? proxy + encodeURIComponent(yahooUrl) : yahooUrl;
                const response = await fetch(url);

                if (!response.ok) continue;

                const data = await response.json();

                // 過濾台股
                return (data.quotes || [])
                    .filter(q => q.symbol && (q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO')))
                    .map(q => ({
                        symbol: q.symbol,
                        name: q.shortname || q.longname || q.symbol,
                        type: q.typeDisp
                    }));
            } catch (error) {
                console.log(`Search proxy ${proxy || 'direct'} failed:`, error.message);
                continue;
            }
        }
        return [];
    },

    // 抓取台灣加權指數（^TWII）收盤價
    async getMarketIndex() {
        // range=5d + 時間戳記參數：確保取到最近收盤價，並防止 CORS proxy 快取舊資料
        const ts = Math.floor(Date.now() / 60000);
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=5d&_=${ts}`;

        for (const proxy of this.CORS_PROXIES) {
            try {
                const url = proxy ? proxy + encodeURIComponent(yahooUrl) : yahooUrl;
                const response = await fetch(url);
                if (!response.ok) continue;

                const data = await response.json();
                if (!data.chart || !data.chart.result) continue;

                const result = data.chart.result[0];
                const meta = result.meta;

                // indicators.quote[0].close 是官方每日收盤價，比 regularMarketPrice 準確：
                // 台股收盤後需幾分鐘才結算收盤競價，regularMarketPrice 在此期間可能還是盤中價
                const closes = result.indicators?.quote?.[0]?.close || [];
                const timestamps = result.timestamp || [];

                let price = null;
                let priceTimestamp = null;
                for (let i = closes.length - 1; i >= 0; i--) {
                    if (closes[i] != null) { // != null 同時涵蓋 undefined（sparse array）
                        price = closes[i];
                        priceTimestamp = new Date(timestamps[i] * 1000);
                        break;
                    }
                }

                if (price == null) { // fallback：closes 無資料時使用 regularMarketPrice
                    price = meta.regularMarketPrice;
                    priceTimestamp = new Date(meta.regularMarketTime * 1000);
                }

                return {
                    price,
                    previousClose: meta.previousClose || meta.chartPreviousClose,
                    timestamp: priceTimestamp
                };
            } catch (error) {
                console.log(`Market index fetch failed (proxy: ${proxy || 'direct'}):`, error.message);
                continue;
            }
        }
        return null;
    },

    // 備用方案：使用證交所 API（需要後端 proxy 處理 CORS）
    async getTWSEQuote(ticker) {
        // 這個 API 有 CORS 限制，需要後端代理
        // 這裡僅作為參考
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${today}&stockNo=${ticker}`;

        try {
            const response = await fetch(url);
            const data = await response.json();
            // 處理回傳資料...
            return data;
        } catch (error) {
            console.error('TWSE API error:', error);
            return null;
        }
    }
};

// 簡易的模擬資料（當 API 無法使用時）
const MockStockData = {
    // 示範資料：台積電
    '2330': { name: '台積電', price: 1000, previousClose: 990 }
};
