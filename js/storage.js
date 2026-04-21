// storage.js - localStorage 資料管理

const Storage = {
    KEYS: {
        TRADES: 'trading_trades',
        NETVALUE: 'trading_netvalue',
        SETTINGS: 'trading_settings',
        PORTFOLIO: 'trading_portfolio'
    },

    // 取得資料
    get(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    },

    // 儲存資料
    set(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
        // GistSync 寫入 hook（避免循環觸發）
        if (typeof GistSync !== 'undefined' && GistSync.hasToken() &&
            key !== GistSync.KEYS.LAST_SYNC && key !== GistSync.KEYS.LAST_LOCAL) {
            GistSync.markLocalChange();
            GistSync.scheduleUpload();
        }
    },

    // 交易紀錄
    getTrades() {
        return this.get(this.KEYS.TRADES) || [];
    },

    saveTrades(trades) {
        this.set(this.KEYS.TRADES, trades);
    },

    // 取得期貨每點乘數
    getFuturesMultiplier(name) {
        if (!name) return 2000; // 沒填名稱預設為個股期貨 2000
        
        const n = name.toUpperCase();
        
        // 1. 台灣指數期貨系列
        if (n.includes('微台') || n.includes('TMX') || n.includes('TMF') || n.includes('微型')) return 10;
        if (n.includes('小台') || n.includes('MTX') || n.includes('小型台')) return 50;
        if (n.includes('大台') || n.includes('台指') || n === 'TX' || n === 'FITX' || n.includes('FITX')) return 200;
        if (n.includes('電子期') || n === 'TE') return 4000;
        if (n.includes('金融期') || n === 'TF') return 1000;
        
        // 2. 個股期貨系列
        // 如果名稱有「小」或「小型」，且不是小台指，那就是小型個股期貨
        if (n.includes('小型') || (n.includes('小') && !n.includes('台'))) return 100;
        
        // 3. 預設所有未被攔截的名稱 (例如：「群創」、「耀華」、「長榮」) 均為一般個股期貨
        return 2000;
    },

    getFuturesFee(name) {
        const multiplier = this.getFuturesMultiplier(name);
        if (multiplier === 10) return 10; // 微台
        if (multiplier === 50) return 18; // 小台
        if (multiplier === 100) return 10; // 小型個股
        if (multiplier === 200) return 50; // 大台
        if (multiplier === 2000) return 18; // 一般股期
        return 50; // 預設
    },

    calculateFifoClosing(newTrade, allTrades) {
        const newTicker = (newTrade.ticker || '').trim().toUpperCase();
        // 先計算該標的「在此交易之前」的淨庫存 (正為多單，負為空單)
        const symbolTrades = [...allTrades]
            .filter(t => (t.ticker || '').trim().toUpperCase() === newTicker && t.id !== newTrade.id)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        let netPosition = 0;
        for (const t of symbolTrades) {
            const qty = parseFloat(t.quantity) || 0;
            if (t.type === '融券') {
                netPosition += (t.action === '賣' ? -qty : qty);
            } else {
                netPosition += (t.action === '買' ? qty : -qty);
            }
        }

        let isOpen = true;
        let openAction = '買'; // 當前平倉需要對應的開倉方向

        if (newTrade.type === '融券') {
            isOpen = (newTrade.action === '賣');
            openAction = '賣';
        } else if (newTrade.type === '期貨') {
            if (netPosition > 0) {
                // 如果目前是多單，賣出就是平倉
                isOpen = (newTrade.action === '買');
                openAction = '買';
            } else if (netPosition < 0) {
                // 如果目前是空單，買入就是平倉
                isOpen = (newTrade.action === '賣');
                openAction = '賣';
            } else {
                // 如果庫存為 0，買或賣都是新倉
                isOpen = true;
            }
        } else {
            // 現股、融資
            isOpen = (newTrade.action === '買');
            openAction = '買';
        }

        const isETF = newTrade.name && (newTrade.name.includes('ETF') || newTrade.name.includes('00'));
        const price = parseFloat(newTrade.price) || 0;
        const quantity = parseFloat(newTrade.quantity) || 0;
        
        let amount = 0;
        if (newTrade.type === '期貨') {
            const multiplier = this.getFuturesMultiplier(newTrade.name);
            amount = price * quantity * multiplier;
        } else {
            amount = price * quantity * 1000;
        }

        if (isOpen) {
            return { fee: 0, tax: 0, pl: "", plPercent: "" };
        } else {
            let openRecords = [];
            for (const t of symbolTrades) {
                const tQty = parseFloat(t.quantity) || 0;
                if (t.action === openAction) {
                    openRecords.push({ ...t, remainingQty: tQty });
                } else if (t.action === newTrade.action) {
                    let closeQty = tQty;
                    for (let i = 0; i < openRecords.length && closeQty > 0; i++) {
                        if (openRecords[i].remainingQty > 0) {
                            const deduct = Math.min(openRecords[i].remainingQty, closeQty);
                            openRecords[i].remainingQty -= deduct;
                            closeQty -= deduct;
                        }
                    }
                }
            }
            
            let remainingCloseQty = quantity;
            let totalBuyFee = 0;
            let totalSellFee = 0;
            let totalTax = 0;
            let totalCostAmount = 0;
            let totalInvestedAmount = 0;
            let matchCount = 0;
            
            for (let i = 0; i < openRecords.length && remainingCloseQty > 0; i++) {
                const rec = openRecords[i];
                if (rec.remainingQty > 0) {
                    const matchQty = Math.min(rec.remainingQty, remainingCloseQty);
                    const recPrice = parseFloat(rec.price) || 0;
                    
                    if (newTrade.type === '期貨') {
                        const perFee = this.getFuturesFee(rec.name);
                        totalBuyFee += (perFee * matchQty);
                        totalSellFee += (perFee * matchQty);
                        
                        const multiplier = this.getFuturesMultiplier(rec.name);
                        const recAmount = recPrice * (parseFloat(rec.quantity) || 1) * multiplier;
                        const origQty = parseFloat(rec.quantity) || 1;
                        const matchAmountOpen = origQty > 0 ? recAmount * (matchQty / origQty) : 0;
                        const matchAmountClose = quantity > 0 ? amount * (matchQty / quantity) : 0;
                        totalCostAmount += matchAmountOpen;
                        
                        const margin = parseFloat(rec.margin) || 0;
                        totalInvestedAmount += origQty > 0 ? margin * (matchQty / origQty) : 0;
                        
                        totalTax += Math.round(matchAmountOpen * 0.00002) + Math.round(matchAmountClose * 0.00002);
                    } else {
                        const matchAmountOpen = recPrice * matchQty * 1000;
                        const matchAmountClose = price * matchQty * 1000;
                        totalCostAmount += matchAmountOpen;
                        
                        const matchBuyFee = Math.max(Math.round(matchAmountOpen * 0.001425 * 0.6), 20);
                        const matchSellFee = Math.max(Math.round(matchAmountClose * 0.001425 * 0.6), 20);
                        totalBuyFee += matchBuyFee;
                        totalSellFee += matchSellFee;
                        
                        const taxRate = isETF ? 0.001 : 0.003;
                        totalTax += Math.round(matchAmountClose * taxRate);
                        
                        if (newTrade.type === '融資' || newTrade.type === '融券') {
                            const leverage = parseFloat(rec.leverage) || 2.5;
                            totalInvestedAmount += (matchAmountOpen / leverage) + (openAction === '買' ? matchBuyFee : matchSellFee);
                        } else {
                            // 現股
                            totalInvestedAmount += matchAmountOpen + (openAction === '買' ? matchBuyFee : matchSellFee);
                        }
                    }
                    
                    remainingCloseQty -= matchQty;
                    matchCount++;
                }
            }
            
            let pl = 0;
            const closeMatchAmount = quantity > 0 ? amount * ((quantity - remainingCloseQty) / quantity) : 0;
            if (openAction === '買') {
                pl = closeMatchAmount - totalCostAmount - (totalBuyFee + totalSellFee + totalTax);
            } else {
                pl = totalCostAmount - closeMatchAmount - (totalBuyFee + totalSellFee + totalTax);
            }
            
            const plPercent = totalInvestedAmount > 0 ? (pl / totalInvestedAmount) * 100 : 0;
            
            return {
                fee: totalBuyFee + totalSellFee,
                tax: totalTax,
                pl: matchCount > 0 ? Math.round(pl) : "",
                plPercent: matchCount > 0 ? Number(plPercent.toFixed(2)) : ""
            };
        }
    },

    async addTrade(trade) {
        const trades = this.getTrades();
        trade.id = Date.now().toString();

        const price = parseFloat(trade.price) || 0;
        const quantity = parseFloat(trade.quantity) || 0;
        const amount = trade.type === '期貨' ? (price * quantity * this.getFuturesMultiplier(trade.name)) : price * quantity * 1000;

        const settlement = this.calculateFifoClosing(trade, trades);

        trade.amount = amount;
        const userFee = trade.fee !== undefined && trade.fee !== '' ? parseFloat(trade.fee) : null;
        const userTax = trade.tax !== undefined && trade.tax !== '' ? parseFloat(trade.tax) : null;
        trade.fee = userFee !== null && !isNaN(userFee) ? userFee : settlement.fee;
        trade.tax = userTax !== null && !isNaN(userTax) ? userTax : settlement.tax;
        
        // 只有使用者未自填損益時，才使用自動計算的損益
        if (!trade.pl && settlement.pl !== "") trade.pl = settlement.pl;
        if (!trade.plPercent && settlement.plPercent !== "") trade.plPercent = settlement.plPercent;

        trades.unshift(trade);
        this.saveTrades(trades);

        return trade;
    },

    async updateTrade(id, updates) {
        const trades = this.getTrades();
        const index = trades.findIndex(t => t.id === id);
        if (index !== -1) {
            let updatedTrade = { ...trades[index], ...updates };

            // 重新計算金額、手續費、稅金與損益
            const price = parseFloat(updatedTrade.price) || 0;
            const quantity = parseFloat(updatedTrade.quantity) || 0;
            const amount = updatedTrade.type === '期貨' ? (price * quantity * this.getFuturesMultiplier(updatedTrade.name)) : price * quantity * 1000;

            const settlement = this.calculateFifoClosing(updatedTrade, trades);

            updatedTrade.amount = amount;
            const userFee = updatedTrade.fee !== undefined && updatedTrade.fee !== '' ? parseFloat(updatedTrade.fee) : null;
            const userTax = updatedTrade.tax !== undefined && updatedTrade.tax !== '' ? parseFloat(updatedTrade.tax) : null;
            updatedTrade.fee = userFee !== null && !isNaN(userFee) ? userFee : settlement.fee;
            updatedTrade.tax = userTax !== null && !isNaN(userTax) ? userTax : settlement.tax;
            
            // 強制自動計算的損益與損益率（前提是有配對到開倉紀錄）
            if (settlement.pl !== "") updatedTrade.pl = settlement.pl;
            if (settlement.plPercent !== "") updatedTrade.plPercent = settlement.plPercent;

            trades[index] = updatedTrade;
            this.saveTrades(trades);
        }
    },

    async deleteTrade(id) {
        const trades = this.getTrades();
        this.saveTrades(trades.filter(t => t.id !== id));
    },

    // 帳戶淨值
    getNetValues() {
        return this.get(this.KEYS.NETVALUE) || [];
    },

    saveNetValues(netValues) {
        this.set(this.KEYS.NETVALUE, netValues);
    },

    async addNetValue(entry) {
        const netValues = this.getNetValues();
        entry.id = Date.now().toString();
        netValues.unshift(entry);
        this.saveNetValues(netValues);

        return entry;
    },

    async updateNetValue(id, updates) {
        const netValues = this.getNetValues();
        const index = netValues.findIndex(n => n.id === id);
        if (index !== -1) {
            const updatedEntry = { ...netValues[index], ...updates };
            netValues[index] = updatedEntry;
            this.saveNetValues(netValues);
        }
    },

    async deleteNetValue(id) {
        const netValues = this.getNetValues();
        this.saveNetValues(netValues.filter(n => n.id !== id));
    },

    // 帳戶設定
    getSettings() {
        return this.get(this.KEYS.SETTINGS) || {
            cash: 0,
            initialCapital: 0,
            commissionRate: 0.001425,
            commissionDiscount: 0.6,
            lastUpdate: null
        };
    },

    saveSettings(settings) {
        this.set(this.KEYS.SETTINGS, settings);
    },

    // 庫存快取（含即時價格）
    getPortfolioCache() {
        return this.get(this.KEYS.PORTFOLIO) || {};
    },

    savePortfolioCache(cache) {
        this.set(this.KEYS.PORTFOLIO, cache);
    },

    // 計算買入手續費
    calculateBuyFee(price, quantity, settings) {
        const s = settings || this.getSettings();
        const FEE_RATE = s.commissionRate * s.commissionDiscount; // 手續費率 × 折扣
        const MIN_FEE = 20;             // 最低手續費 20 元（法規固定值）
        const amount = price * quantity * 1000; // 張數 * 1000 股
        return Math.max(Math.round(amount * FEE_RATE), MIN_FEE);
    },

    // 計算賣出手續費和交易稅（根據當前價格）
    calculateSellFees(price, quantity, isETF = false, settings) {
        const s = settings || this.getSettings();
        const FEE_RATE = s.commissionRate * s.commissionDiscount; // 手續費率 × 折扣
        const TAX_RATE_STOCK = 0.003;   // 股票交易稅 0.3%（法規固定值）
        const TAX_RATE_ETF = 0.001;     // ETF 交易稅 0.1%（法規固定值）
        const MIN_FEE = 20;             // 最低手續費 20 元（法規固定值）

        const amount = price * quantity * 1000; // 張數 * 1000 股
        const sellFee = Math.max(Math.round(amount * FEE_RATE), MIN_FEE);
        const taxRate = isETF ? TAX_RATE_ETF : TAX_RATE_STOCK;
        const sellTax = Math.round(amount * taxRate);
        return sellFee + sellTax;
    },

    // 從交易紀錄計算庫存
    calculatePortfolio() {
        const trades = this.getTrades();
        const holdings = {};

        // 依日期排序（舊到新），同日期再依 id（插入時間戳）排序，確保同天先買後賣順序正確
        const sortedTrades = [...trades].sort((a, b) => {
            const dateDiff = new Date(a.date) - new Date(b.date);
            if (dateDiff !== 0) return dateDiff;
            return parseInt(a.id) - parseInt(b.id);
        });

        for (const trade of sortedTrades) {
            const ticker = (trade.ticker || '').trim().toUpperCase();
            const type = trade.type || '現股';
            const isFutures = type === '期貨';
            const isMargin = type === '融資' || type === '融券';

            if (!holdings[ticker]) {
                holdings[ticker] = {
                    name: trade.name,
                    ticker: ticker,
                    shares: 0,
                    totalCost: 0,      // 自付成本（融資是自付部分，期貨是保證金）
                    totalMarketCost: 0, // 市值成本（用於計算損益）
                    totalFees: 0,
                    type: type,
                    isFutures: isFutures,
                    isMargin: isMargin,
                    leverage: parseFloat(trade.leverage) || 2.5
                };
            }

            const qty = parseFloat(trade.quantity) || 0;
            const price = parseFloat(trade.price) || 0;
            const leverage = parseFloat(trade.leverage) || 2.5;
            const margin = parseFloat(trade.margin) || 0;

            const sharesBefore = holdings[ticker].shares;
            
            // 判斷是否為新倉/加碼 (庫存絕對值增加)
            let isOpening = true;
            if (type === '融券') {
                isOpening = (trade.action === '賣');
            } else if (isFutures) {
                if (sharesBefore > 0) {
                    isOpening = (trade.action === '買');
                } else if (sharesBefore < 0) {
                    isOpening = (trade.action === '賣');
                } else {
                    isOpening = true;
                }
            } else {
                isOpening = (trade.action === '買');
            }

            // 更新實際庫存數量 (正為多單，負為空單)
            if (type === '融券') {
                holdings[ticker].shares += (trade.action === '賣' ? -qty : qty);
            } else {
                holdings[ticker].shares += (trade.action === '買' ? qty : -qty);
            }

            if (isOpening) {
                if (isFutures) {
                    holdings[ticker].totalCost += margin;
                    const multiplier = this.getFuturesMultiplier(holdings[ticker].name);
                    holdings[ticker].totalMarketCost += (price * qty * multiplier);
                } else if (isMargin) {
                    const marketValue = price * qty * 1000;
                    const selfCost = marketValue / leverage;
                    // 融券開倉(賣)或融資開倉(買)的手續費
                    const fee = (trade.action === '賣') ? this.calculateSellFees(price, qty, false) : this.calculateBuyFee(price, qty);
                    holdings[ticker].totalCost += selfCost + fee;
                    holdings[ticker].totalMarketCost += marketValue + fee;
                    holdings[ticker].totalFees += fee;
                    holdings[ticker].leverage = leverage;
                } else {
                    const buyFee = this.calculateBuyFee(price, qty);
                    holdings[ticker].totalCost += qty * price * 1000 + buyFee;
                    holdings[ticker].totalMarketCost += qty * price * 1000 + buyFee;
                    holdings[ticker].totalFees += buyFee;
                }
            } else {
                // 平倉 (庫存絕對值減少)
                const absSharesAfter = Math.abs(holdings[ticker].shares);
                const absSharesBefore = Math.abs(sharesBefore);
                
                if (absSharesAfter > 0.0001) {
                    const ratio = absSharesAfter / absSharesBefore;
                    holdings[ticker].totalCost *= ratio;
                    holdings[ticker].totalMarketCost *= ratio;
                    holdings[ticker].totalFees *= ratio;
                } else {
                    holdings[ticker].totalCost = 0;
                    holdings[ticker].totalMarketCost = 0;
                    holdings[ticker].totalFees = 0;
                    holdings[ticker].shares = 0; // 消除浮點數誤差
                }
            }

            // 更新名稱和類型
            holdings[ticker].name = trade.name;
            holdings[ticker].type = type;
            holdings[ticker].isFutures = isFutures;
            holdings[ticker].isMargin = isMargin;
        }

        // 過濾掉已清倉的，計算平均成本
        const portfolio = {};
        for (const [ticker, data] of Object.entries(holdings)) {
            // 四捨五入消除浮點誤差
            data.shares = Math.round(data.shares * 10000) / 10000;
            const absShares = Math.abs(data.shares);
            if (absShares > 0) {
                if (data.isFutures) {
                    // 期貨：成本價 = 總市值成本 / (口數 × 點數乘數)
                    const multiplier = this.getFuturesMultiplier(data.name);
                    portfolio[ticker] = {
                        ...data,
                        cost: absShares > 0 ? (data.totalMarketCost / (absShares * multiplier)) : 0,
                        selfCost: data.totalCost // 保證金
                    };
                } else {
                    // 融資/現股/融券：成本價 = 總市值成本 / (張數 × 1000)
                    portfolio[ticker] = {
                        ...data,
                        cost: data.totalMarketCost / (absShares * 1000),
                        selfCost: data.totalCost 
                    };
                }
            }
        }

        return portfolio;
    },

    // 匯出資料（JSON 格式）
    exportData() {
        return {
            trades: this.getTrades(),
            netValues: this.getNetValues(),
            settings: this.getSettings(),
            portfolio: this.getPortfolioCache(),
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
    },

    // 匯出為 JSON 檔案
    exportToJSON() {
        const data = this.exportData();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = url;
        a.download = `trading-note-backup-${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 匯出交易紀錄為 CSV
    exportTradesToCSV() {
        const trades = this.getTrades();
        if (trades.length === 0) {
            alert('沒有交易紀錄可匯出');
            return;
        }

        // CSV 標題
        const headers = ['日期', '買賣別', '股票名稱', '代號', '交易別', '數量(張)', '價格', '損益', '損益%', '原因'];
        let csv = headers.join(',') + '\n';

        // 按日期排序（舊到新）
        const sortedTrades = [...trades].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        for (const trade of sortedTrades) {
            const row = [
                trade.date || '',
                trade.action || '',
                `"${(trade.name || '').replace(/"/g, '""')}"`,
                trade.ticker || '',
                trade.type || '現股',
                trade.quantity || '',
                trade.price || '',
                trade.pl || '',
                trade.plPercent || '',
                `"${(trade.reason || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        }

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // 加入 BOM 以支援 Excel 中文
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = url;
        a.download = `trading-trades-${dateStr}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 匯出帳戶淨值為 CSV
    exportNetValuesToCSV() {
        const netValues = this.getNetValues();
        if (netValues.length === 0) {
            alert('沒有淨值紀錄可匯出');
            return;
        }

        const headers = ['日期', '淨值', '庫存水位%', '未實現損益', '出入金', '大盤收盤', '備註'];
        let csv = headers.join(',') + '\n';

        // 按日期排序（舊到新）
        const sorted = [...netValues].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        for (const entry of sorted) {
            const row = [
                entry.date || '',
                entry.netValue || '',
                entry.inventoryRatio ? (parseFloat(entry.inventoryRatio) * 100).toFixed(2) : '',
                entry.unrealizedPL || '',
                entry.cashFlow || '',
                entry.marketClose || '',
                `"${(entry.note || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        }

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = url;
        a.download = `trading-netvalue-${dateStr}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },

    calculateWinRate() {
        const settledTrades = this.getTrades().filter(trade =>
            trade.pl !== '' && trade.pl !== null && trade.pl !== undefined
        );

        let wins = 0;
        let losses = 0;
        let breakeven = 0;

        for (const trade of settledTrades) {
            const profitLoss = Number(trade.pl);
            if (Number.isNaN(profitLoss)) continue;
            if (profitLoss > 0) wins++;
            else if (profitLoss < 0) losses++;
            else breakeven++;
        }

        const total = wins + losses + breakeven;
        const decidedTrades = wins + losses;
        const winRate = decidedTrades > 0 ? (wins / decidedTrades) * 100 : 0;
        return { wins, losses, breakeven, total, winRate };
    },

    calculateAvgHoldingDays() {
        const trades = [...this.getTrades()].sort((a, b) => new Date(a.date) - new Date(b.date));
        const openQueues = {}; // ticker -> [{ date, remainingQty }]
        let totalDays = 0;
        let totalMatchedQty = 0;

        for (const trade of trades) {
            const ticker = trade.ticker;
            const type = trade.type || '現股';
            const openAction = type === '融券' ? '賣' : '買';
            const qty = parseFloat(trade.quantity) || 0;
            if (!openQueues[ticker]) openQueues[ticker] = [];

            if (trade.action === openAction) {
                openQueues[ticker].push({ date: trade.date, remainingQty: qty });
            } else {
                let closeQty = qty;
                const closeDate = new Date(trade.date);
                for (const open of openQueues[ticker]) {
                    if (open.remainingQty <= 0 || closeQty <= 0) continue;
                    const matchQty = Math.min(open.remainingQty, closeQty);
                    const days = (closeDate - new Date(open.date)) / 86400000;
                    totalDays += days * matchQty;
                    totalMatchedQty += matchQty;
                    open.remainingQty -= matchQty;
                    closeQty -= matchQty;
                }
            }
        }

        return totalMatchedQty > 0 ? totalDays / totalMatchedQty : 0;
    },

    calculateMDD() {
        const sortedNetValues = [...this.getNetValues()].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        let peak = 0;
        let maxDrawdown = 0;

        for (const entry of sortedNetValues) {
            const netValue = Number(entry.netValue) || 0;
            if (netValue > peak) peak = netValue;
            if (peak <= 0) continue;
            const drawdown = ((peak - netValue) / peak) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        return maxDrawdown;
    },

    // 匯入資料
    importData(data) {
        if (!data) {
            throw new Error('無效的資料格式');
        }

        // 驗證資料格式
        if (data.trades && Array.isArray(data.trades)) {
            this.saveTrades(data.trades);
        }
        if (data.netValues && Array.isArray(data.netValues)) {
            this.saveNetValues(data.netValues);
        }
        if (data.settings && typeof data.settings === 'object') {
            this.saveSettings(data.settings);
        }
        if (data.portfolio && typeof data.portfolio === 'object') {
            this.savePortfolioCache(data.portfolio);
        }
    },

    // 從檔案匯入 JSON
    importFromFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('請選擇檔案'));
                return;
            }

            if (!file.name.endsWith('.json')) {
                reject(new Error('請選擇 JSON 格式的檔案'));
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    this.importData(data);
                    resolve('匯入成功');
                } catch (error) {
                    reject(new Error('檔案格式錯誤：' + error.message));
                }
            };
            reader.onerror = () => reject(new Error('讀取檔案失敗'));
            reader.readAsText(file);
        });
    }
};
