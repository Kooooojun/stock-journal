// portfolio.js - 庫存頁面邏輯

const Portfolio = {
    holdings: {},
    prices: {},

    init() {
        this.loadData();
        this.bindEvents();
        this.render();
    },

    loadData() {
        this.holdings = Storage.calculatePortfolio();
        this.prices = Storage.getPortfolioCache();

        // 套用期貨手動設定的成本
        for (const [ticker, priceData] of Object.entries(this.prices)) {
            if (priceData.manualCost !== undefined && this.holdings[ticker]) {
                this.holdings[ticker].cost = priceData.manualCost;
            }
        }
    },

    bindEvents() {
        document.getElementById('refresh-prices').addEventListener('click', () => {
            this.refreshPrices();
        });
    },

    // 從帳戶淨值取得 Total AUM（最新一筆）
    getTotalAUM() {
        const netValues = Storage.getNetValues();
        if (netValues.length === 0) return 0;

        // 按日期排序（新到舊）
        const sorted = [...netValues].sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );
        return parseFloat(sorted[0].netValue) || 0;
    },

    // 從帳戶淨值取得初始資金（第一筆）
    getInitialCapital() {
        const netValues = Storage.getNetValues();
        if (netValues.length === 0) return 0;

        // 按日期排序（舊到新）
        const sorted = [...netValues].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );
        return parseFloat(sorted[0].netValue) || 0;
    },

    async refreshPrices() {
        const btn = document.getElementById('refresh-prices');
        btn.innerHTML = '<span class="spinner"></span>更新中...';
        btn.disabled = true;

        const tickers = Object.keys(this.holdings);

        if (tickers.length === 0) {
            btn.innerHTML = '更新股價';
            btn.disabled = false;
            return;
        }

        try {
            // 嘗試使用真實 API
            const quotes = await StockAPI.getQuotes(tickers);

            // 更新價格快取
            for (const [ticker, quote] of Object.entries(quotes)) {
                if (quote && quote.price) {
                    this.prices[ticker] = {
                        price: quote.price,
                        previousClose: quote.previousClose,
                        name: quote.name,
                        timestamp: new Date().toISOString(),
                        source: 'api'
                    };
                }
            }

            // 標記搜不到價格的股票
            for (const ticker of tickers) {
                if (!this.prices[ticker] || !this.prices[ticker].price) {
                    // 保留手動設定的價格
                    if (this.prices[ticker]?.source === 'manual') continue;

                    this.prices[ticker] = {
                        price: NaN,
                        previousClose: NaN,
                        name: this.holdings[ticker]?.name || ticker,
                        timestamp: new Date().toISOString(),
                        source: 'notfound'
                    };
                }
            }

            Storage.savePortfolioCache(this.prices);
            this.render();
        } catch (error) {
            console.error('Price refresh error:', error);
            alert('更新股價失敗，請稍後再試');
        }

        btn.innerHTML = '更新股價';
        btn.disabled = false;
    },

    render() {
        this.renderTable();
        this.renderSummary();
    },

    // 計算賣出手續費和交易稅（根據當前價格）
    calculateSellFees(price, quantity, isETF = false) {
        return Storage.calculateSellFees(price, quantity, isETF);
    },

    renderTable() {
        const tbody = document.getElementById('portfolio-body');
        const totalAUM = this.getTotalAUM();

        let html = '';

        for (const [ticker, holding] of Object.entries(this.holdings)) {
            const priceData = this.prices[ticker] || {};
            const shares = holding.shares || 0;
            const type = holding.type || '現股';
            const isFutures = holding.isFutures || type === '期貨';
            const isMargin = holding.isMargin || type === '融資' || type === '融券';

            // 期貨成本優先使用手動填入的值
            const cost = (isFutures && priceData.manualCost !== undefined)
                ? priceData.manualCost
                : (holding.cost || 0); // 在新邏輯下，holding.cost 是平均成本點位
            const price = priceData.price; // price 是目前的點位
            const previousClose = priceData.previousClose;

            // 檢查價格是否有效
            const hasValidPrice = price && !isNaN(price);
            const hasValidPrevClose = previousClose && !isNaN(previousClose);

            // 計算各項數值
            let marketValue, pl, change, changePercent, vsCostPercent, portfolioPercent;
            let priceDisplay, prevCloseDisplay;

            if (hasValidPrice) {
                if (isFutures) {
                    // 期貨：price 是每口現值點位，cost 是每口平均成本點位
                    const multiplier = Storage.getFuturesMultiplier(holding.name);
                    marketValue = price * shares * multiplier;
                    const costValue = cost * shares * multiplier;
                    pl = marketValue - costValue;
                } else {
                    // 股票/融資：乘以 1000
                    marketValue = price * shares * 1000;
                    const costValue = cost * shares * 1000;
                    const sellFees = this.calculateSellFees(price, shares);
                    pl = marketValue - costValue - sellFees;
                }
                vsCostPercent = cost ? ((price - cost) / cost * 100) : 0;
                portfolioPercent = totalAUM ? (marketValue / totalAUM * 100) : 0;
                priceDisplay = price.toFixed(2);

                if (hasValidPrevClose) {
                    const priceDiff = price - previousClose;
                    if (isFutures) {
                        const multiplier = Storage.getFuturesMultiplier(holding.name);
                        change = priceDiff * shares * multiplier;
                    } else if (isMargin) {
                        change = priceDiff * shares * 1000;
                    } else {
                        change = priceDiff * shares * 1000;
                    }
                    changePercent = (priceDiff / previousClose) * 100;
                    prevCloseDisplay = previousClose.toFixed(2);
                } else {
                    change = NaN;
                    changePercent = NaN;
                    prevCloseDisplay = 'NaN';
                }
            } else {
                marketValue = NaN;
                pl = NaN;
                change = NaN;
                changePercent = NaN;
                vsCostPercent = NaN;
                portfolioPercent = NaN;
                priceDisplay = 'NaN';
                prevCloseDisplay = 'NaN';
            }

            const changeClass = !isNaN(change) && change >= 0 ? 'positive' : 'negative';
            const plClass = !isNaN(pl) && pl >= 0 ? 'positive' : 'negative';
            const priceClass = !hasValidPrice ? 'warning' : '';

            // 單位顯示
            const unitDisplay = this.formatShares(shares, type);

            // 類型標籤
            let typeLabel = '';
            if (isFutures) typeLabel = ' <small>(期)</small>';
            else if (isMargin) typeLabel = ` <small>(${type})</small>`;

            // 成本顯示
            const hasFuturesCost = isFutures && priceData.manualCost !== undefined;
            const costDisplay = (isFutures && !hasFuturesCost) ? '<span class="warning">請編輯</span>' : cost.toFixed(2);
            const costClass = (isFutures && !hasFuturesCost) ? 'warning' : '';

            html += `
                <tr data-ticker="${ticker}">
                    <td>${holding.name || ticker}${typeLabel}</td>
                    <td>${ticker}</td>
                    <td>${isNaN(portfolioPercent) ? 'NaN' : portfolioPercent.toFixed(2) + '%'}</td>
                    <td>${unitDisplay}</td>
                    <td class="${changeClass}">${isNaN(changePercent) ? 'NaN' : changePercent.toFixed(2) + '%'}</td>
                    <td class="${changeClass}">${isNaN(change) ? 'NaN' : change.toFixed(2)}</td>
                    <td>${isNaN(marketValue) ? 'NaN' : this.formatNumber(marketValue)}</td>
                    <td class="${plClass}">${isNaN(pl) ? 'NaN' : this.formatNumber(pl)}</td>
                    <td class="${priceClass}">${priceDisplay}</td>
                    <td class="${costClass}">${costDisplay}</td>
                    <td>${prevCloseDisplay}</td>
                    <td class="${!isNaN(vsCostPercent) && vsCostPercent >= 0 ? 'positive' : 'negative'}">${isNaN(vsCostPercent) ? 'NaN' : vsCostPercent.toFixed(2) + '%'}</td>
                    <td class="action-btns">
                        <button class="btn btn-small btn-secondary" onclick="Portfolio.editHolding('${ticker}')">編輯</button>
                    </td>
                </tr>
            `;
        }

        if (!html) {
            html = '<tr><td colspan="13" class="empty-row">尚無持股，請在「交易紀錄」新增買入紀錄</td></tr>';
        }

        tbody.innerHTML = html;
    },

    renderSummary() {
        const totalAUM = this.getTotalAUM();
        const initialCapital = this.getInitialCapital();

        let totalMarketValue = 0;
        let totalCost = 0;
        let totalSellFees = 0;
        let hasInvalidPrice = false;

        for (const [ticker, holding] of Object.entries(this.holdings)) {
            const priceData = this.prices[ticker] || {};
            const price = priceData.price;
            const shares = holding.shares || 0;
            const isFutures = holding.isFutures || holding.type === '期貨';

            // 期貨成本優先使用手動填入的值
            const cost = (isFutures && priceData.manualCost !== undefined)
                ? priceData.manualCost
                : (holding.cost || 0);

            // 檢查價格是否有效
            if (!price || isNaN(price)) {
                hasInvalidPrice = true;
                // 使用成本價當作暫時計算現值
                if (isFutures) {
                    const multiplier = Storage.getFuturesMultiplier(holding.name);
                    totalMarketValue += cost * shares * multiplier;
                } else {
                    totalMarketValue += cost * shares * 1000;
                }
            } else {
                if (isFutures) {
                    // 期貨：price = 最新點位，需乘上 multiplier
                    const multiplier = Storage.getFuturesMultiplier(holding.name);
                    totalMarketValue += price * shares * multiplier;
                } else {
                    // 股票：乘以 1000，計算手續費
                    totalMarketValue += price * shares * 1000;
                    totalSellFees += this.calculateSellFees(price, shares);
                }
            }

            if (isFutures) {
                // 期貨：cost = 平均成本點位，需乘上 multiplier 獲得總成本市值
                const multiplier = Storage.getFuturesMultiplier(holding.name);
                totalCost += cost * shares * multiplier;
            } else {
                totalCost += cost * shares * 1000;
            }
        }

        // 未實現損益 = 市值 - 成本 - 賣出手續費和交易稅
        const totalUnrealized = totalMarketValue - totalCost - totalSellFees;
        const exposure = totalAUM ? (totalMarketValue / totalAUM) : 0;
        const usedCapital = totalAUM ? (totalCost / totalAUM) : 0;

        // 如果有無效價格，在數字後加上警告標記
        const warnSuffix = hasInvalidPrice ? ' *' : '';

        // 更新部位摘要
        document.getElementById('sum-long').textContent = this.formatNumber(totalMarketValue) + warnSuffix;
        document.getElementById('sum-short').textContent = '0';
        document.getElementById('sum-gross').textContent = this.formatNumber(totalMarketValue) + warnSuffix;
        document.getElementById('sum-net').textContent = this.formatNumber(totalMarketValue) + warnSuffix;

        // 更新資金狀況
        document.getElementById('sum-aum').textContent = this.formatNumber(totalAUM);
        document.getElementById('sum-market').textContent = this.formatNumber(totalMarketValue) + warnSuffix;
        document.getElementById('sum-cost').textContent = this.formatNumber(totalCost);
        // 未實現損益 = 市值 - 成本 - 賣出手續費和交易稅（已扣手續費）
        const sumUnrealizedEl = document.getElementById('sum-unrealized');
        sumUnrealizedEl.textContent = this.formatNumber(totalUnrealized) + warnSuffix;
        sumUnrealizedEl.className = totalUnrealized >= 0 ? 'positive' : 'negative';
        document.getElementById('sum-initial').textContent = this.formatNumber(initialCapital);

        // 更新曝險比例
        document.getElementById('sum-exposure').textContent = (exposure * 100).toFixed(2) + '%' + warnSuffix;
        document.getElementById('sum-used').textContent = (usedCapital * 100).toFixed(2) + '%';

        // 更新風險計算表
        const percentages = [0.05, 0.08, 0.10, 0.12, 0.15, 0.20];
        percentages.forEach(p => {
            const id = `risk-${Math.round(p * 100)}`;
            document.getElementById(id).textContent = this.formatNumber(totalAUM * p);
        });
    },

    editHolding(ticker) {
        const holding = this.holdings[ticker];
        if (!holding) return;

        const isFutures = holding.isFutures || holding.type === '期貨';
        const priceData = this.prices[ticker] || {};
        const currentPrice = priceData.price && !isNaN(priceData.price) ? priceData.price : '';
        const currentPrevClose = priceData.previousClose && !isNaN(priceData.previousClose) ? priceData.previousClose : '';
        const currentCost = holding.cost || '';

        if (isFutures) {
            // 期貨：編輯現價、成本、前日收盤價（都是點位）
            Modal.show({
                title: `編輯期貨 ${holding.name} (${ticker})`,
                fields: [
                    { name: 'price', label: '目前點位', type: 'number', step: 'any', value: currentPrice, required: true },
                    { name: 'cost', label: '平均成本點位', type: 'number', step: 'any', value: currentCost, required: true },
                    { name: 'previousClose', label: '前日收盤點位', type: 'number', step: 'any', value: currentPrevClose, required: true },
                    { name: 'info', label: '說明', type: 'text', value: '系統會自動依合約種類轉換為正確金錢價值', readonly: true }
                ],
                onSubmit: (data) => {
                    const price = parseFloat(data.price);
                    const cost = parseFloat(data.cost);
                    const previousClose = parseFloat(data.previousClose);

                    if (isNaN(price) || isNaN(cost) || isNaN(previousClose)) {
                        alert('請輸入有效的數字');
                        return;
                    }

                    // 更新價格快取（包含手動設定的成本）
                    this.prices[ticker] = {
                        price: price,
                        previousClose: previousClose,
                        manualCost: cost, // 保存手動設定的成本
                        name: holding.name,
                        timestamp: new Date().toISOString(),
                        source: 'manual'
                    };

                    // 更新內存中的成本
                    this.holdings[ticker].cost = cost;

                    Storage.savePortfolioCache(this.prices);
                    this.render();
                }
            });
        } else {
            // 股票：只能編輯現價、前日收盤價
            Modal.show({
                title: `編輯 ${holding.name} (${ticker})`,
                fields: [
                    { name: 'price', label: '現價', type: 'number', step: 'any', value: currentPrice, required: true },
                    { name: 'previousClose', label: '前日收盤價', type: 'number', step: 'any', value: currentPrevClose, required: true },
                    { name: 'info', label: '說明', type: 'text', value: '庫存張數由交易紀錄計算，如需修改請到「交易紀錄」', readonly: true }
                ],
                onSubmit: (data) => {
                    const price = parseFloat(data.price);
                    const previousClose = parseFloat(data.previousClose);

                    if (isNaN(price) || isNaN(previousClose)) {
                        alert('請輸入有效的數字');
                        return;
                    }

                    this.prices[ticker] = {
                        price: price,
                        previousClose: previousClose,
                        name: holding.name,
                        timestamp: new Date().toISOString(),
                        source: 'manual'
                    };

                    Storage.savePortfolioCache(this.prices);
                    this.render();
                }
            });
        }
    },

    formatNumber(num) {
        if (num === undefined || num === null) return '-';
        return Math.round(num).toLocaleString('zh-TW');
    },

    // 格式化張數（支援零股與期貨顯示）
    formatShares(shares, type) {
        const num = parseFloat(shares) || 0;
        if (num === 0) return '0';
        
        const sign = num < 0 ? '-' : '';
        const absNum = Math.abs(num);
        
        if (type === '期貨') {
            return `${sign}${Number.isInteger(absNum) ? absNum : parseFloat(absNum.toFixed(3))} 口`;
        }
        
        const zhang = Math.floor(absNum);
        const gu = Math.round((absNum - zhang) * 1000);
        
        if (zhang === 0) return `${sign}${gu} 股`;
        if (gu === 0) return `${sign}${zhang} 張`;
        return `${sign}${zhang}張 ${gu}股`;
    },

    showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2c3e50;color:white;padding:12px 24px;border-radius:4px;z-index:9999;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
};
