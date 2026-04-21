// trades.js - 交易紀錄頁面邏輯

const Trades = {
    entries: [],

    // 台股手續費計算
    FEE_RATE: 0.001425*0.6,      // 手續費 0.1425%*0.6 0.6 是手續費打折
    TAX_RATE_STOCK: 0.003,   // 股票交易稅 0.3%
    TAX_RATE_ETF: 0.001,     // ETF 交易稅 0.1%
    MIN_FEE: 20,             // 最低手續費 20 元

    init() {
        this.loadData();
        this.filters = {
            ticker: '',
            startDate: '',
            endDate: ''
        };
        this.bindEvents();
        this.render();
    },

    loadData() {
        this.entries = Storage.getTrades();
    },

    bindEvents() {
        document.getElementById('add-trade').addEventListener('click', () => {
            this.showModal();
        });

        // 1. 綁定篩選器展開/收合按鈕
        const toggleBtn = document.getElementById('toggle-filter');
        const filterContainer = document.getElementById('filter-container');
        if (toggleBtn && filterContainer) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = filterContainer.style.display === 'none';
                filterContainer.style.display = isHidden ? 'flex' : 'none';
                toggleBtn.classList.toggle('active', isHidden);
            });
        }

        // 2. 綁定篩選器輸入事件
        const tickerFilter = document.getElementById('filter-ticker');
        const startFilter = document.getElementById('filter-start-date');
        const endFilter = document.getElementById('filter-end-date');

        if (tickerFilter) {
            tickerFilter.addEventListener('input', (e) => {
                this.filters.ticker = e.target.value.trim().toLowerCase();
                this.render();
            });
        }
        if (startFilter) {
            startFilter.addEventListener('change', (e) => {
                this.filters.startDate = e.target.value;
                this.render();
            });
        }
        if (endFilter) {
            endFilter.addEventListener('change', (e) => {
                this.filters.endDate = e.target.value;
                this.render();
            });
        }

        // 3. 綁定快速預設按鈕 (最近一週/月)
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const range = btn.getAttribute('data-range');
                const now = new Date();
                const todayStr = now.toISOString().slice(0, 10);
                
                if (range === 'all') {
                    this.filters.startDate = '';
                    this.filters.endDate = '';
                } else {
                    const days = parseInt(range);
                    const pastDate = new Date();
                    pastDate.setDate(now.getDate() - days);
                    this.filters.startDate = pastDate.toISOString().slice(0, 10);
                    this.filters.endDate = todayStr;
                }

                // 同步更新 UI 輸入框
                if (startFilter) startFilter.value = this.filters.startDate;
                if (endFilter) endFilter.value = this.filters.endDate;
                
                this.render();
            });
        });

        // 4. 點擊原因欄截斷文字 → Modal 顯示完整內容
        document.getElementById('trades-table').addEventListener('click', (e) => {
            const el = e.target.closest('.reason-text');
            if (!el || !el.title) return;
            Modal.show({
                title: '交易原因',
                fields: [{ type: 'html', content: `<p style="grid-column:1/-1;white-space:pre-wrap;line-height:1.7;margin:0;">${el.title}</p>` }],
                onSubmit: () => {},
                afterRender: () => {
                    const submitBtn = document.querySelector('#modal-form button[type="submit"]');
                    if (submitBtn) submitBtn.style.display = 'none';
                }
            });
        });
    },

    // 計算交易費用（買賣手續費和交易稅都算在買入成本）
    calculateFees(action, price, quantity, isETF = false) {
        const amount = price * quantity * 1000; // 張數 * 1000 股
        const buyFee = Math.max(Math.round(amount * this.FEE_RATE), this.MIN_FEE);
        const sellFee = Math.max(Math.round(amount * this.FEE_RATE), this.MIN_FEE);
        const taxRate = isETF ? this.TAX_RATE_ETF : this.TAX_RATE_STOCK;
        const sellTax = Math.round(amount * taxRate);

        // 買入時：計算買入手續費 + 預估賣出手續費 + 預估交易稅
        // 賣出時：只顯示實際的賣出費用
        if (action === '買') {
            return {
                buyFee: buyFee,
                total: buyFee, 
                netAmount: amount + buyFee
            };
        } else {
            return {
                buyFee: 0,
                sellFee: sellFee,
                tax: sellTax,
                total: sellFee + sellTax,
                netAmount: amount - sellFee - sellTax
            };
        }
    },

    render() {
        const tbody = document.getElementById('trades-body');
        if (!tbody) return;

        // 1. 執行篩選
        let filteredEntries = [...this.entries];
        
        if (this.filters.ticker) {
            filteredEntries = filteredEntries.filter(e => 
                (e.ticker && e.ticker.toLowerCase().includes(this.filters.ticker)) ||
                (e.name && e.name.toLowerCase().includes(this.filters.ticker))
            );
        }
        
        if (this.filters.startDate) {
            filteredEntries = filteredEntries.filter(e => e.date >= this.filters.startDate);
        }
        
        if (this.filters.endDate) {
            filteredEntries = filteredEntries.filter(e => e.date <= this.filters.endDate);
        }

        // 2. 計算彙整資訊
        let sumPL = 0;
        let sumFee = 0;
        let sumTax = 0;
        
        filteredEntries.forEach(e => {
            sumPL += parseFloat(e.pl) || 0;
            sumFee += parseFloat(e.fee) || 0;
            sumTax += parseFloat(e.tax) || 0;
        });

        // 3. 更新彙整 UI
        const plEl = document.getElementById('filter-sum-pl');
        const feeEl = document.getElementById('filter-sum-fee');
        const taxEl = document.getElementById('filter-sum-tax');
        const countEl = document.getElementById('filter-count');

        if (plEl) {
            plEl.textContent = this.formatNumber(sumPL);
            plEl.className = sumPL >= 0 ? 'positive' : 'negative';
        }
        if (feeEl) feeEl.textContent = this.formatNumber(sumFee);
        if (taxEl) taxEl.textContent = this.formatNumber(sumTax);
        if (countEl) countEl.textContent = filteredEntries.length;

        // 4. 按日期排序（新到舊）
        filteredEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

        let html = '';
        for (const entry of filteredEntries) {
            const pl = parseFloat(entry.pl) || 0;
            const plClass = pl >= 0 ? 'positive' : 'negative';
            const actionClass = entry.action === '買' ? 'positive' : 'negative';
            const type = entry.type || '現股';
            const isFutures = type === '期貨';
            const isMargin = type === '融資' || type === '融券';

            // 計算金額與顯示邏輯
            let amount, quantityDisplay;
            const price = parseFloat(entry.price) || 0;
            const quantity = parseFloat(entry.quantity) || 0;
            const fee = parseFloat(entry.fee) || 0;
            const tax = parseFloat(entry.tax) || 0;

            if (isFutures) {
                // 期貨：優先使用系統計算的金額，若無則相容舊版自填市值或重新計算
                amount = parseFloat(entry.amount) || parseFloat(entry.marketValue) || (price * quantity * (typeof Storage.getFuturesMultiplier === 'function' ? Storage.getFuturesMultiplier(entry.name) : 200));
                quantityDisplay = this.formatShares(quantity, entry.type);
            } else if (isMargin) {
                // 融資/融券：市值 = 股價 × 張數 × 1000
                amount = price * quantity * 1000;
                quantityDisplay = this.formatShares(quantity, entry.type);
            } else {
                // 現股
                amount = price * quantity * 1000;
                quantityDisplay = this.formatShares(quantity, entry.type);
            }

            html += `
                <tr data-id="${entry.id}">
                    <td>${entry.date}</td>
                    <td class="${actionClass}">${entry.action}</td>
                    <td>${entry.name}</td>
                    <td>${entry.ticker}</td>
                    <td>${type}</td>
                    <td>${quantityDisplay}</td>
                    <td>${price.toFixed(2)}</td>
                    <td>${this.formatNumber(amount)}</td>
                    <td>${fee > 0 ? this.formatNumber(fee) : '-'}</td>
                    <td>${tax > 0 ? this.formatNumber(tax) : '-'}</td>
                    <td class="${plClass}">${pl ? this.formatNumber(pl) : '-'}</td>
                    <td><div class="reason-text" title="${entry.reason || ''}">${entry.reason || ''}</div></td>
                    <td>
                        <div class="action-btns">
                            <button class="btn btn-small btn-secondary" onclick="Trades.edit('${entry.id}')">編輯</button>
                            <button class="btn btn-small btn-danger" onclick="Trades.delete('${entry.id}')">刪除</button>
                        </div>
                    </td>
                </tr>
            `;
        }

        if (!html) {
            html = '<tr><td colspan="13" class="empty-row">尚無交易紀錄，點擊「新增交易」開始</td></tr>';
        }

        tbody.innerHTML = html;

        // 更新勝率統計
        const wr = Storage.calculateWinRate();
        const wrEl = document.getElementById('trades-winrate');
        if (wrEl) {
            wrEl.textContent = (wr.wins + wr.losses) > 0 ? wr.winRate.toFixed(1) + '%' : '-';
            wrEl.className = wr.winRate >= 50 ? 'positive' : 'negative';
        }
        const winsEl = document.getElementById('trades-wins');
        const lossesEl = document.getElementById('trades-losses');
        const breakevenEl = document.getElementById('trades-breakeven');
        const totalEl = document.getElementById('trades-total-closed');
        if (winsEl) winsEl.textContent = wr.wins;
        if (lossesEl) lossesEl.textContent = wr.losses;
        if (breakevenEl) breakevenEl.textContent = wr.breakeven;
        if (totalEl) totalEl.textContent = wr.total;

        const avgHoldingEl = document.getElementById('trades-avg-holding');
        if (avgHoldingEl) {
            const avg = Storage.calculateAvgHoldingDays();
            avgHoldingEl.textContent = avg > 0 ? avg.toFixed(1) : '-';
        }
    },

    showModal(entry = null) {
        const isEdit = entry !== null;
        const today = new Date().toISOString().slice(0, 10);
        
        let displayQty = entry?.quantity || '';
        let displayUnit = '張';
        if (entry) {
            if (entry.type === '期貨') {
                displayUnit = '口';
            } else if (parseFloat(entry.quantity) < 1 && parseFloat(entry.quantity) > 0) {
                displayQty = Math.round(parseFloat(entry.quantity) * 1000);
                displayUnit = '股';
            }
        }

        Modal.show({
            title: isEdit ? '編輯交易紀錄' : '新增交易紀錄',
            fields: [
                { name: 'date', label: '日期', type: 'date', value: entry?.date || today, required: true },
                { name: 'action', label: '買賣別', type: 'select', options: ['買', '賣'], value: entry?.action || '買', required: true },
                { name: 'ticker', label: '代號 (輸入後按 Tab 自動帶名稱)', type: 'text', value: entry?.ticker || '', required: true, placeholder: '例: 2330' },
                { name: 'name', label: '股票名稱', type: 'text', value: entry?.name || '', required: true },
                { name: 'type', label: '交易別', type: 'select', options: ['現股', '融資', '融券', '期貨'], value: entry?.type || '現股' },
                { name: 'quantity', label: '數量', type: 'number', step: 'any', value: displayQty, required: true },
                { name: 'unit', label: '單位', type: 'select', options: ['張', '股', '口'], value: displayUnit },
                { name: 'price', label: '股價', type: 'number', step: '0.01', value: entry?.price || '', required: true },
                { name: 'leverage', label: '融資倍數 (如 2.5)', type: 'number', step: 'any', value: entry?.leverage || '2.5' },
                { name: 'margin', label: '保證金 (期貨用)', type: 'number', step: 'any', value: entry?.margin || '' },
                { name: 'fee', label: '手續費 (選填，覆寫自動計算)', type: 'number', step: 'any', value: entry?.fee ?? '' },
                { name: 'tax', label: '稅金 (選填，覆寫自動計算)', type: 'number', step: 'any', value: entry?.tax ?? '' },
                { name: 'feeInfo', label: '計算結果', type: 'text', value: '', readonly: true },
                { name: 'pl', label: '損益 (賣出時填寫)', type: 'number', step: 'any', value: entry?.pl || '' },
                { name: 'reason', label: '買賣原因', type: 'textarea', value: entry?.reason || '' }
            ],
            onSubmit: async (data) => {
                // 清理代號格式並轉大寫去空白
                data.ticker = (data.ticker || '').trim().toUpperCase().replace('.TW', '').replace('.TWO', '');
                if (data.name) data.name = data.name.trim();
                delete data.feeInfo; // 不儲存費用顯示欄位
                
                const rawQty = parseFloat(data.quantity) || 0;
                data.quantity = data.unit === '股' ? rawQty / 1000 : rawQty;
                delete data.unit;

                if (isEdit) {
                    await Storage.updateTrade(entry.id, data);
                } else {
                    await Storage.addTrade(data);
                }
                this.loadData();
                this.render();

                // 更新庫存頁面
                Portfolio.loadData();
                Portfolio.render();
            },
            afterRender: () => {
                const tickerInput = document.getElementById('ticker');
                const nameInput = document.getElementById('name');
                const actionSelect = document.getElementById('action');
                const typeSelect = document.getElementById('type');
                const priceInput = document.getElementById('price');
                const quantityInput = document.getElementById('quantity');
                const unitInput = document.getElementById('unit');
                const leverageInput = document.getElementById('leverage');
                const marginInput = document.getElementById('margin');
                const feeInfoInput = document.getElementById('feeInfo');
                const quantityLabel = document.querySelector('label[for="quantity"]');
                const priceLabel = document.querySelector('label[for="price"]');
                const leverageGroup = leverageInput?.parentElement;
                const marginGroup = marginInput?.parentElement;

                // 設定費用欄位為唯讀
                if (feeInfoInput) {
                    feeInfoInput.readOnly = true;
                    feeInfoInput.style.backgroundColor = '#f5f5f5';
                }
                
                // 動態更新表單欄位顯示
                const updateTypeUI = () => {
                    const isFutures = typeSelect.value === '期貨';
                    const isMarginTrade = typeSelect.value === '融資' || typeSelect.value === '融券';

                    // 更新數量標籤與股價標籤
                    if (quantityLabel) {
                        quantityLabel.textContent = '數量';
                    }
                    if (priceLabel) {
                        priceLabel.textContent = isFutures ? '成交點位' : '成交股價';
                    }
                    
                    if (unitInput) {
                        if (isFutures) {
                            unitInput.value = '口';
                            unitInput.disabled = true;
                        } else {
                            if (unitInput.value === '口') unitInput.value = '張';
                            unitInput.disabled = false;
                        }
                    }

                    // 融資倍數欄位
                    if (leverageGroup) {
                        leverageGroup.style.display = isMarginTrade ? 'block' : 'none';
                    }

                    // 期貨保證金欄位
                    if (marginGroup) {
                        marginGroup.style.display = isFutures ? 'block' : 'none';
                    }
                };

                typeSelect.addEventListener('change', () => {
                    updateTypeUI();
                    updateFeeDisplay();
                });
                updateTypeUI();

                // 代號輸入後自動帶出名稱
                const lookupStockName = async () => {
                    const ticker = tickerInput.value.trim();
                    if (!ticker) return;

                    // 如果名稱欄位已有值且不是之前自動填入的，就不覆蓋
                    const currentName = nameInput.value.trim();

                    // 先查本地台股代號對照表
                    const cleanTicker = ticker.replace('.TW', '').replace('.TWO', '');
                    if (typeof window.TaiwanStockNames !== 'undefined' && window.TaiwanStockNames[cleanTicker]) {
                        if (!currentName) {
                            nameInput.value = window.TaiwanStockNames[cleanTicker];
                        }
                        return;
                    }

                    // 嘗試從 API 查詢
                    if (!currentName) {
                        nameInput.value = '查詢中...';
                        try {
                            const quote = await StockAPI.getQuote(cleanTicker);
                            if (quote && quote.name) {
                                nameInput.value = quote.name;
                            } else {
                                nameInput.value = '';
                            }
                        } catch (e) {
                            console.log('無法查詢股票名稱:', e);
                            nameInput.value = '';
                        }
                    }
                };

                // 計算並顯示費用
                const updateFeeDisplay = () => {
                    const action = actionSelect.value;
                    const type = typeSelect.value;
                    const price = parseFloat(priceInput.value) || 0;
                    const rawQty = parseFloat(quantityInput.value) || 0;
                    const unit = unitInput ? unitInput.value : '張';
                    const quantity = unit === '股' ? rawQty / 1000 : rawQty;
                    const leverage = parseFloat(leverageInput?.value) || 2.5;
                    const margin = parseFloat(marginInput?.value) || 0;

                    if (price <= 0 || quantity <= 0) {
                        feeInfoInput.value = '';
                        return;
                    }

                    // 期貨：使用點數乘數自動計算市值，成本 = 保證金
                    if (type === '期貨') {
                        const name = nameInput.value;
                        const multiplier = typeof Storage.getFuturesMultiplier === 'function' ? Storage.getFuturesMultiplier(name) : 200;
                        const marketValue = price * quantity * multiplier;
                        const costDisplay = margin > 0 ? `保證金: ${Math.round(margin).toLocaleString()}` : '請填保證金';
                        feeInfoInput.value = `市值: ${Math.round(marketValue).toLocaleString()} | ${costDisplay}`;
                        return;
                    }

                    // 融資/融券：市值 = 股價 × 張數 × 1000，自付成本 = 市值 / 倍數
                    if (type === '融資' || type === '融券') {
                        const marketValue = price * quantity * 1000;
                        const selfCost = marketValue / leverage;
                        const fees = Trades.calculateFees(action, price, quantity);
                        feeInfoInput.value = `市值: ${Math.round(marketValue).toLocaleString()} | ${leverage}倍 | 自付: ${Math.round(selfCost).toLocaleString()} | 手續費: ${fees.total.toLocaleString()}`;
                        return;
                    }

                    // 現股
                    const fees = Trades.calculateFees(action, price, quantity);
                    const amount = price * quantity * 1000;
                    if (action === '買') {
                        feeInfoInput.value = `金額: ${Math.round(amount).toLocaleString()} | 手續費: ${(fees.buyFee || 0).toLocaleString()} | 總成本: ${fees.netAmount.toLocaleString()}`;
                    } else {
                        feeInfoInput.value = `金額: ${Math.round(amount).toLocaleString()} | 手續費: ${(fees.sellFee || 0).toLocaleString()} | 交易稅: ${(fees.tax || 0).toLocaleString()} | 實收: ${fees.netAmount.toLocaleString()}`;
                    }
                };

                // 綁定事件
                tickerInput.addEventListener('blur', lookupStockName);
                tickerInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab' || e.key === 'Enter') {
                        lookupStockName();
                    }
                });

                actionSelect.addEventListener('change', updateFeeDisplay);
                priceInput.addEventListener('input', updateFeeDisplay);
                quantityInput.addEventListener('input', updateFeeDisplay);
                if (unitInput) unitInput.addEventListener('change', updateFeeDisplay);
                if (leverageInput) leverageInput.addEventListener('input', updateFeeDisplay);
                if (marginInput) marginInput.addEventListener('input', updateFeeDisplay);

                // 初始計算
                updateFeeDisplay();
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
        if (confirm('確定要刪除這筆交易紀錄嗎？')) {
            await Storage.deleteTrade(id);
            this.loadData();
            this.render();

            // 更新庫存頁面
            Portfolio.loadData();
            Portfolio.render();
        }
    },

    formatNumber(num) {
        if (num === undefined || num === null || isNaN(num)) return '-';
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
    }
};
