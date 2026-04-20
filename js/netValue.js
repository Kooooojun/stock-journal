// netValue.js - 帳戶淨值頁面邏輯

const NetValue = {
    entries: [],
    chart: null,       // Chart.js 實例
    currentRange: 'ALL', // 圖表時間範圍：1M / 3M / 6M / YTD / 1Y / ALL

    init() {
        this.loadData();
        this.bindEvents();
        this.render();
        this.renderChart();
    },

    loadData() {
        this.entries = Storage.getNetValues();
    },

    bindEvents() {
        document.getElementById('add-netvalue').addEventListener('click', () => {
            this.showModal();
        });

        document.getElementById('calc-netvalue').addEventListener('click', () => {
            this.calculateAndShowToday();
        });

        // 資產曲線時間範圍選擇器
        document.querySelectorAll('.btn-range').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.currentRange = e.target.dataset.range;
                document.querySelectorAll('.btn-range').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                e.target.classList.add('active');
                e.target.setAttribute('aria-pressed', 'true');
                this.renderChart();
            });
        });

        // 點擊備註欄截斷文字 → Modal 顯示完整內容
        document.getElementById('netvalue-body').addEventListener('click', (e) => {
            const el = e.target.closest('.reason-text');
            if (!el || !el.title) return;
            Modal.show({
                title: '備註',
                fields: [{ type: 'html', content: `<p style="grid-column:1/-1;white-space:pre-wrap;line-height:1.7;margin:0;">${el.title}</p>` }],
                onSubmit: () => {},
                afterRender: () => {
                    const submitBtn = document.querySelector('#modal-form button[type="submit"]');
                    if (submitBtn) submitBtn.style.display = 'none';
                }
            });
        });
    },

    // 計算最新的建議淨值 (抽象出邏輯供重複使用)
    calculateSuggestedNetValue() {
        if (this.entries.length === 0) {
            return {
                latestEntry: null,
                latestNetValue: 0,
                recentRealizedPL: 0,
                currentUnrealizedPL: this.getUnrealizedPL(),
                unrealizedChange: 0,
                calculatedNetValue: 0
            };
        }

        // 取得最新一筆紀錄 (按日期排序)
        const sortedEntries = [...this.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
        const latestEntry = sortedEntries[0];
        const latestDate = new Date(latestEntry.date);
        latestDate.setHours(0, 0, 0, 0); // Normalize to midnight

        const latestNetValue = parseFloat(latestEntry.netValue) || 0;
        const latestUnrealized = parseFloat(latestEntry.unrealizedPL) || 0;

        // 計算從最新紀錄「之後」的已實現損益
        const trades = Storage.getTrades();
        let recentRealizedPL = 0;
        for (const trade of trades) {
            if (trade.action === '賣' && trade.pl) {
                const tradeDate = new Date(trade.date);
                tradeDate.setHours(0, 0, 0, 0);
                if (tradeDate > latestDate) {
                    recentRealizedPL += parseFloat(trade.pl) || 0;
                }
            }
        }

        // 計算當前的總未實現損益
        const currentUnrealizedPL = this.getUnrealizedPL();
        // 變化量 = 新的未實現 - 舊的未實現
        const unrealizedChange = currentUnrealizedPL - latestUnrealized;
        // 建議淨值 = 上次淨值 + 期間已實現 + 未實現變化量
        const calculatedNetValue = latestNetValue + recentRealizedPL + unrealizedChange;

        return {
            latestEntry,
            latestNetValue,
            recentRealizedPL,
            currentUnrealizedPL,
            unrealizedChange,
            calculatedNetValue
        };
    },

    // 計算並顯示今日淨值
    calculateAndShowToday() {
        if (this.entries.length === 0) {
            alert("尚無歷史淨值紀錄，請先新增一筆初始資金紀錄。");
            return;
        }

        const calc = this.calculateSuggestedNetValue();

        // 建立計算結果的 HTML 格式
        const realizedClass = calc.recentRealizedPL >= 0 ? 'positive' : 'negative';
        const unrealizedClass = calc.unrealizedChange >= 0 ? 'positive' : 'negative';
        const htmlMsg = `
            <div class="nv-calc-summary">
                <h4 class="nv-calc-summary__title">系統試算結果</h4>
                <div class="nv-calc-summary__grid">
                    <div class="label">對比基準日</div><div class="value">${calc.latestEntry.date}</div>
                    <div class="label">上次淨值</div><div class="value">${this.formatNumber(calc.latestNetValue)}</div>
                    <div class="label">期間已實現損益</div><div class="value ${realizedClass}">${calc.recentRealizedPL > 0 ? '+' : ''}${this.formatNumber(calc.recentRealizedPL)}</div>
                    <div class="label">未實現變化量</div><div class="value ${unrealizedClass}">${calc.unrealizedChange > 0 ? '+' : ''}${this.formatNumber(calc.unrealizedChange)}</div>
                </div>
                <div class="nv-calc-summary__highlight">
                    <div class="label">建議今日淨值</div>
                    <div class="value">${this.formatNumber(calc.calculatedNetValue)}</div>
                </div>
                <div class="nv-calc-summary__footnote">
                    ※ 若確認無誤，請點擊下方「儲存」按鈕來新增這筆紀錄。
                </div>
            </div>
        `;

        // 計算真正的歷史累計已實現損益 (為了儲存預設值)
        const totalRealizedPL = this.getRealizePL();
        
        // 直接開啟自訂 Modal，避免瀏覽器攔截原生的 confirm()
        this.showModal(null, {
            netValue: calc.calculatedNetValue,
            realizedPL: totalRealizedPL,
            unrealizedPL: calc.currentUnrealizedPL,
            htmlBreakdown: htmlMsg
        });
    },

    // 取得初始資金（取得當年度的第一筆淨值，即 1/1 資金）
    getInitialCapital() {
        if (this.entries.length === 0) return 0;
        const sorted = [...this.entries].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );
        
        const latestDate = new Date(sorted[sorted.length - 1].date);
        const currentYear = latestDate.getFullYear();
        
        const firstOfYear = sorted.find(e => new Date(e.date).getFullYear() === currentYear);
        return parseFloat(firstOfYear ? firstOfYear.netValue : sorted[0].netValue) || 0;
    },

    // 取得當年度第一筆大盤收盤價（用於計算 YTD 累計報酬）
    getInitialMarket() {
        if (this.entries.length === 0) return 0;
        const sorted = [...this.entries].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );
        
        const latestDate = new Date(sorted[sorted.length - 1].date);
        const currentYear = latestDate.getFullYear();
        
        const firstOfYear = sorted.find(e => new Date(e.date).getFullYear() === currentYear);
        return parseFloat(firstOfYear ? firstOfYear.marketClose : sorted[0].marketClose) || 0;
    },

    // 計算已實現損益（從交易紀錄中所有賣出的損益總和）
    getRealizePL() {
        const trades = Storage.getTrades();
        let totalRealizedPL = 0;

        for (const trade of trades) {
            if (trade.action === '賣' && trade.pl) {
                totalRealizedPL += parseFloat(trade.pl) || 0;
            }
        }

        return totalRealizedPL;
    },

    // 計算未實現損益（從庫存計算）
    getUnrealizedPL() {
        const holdings = Storage.calculatePortfolio();
        const prices = Storage.getPortfolioCache();

        let totalMarketValue = 0;
        let totalCost = 0;
        let totalSellFees = 0;

        for (const [ticker, holding] of Object.entries(holdings)) {
            const priceData = prices[ticker] || {};
            const shares = holding.shares || 0;
            const isFutures = holding.isFutures || holding.type === '期貨';

            // 期貨成本優先使用手動填入的值
            const cost = (isFutures && priceData.manualCost !== undefined)
                ? priceData.manualCost
                : (holding.cost || 0);
            const price = priceData.price || cost;

            if (isFutures) {
                // 期貨：需乘上點數乘數
                const multiplier = Storage.getFuturesMultiplier ? Storage.getFuturesMultiplier(holding.name) : 200;
                totalMarketValue += price * shares * multiplier;
                totalCost += cost * shares * multiplier;
            } else {
                totalMarketValue += price * shares * 1000;
                totalCost += cost * shares * 1000;
                totalSellFees += Storage.calculateSellFees(price, shares, false);
            }
        }

        return totalMarketValue - totalCost - totalSellFees;
    },

    render() {
        const tbody = document.getElementById('netvalue-body');
        const initialCapital = this.getInitialCapital();
        const unrealizedPL = this.getUnrealizedPL();

        // 使用統一推算邏輯取得當前精確淨值，避免被以往所有的出入金紀錄干擾
        const calc = this.calculateSuggestedNetValue();
        const calculatedNetValue = calc.calculatedNetValue;

        // 更新摘要顯示
        document.getElementById('nv-initial').textContent = this.formatNumber(initialCapital);
        const unrealizedEl = document.getElementById('nv-unrealized');
        unrealizedEl.textContent = this.formatNumber(unrealizedPL);
        unrealizedEl.className = 'kpi-item__value ' + (unrealizedPL >= 0 ? 'positive' : 'negative');
        document.getElementById('nv-calculated').textContent = this.formatNumber(calculatedNetValue);
        
        const dailyChange = calc.recentRealizedPL + calc.unrealizedChange;
        const dailyChangeEl = document.getElementById('nv-daily-change');
        if (dailyChangeEl) {
            dailyChangeEl.textContent = `${dailyChange >= 0 ? '+' : ''}${this.formatNumber(dailyChange)}`;
            dailyChangeEl.className = 'kpi-item__value ' + (dailyChange >= 0 ? 'positive' : 'negative');
        }

        // 使用時間加權報酬率 (TWR)：反映交易能力的累積表現
        const ytdTWR = this.calculateTWR(this.entries);
        const returnPctEl = document.getElementById('nv-return-pct');
        if (returnPctEl) {
            returnPctEl.textContent = ytdTWR.toFixed(2) + '%';
            returnPctEl.className = 'kpi-item__value ' + (ytdTWR >= 0 ? 'positive' : 'negative');
        }

        let html = '';

        // 按日期排序（新到舊）
        const sortedEntries = [...this.entries].sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        // 取得今年第一筆大盤收盤價（用於計算YTD累計報酬）
        const initialMarket = this.getInitialMarket();

        // 預計每一筆歷史時間點的 TWR 累計績效
        const ytdMap = this.calculateTWRHistory(this.entries);

        for (let i = 0; i < sortedEntries.length; i++) {
            const entry = sortedEntries[i];
            const prevEntry = sortedEntries[i + 1];

            const netValue = parseFloat(entry.netValue) || 0;
            const inventoryRatio = parseFloat(entry.inventoryRatio) || 0;
            const unrealizedPL = parseFloat(entry.unrealizedPL) || 0;
            const marketClose = parseFloat(entry.marketClose) || 0;

            // 計算與前日比較
            let dailyChange = 0;
            let marketChange = 0;
            if (prevEntry) {
                const prevNetValue = parseFloat(prevEntry.netValue) || 0;
                const cashFlow = parseFloat(entry.cashFlow) || 0;
                dailyChange = netValue - prevNetValue - cashFlow;
                
                // 計算大盤漲跌% (今日收盤 / 前日收盤 - 1)
                const prevMarketClose = parseFloat(prevEntry.marketClose) || 0;
                marketChange = prevMarketClose ? ((marketClose / prevMarketClose - 1) * 100) : 0;
            }

            // 使用上面計算好的時間加權 YTD 績效
            const vsYtdPercent = (entry.id && ytdMap.hasOwnProperty(entry.id)) ? ytdMap[entry.id] : 0;

            // 計算大盤累計報酬 (YTD)
            const marketCumulativePercent = initialMarket ? ((marketClose - initialMarket) / initialMarket * 100) : 0;

            // 計算 vs 大盤（我的累計報酬 - 大盤累計報酬）
            const vsMarketPercent = vsYtdPercent - marketCumulativePercent;

            const changeClass = dailyChange >= 0 ? 'positive' : 'negative';
            const vsYtdClass = vsYtdPercent >= 0 ? 'positive' : 'negative';
            const marketChangeClass = marketChange >= 0 ? 'positive' : 'negative';
            const marketCumulativeClass = marketCumulativePercent >= 0 ? 'positive' : 'negative';
            const vsMarketClass = vsMarketPercent >= 0 ? 'positive' : 'negative';

            html += `
                <tr data-id="${entry.id}">
                    <td>${entry.date}</td>
                    <td>${this.formatNumber(netValue)}</td>
                    <td>${(inventoryRatio * 100).toFixed(2)}%</td>
                    <td class="${unrealizedPL >= 0 ? 'positive' : 'negative'}">${this.formatNumber(unrealizedPL)}</td>
                    <td class="${changeClass}">${this.formatNumber(dailyChange)}</td>
                    <td class="${vsYtdClass}">${vsYtdPercent.toFixed(2)}%</td>
                    <td>${marketClose ? marketClose.toFixed(2) : '-'}</td>
                    <td class="${marketChangeClass}">${marketChange ? marketChange.toFixed(2) + '%' : '-'}</td>
                    <td class="${marketCumulativeClass}">${marketClose ? marketCumulativePercent.toFixed(2) + '%' : '-'}</td>
                    <td class="${vsMarketClass}">${marketClose ? vsMarketPercent.toFixed(2) + '%' : '-'}</td>
                    <td><div class="reason-text" title="${entry.note || ''}">${entry.note || ''}</div></td>
                    <td class="action-btns">
                        <button class="btn btn-small btn-secondary" onclick="NetValue.edit('${entry.id}')">編輯</button>
                        <button class="btn btn-small btn-danger" onclick="NetValue.delete('${entry.id}')">刪除</button>
                    </td>
                </tr>
            `;
        }

        if (!html) {
            html = '<tr><td colspan="12" class="empty-row">尚無淨值紀錄，點擊「新增紀錄」開始</td></tr>';
        }

        tbody.innerHTML = html;

        // 更新 MDD
        const mddEl = document.getElementById('nv-mdd');
        if (mddEl) {
            const mdd = Storage.calculateMDD();
            mddEl.textContent = mdd > 0 ? '-' + mdd.toFixed(2) + '%' : '0.00%';
        }

        // 更新圖表
        this.renderChart();
    },

    // 繪製資產曲線圖表
    renderChart() {
        const ctx = document.getElementById('netvalue-chart');
        if (!ctx) return;

        // 按日期排序（舊到新）
        let sortedEntries = [...this.entries].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
        );

        // 依照 currentRange 過濾資料
        const relativeMode = this.currentRange !== 'ALL';
        if (relativeMode) {
            const now = new Date();
            let startDate;
            if (this.currentRange === 'YTD') {
                startDate = new Date(now.getFullYear(), 0, 1);
            } else {
                const months = this.currentRange === '1Y' ? 12 : parseInt(this.currentRange);
                const originalDay = now.getDate();
                startDate = new Date(now);
                startDate.setMonth(now.getMonth() - months);
                // 避免日期溢出（如 3/31 - 1M → 3/2 而非 2/28）
                if (startDate.getDate() !== originalDay) startDate.setDate(0);
            }
            // 保留 startDate 前最後一筆作為圖表錨點（起始基準點）
            const preData = sortedEntries.filter(e => new Date(e.date) < startDate);
            const postData = sortedEntries.filter(e => new Date(e.date) >= startDate);
            sortedEntries = preData.length > 0
                ? [preData[preData.length - 1], ...postData]
                : postData;
        }

        if (sortedEntries.length === 0) return;

        const labels = sortedEntries.map(e => e.date);
        const netValues = sortedEntries.map(e => parseFloat(e.netValue) || 0);

        // 基準點：該範圍第一筆的大盤收盤價
        const rangeInitialMarket = parseFloat(sortedEntries[0].marketClose) || 0;

        // 使用預算好的歷史 TWR 資料作為圖表數據
        // relativeMode 時以傳入陣列的第一筆為 0% 基準（跨年不置零）
        const twrMap = this.calculateTWRHistory(sortedEntries, relativeMode);
        const returns = sortedEntries.map(e => twrMap[e.id] || 0);

        // 計算大盤累計%（以 rangeInitialMarket 為基準）
        const marketReturns = sortedEntries.map(e => {
            const mc = parseFloat(e.marketClose) || 0;
            return rangeInitialMarket ? ((mc - rangeInitialMarket) / rangeInitialMarket * 100) : 0;
        });

        // 如果圖表已存在，先銷毀
        if (this.chart) {
            this.chart.destroy();
        }

        // 建立新圖表
        this.chart = new Chart(ctx, {
            plugins: [{
                id: 'zeroLine',
                afterDraw(chart) {
                    const y1 = chart.scales.y1;
                    if (!y1) return;
                    const zero = y1.getPixelForValue(0);
                    const { top, bottom, left, right } = chart.chartArea;
                    if (zero < top || zero > bottom) return;
                    const c = chart.ctx;
                    c.save();
                    c.beginPath();
                    c.moveTo(left, zero);
                    c.lineTo(right, zero);
                    c.lineWidth = 1.5;
                    c.strokeStyle = '#f39c12';
                    c.setLineDash([]);
                    c.stroke();
                    c.restore();
                }
            }],
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '淨值',
                        data: netValues,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y'
                    },
                    {
                        label: '報酬率 %',
                        data: returns,
                        borderColor: '#e74c3c',
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.3,
                        yAxisID: 'y1'
                    },
                    {
                        label: '大盤 YTD %',
                        data: marketReturns,
                        borderColor: '#2ecc71',
                        backgroundColor: 'transparent',
                        borderDash: [2, 2],
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y;
                                if (label === '淨值') {
                                    return `${label}: ${Math.round(value).toLocaleString()}`;
                                } else {
                                    return `${label}: ${value.toFixed(2)}%`;
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: '日期'
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '淨值'
                        },
                        ticks: {
                            callback: function(value) {
                                return Math.round(value).toLocaleString();
                            }
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: '報酬率 %'
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toFixed(1) + '%';
                            }
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
    },

    showModal(entry = null, preCalculated = null) {
        const isEdit = entry !== null && !preCalculated;
        const today = new Date().toISOString().slice(0, 10);

        // 取得當前資料作為預設值
        let defaultNetValue = '';
        let defaultInventory = '';
        let defaultUnrealized = '';

        if (preCalculated) {
            // 使用預先計算的值
            defaultNetValue = preCalculated.netValue;
            defaultUnrealized = preCalculated.unrealizedPL;
        }

        if (!isEdit && !preCalculated) {
            // 計算各項損益
            const initialCapital = this.getInitialCapital();
            const realizedPL = this.getRealizePL();
            const unrealizedPL = this.getUnrealizedPL();

            // 淨值 = 初始資金 + 已實現損益 + 未實現損益
            defaultNetValue = Math.round(initialCapital + realizedPL + unrealizedPL);
            defaultUnrealized = Math.round(unrealizedPL);
        } else if (preCalculated) {
            defaultNetValue = Math.round(preCalculated.netValue);
            defaultUnrealized = Math.round(preCalculated.unrealizedPL);
        }

        // 計算庫存水位
        if (!isEdit) {
            const holdings = Storage.calculatePortfolio();
            const prices = Storage.getPortfolioCache();
            let totalMarketValue = 0;

            for (const [ticker, holding] of Object.entries(holdings)) {
                if (holding.shares === 0) continue; // skip closed positions

                // 嘗試多層次匹配價格快取
                let priceData = prices[ticker];
                
                // 如果找不到精確 Ticker (如 TMF036)，嘗試匹配不帶月份的 Ticker (如 TMF)
                if (!priceData) {
                    const baseTicker = ticker.replace(/[0-9]+$/, '');
                    priceData = prices[baseTicker] || {};
                }

                const shares = holding.shares || 0;
                const isFutures = holding.isFutures || holding.type === '期貨';
                const cost = (isFutures && priceData.manualCost !== undefined)
                    ? priceData.manualCost
                    : (holding.cost || 0);
                const price = priceData.price || cost;

                if (isFutures) {
                    // 期貨：price = 每口市值
                    const multiplier = Storage.getFuturesMultiplier(holding.name);
                    totalMarketValue += price * shares * multiplier;
                } else {
                    totalMarketValue += price * shares * 1000;
                }
            }

            const inventoryRaw = defaultNetValue ? (totalMarketValue / defaultNetValue) : 0;
            defaultInventory = Number(inventoryRaw.toFixed(4)); // limit decimal places for inventory
        }

        const modalFields = [];
        if (preCalculated && preCalculated.htmlBreakdown) {
            modalFields.push({ type: 'html', content: preCalculated.htmlBreakdown });
        }

        modalFields.push(
            { name: 'date', label: '日期', type: 'date', value: entry?.date || today, required: true },
            { name: 'netValue', label: '淨值 (初始資金+已實現+未實現)', type: 'number', step: 'any', value: entry?.netValue || defaultNetValue, required: true },
            { name: 'unrealizedPL', label: '未實現損益', type: 'number', step: 'any', value: entry?.unrealizedPL || defaultUnrealized },
            { name: 'inventoryRatio', label: '庫存水位 (小數，如 1.5 = 150%)', type: 'number', step: 'any', value: entry?.inventoryRatio || defaultInventory },
            { name: 'cashFlow', label: '出入金 (正=入金, 負=出金)', type: 'number', step: 'any', value: entry?.cashFlow || '' },
            { name: 'marketClose', label: '大盤收盤價', type: 'number', step: 'any', value: entry?.marketClose || '' },
            { name: 'note', label: '備註', type: 'textarea', value: entry?.note || '' }
        );

        Modal.show({
            title: isEdit ? '編輯淨值紀錄' : '系統計算結果 (請確認後儲存)',
            fields: modalFields,
            onSubmit: async (data) => {
                if (isEdit) {
                    await Storage.updateNetValue(entry.id, data);
                } else {
                    await Storage.addNetValue(data);
                }
                this.loadData();
                this.render();
            },
            afterRender: () => {
                const marketCloseInput = document.getElementById('marketClose');
                if (!marketCloseInput) return;

                // 在大盤收盤價欄位旁加入「抓取」按鈕
                const fetchBtn = document.createElement('button');
                fetchBtn.type = 'button';
                fetchBtn.textContent = '抓取大盤';
                fetchBtn.className = 'btn btn-secondary btn-small';
                fetchBtn.style.marginTop = 'var(--space-1)';

                fetchBtn.addEventListener('click', async () => {
                    fetchBtn.textContent = '抓取中...';
                    fetchBtn.disabled = true;
                    try {
                        const result = await StockAPI.getMarketIndex();
                        if (result && result.price) {
                            marketCloseInput.value = result.price.toFixed(2);
                            fetchBtn.textContent = '✓ 已更新';
                        } else {
                            fetchBtn.textContent = '抓取失敗';
                            alert('無法取得大盤資料，請手動輸入');
                        }
                    } catch (e) {
                        fetchBtn.textContent = '抓取失敗';
                        alert('無法取得大盤資料：' + e.message);
                    } finally {
                        setTimeout(() => {
                            fetchBtn.textContent = '抓取大盤';
                            fetchBtn.disabled = false;
                        }, 2000);
                    }
                });

                marketCloseInput.parentElement.appendChild(fetchBtn);
            }
        });
    },

    edit(id) {
        const entry = this.entries.find(e => e.id === id);
        if (entry) {
            this.showModal(entry);
        }
    },

    async delete(id) {
        if (confirm('確定要刪除這筆淨值紀錄嗎？')) {
            await Storage.deleteNetValue(id);
            this.loadData();
            this.render();
        }
    },

    formatNumber(num) {
        if (num === undefined || num === null || isNaN(num)) return '-';
        return Math.round(num).toLocaleString('zh-TW');
    },

    // 計算 TWR (Time-Weighted Return)
    calculateTWR(entries) {
        if (!entries || entries.length === 0) return 0;
        const sortedAsc = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        if (sortedAsc.length === 0) return 0;

        const latestDate = new Date(sortedAsc[sortedAsc.length - 1].date);
        const currentYear = latestDate.getFullYear();
        let ytdFactor = 1;
        let prevNetValue = null;

        for (const entry of sortedAsc) {
            const d = new Date(entry.date);
            if (d.getFullYear() !== currentYear) continue; // 只計當年度

            const nv = parseFloat(entry.netValue) || 0;
            const cf = parseFloat(entry.cashFlow || 0) || 0;

            if (prevNetValue === null) {
                prevNetValue = nv;
                continue;
            }

            if (prevNetValue > 0) {
                const r = (nv - cf) / prevNetValue - 1;
                ytdFactor *= (1 + r);
            }
            prevNetValue = nv;
        }

        return (ytdFactor - 1) * 100;
    },

    // 計算歷史每一點的 TWR 累計變動，返回 ID -> 累計% 的 Map
    // relativeToFirst = true 時：以傳入陣列的第一筆為 0% 基準（跨年不置零），適用於自選時間範圍模式
    // relativeToFirst = false 時：維持 YTD 邏輯，只計算最新年份（跨年置零）
    calculateTWRHistory(entries, relativeToFirst = false) {
        const ytdMap = {};
        if (!entries || entries.length === 0) return ytdMap;

        const asc = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        if (asc.length === 0) return ytdMap;

        const latestDate = new Date(asc[asc.length - 1].date);
        const currentYear = latestDate.getFullYear();
        let factor = 1;
        let prevNet = null;

        for (const entry of asc) {
            const d = new Date(entry.date);

            // YTD 模式：跨年的資料累計從 0 開始
            if (!relativeToFirst && d.getFullYear() !== currentYear) {
                ytdMap[entry.id] = 0;
                continue;
            }

            const nv = parseFloat(entry.netValue) || 0;
            const cf = parseFloat(entry.cashFlow || 0) || 0;

            if (prevNet === null) {
                // 第一筆：作為基準點，回報率為 0%
                prevNet = nv;
                ytdMap[entry.id] = 0;
                continue;
            }

            if (prevNet > 0) {
                const r = (nv - cf) / prevNet - 1;
                factor *= (1 + r);
            }
            prevNet = nv;
            ytdMap[entry.id] = (factor - 1) * 100;
        }
        return ytdMap;
    }
};
