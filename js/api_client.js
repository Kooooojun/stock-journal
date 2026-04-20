// api_client.js - 處理與 Google Sheet API 的連線

const API_URL = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.GAS_API_URL) ? APP_CONFIG.GAS_API_URL : '';

// 將 ISO UTC 日期字串（如 2026-03-09T16:00:00.000Z）轉換為本地 YYYY-MM-DD
function normalizeDate(dateStr) {
    if (!dateStr) return dateStr;
    // 已經是 YYYY-MM-DD 格式就直接回傳
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // ISO 字串或其他格式：用 Date 物件轉為本地日期
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const ApiClient = {
    // 顯示載入中提示
    showLoading(text = '同步資料中...') {
        let loader = document.getElementById('api-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'api-loader';
            loader.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.7); z-index: 9999; display: flex; justify-content: center; align-items: center; flex-direction: column;">
                    <div style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
                    <div id="api-loader-text" style="margin-top: 10px; font-weight: bold; color: #333;">同步資料中...</div>
                    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                </div>
            `;
            document.body.appendChild(loader);
        }
        const textEl = document.getElementById('api-loader-text');
        if (textEl) textEl.textContent = text;
        loader.style.display = 'flex';
    },

    hideLoading() {
        const loader = document.getElementById('api-loader');
        if (loader) loader.style.display = 'none';
    },

    // 取得所有資料
    async fetchData(options = {}) {
        const { showLoading = true, timeoutMs = 15000 } = options || {};
        if (showLoading) this.showLoading('同步資料中...');
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(API_URL, { signal: controller.signal });
            clearTimeout(timer);
            const result = await response.json();

            if (result.status === 'success') {
                const raw = result.data || result;
                console.log('GAS API 回傳 keys:', Object.keys(raw));

                // 統一 key 名稱（相容不同版本的 GAS 腳本）
                const data = {
                    trades: raw.trades || raw.transactions || [],
                    netValues: raw.netValues || raw.netValueHistory || raw.netWorth || [],
                    settings: raw.settings || null
                };

                // 正規化所有日期欄位與修復舊版 API 缺少的欄位
                data.trades.forEach(t => { 
                    if (t.date) t.date = normalizeDate(t.date); 
                    
                    // Fallback: 如果後端舊版 GAS 沒回傳 amount，前端自動補算
                    if (t.amount === undefined) {
                        const price = parseFloat(t.price) || 0;
                        const quantity = parseFloat(t.quantity) || 0;
                        if (t.type === '期貨') {
                            const multiplier = (typeof Storage !== 'undefined') ? Storage.getFuturesMultiplier(t.name) : 200;
                            t.amount = price * quantity * multiplier;
                        } else {
                            t.amount = price * quantity * 1000;
                        }
                    }
                    if (t.fee === undefined) t.fee = 0;
                    if (t.tax === undefined) t.tax = 0;
                });
                data.netValues.forEach(n => { if (n.date) n.date = normalizeDate(n.date); });

                return data;
            } else {
                throw new Error(result.message || '取得資料失敗');
            }
        } catch (error) {
            console.error('API Fetch Error:', error);
            alert('無法從 Google Sheet 取得資料，將載入本機資料。');
            return null;
        } finally {
            if (showLoading) this.hideLoading();
        }
    },

    // 寫入/更新/刪除單筆資料
    async mutateData(sheetName, method, rowData = [], id = null, rowIndex = null, options = {}) {
        const { showLoading = true, timeoutMs = 15000, loadingText } = options || {};
        if (showLoading) this.showLoading(loadingText || '同步資料中...');
        try {
            const payload = {
                sheetName: sheetName,
                method: method,
                rowData: rowData,
                id: id,
                rowIndex: rowIndex
            };

            if (method === 'updateSettings') {
                payload.payload = rowData; // 將 JSON payload 塞給 GAS
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                     "Content-Type": "text/plain;charset=utf-8",
                },
                signal: controller.signal
            });
            clearTimeout(timer);

            const result = await response.json();

            if (result.status !== 'success') {
                throw new Error(result.message || '操作失敗');
            }
            // 回傳完整結果物件，讓呼叫端可取得 rowIndex 等附加資料
            return result;
        } catch (error) {
            console.error('API Mutate Error:', error);
            alert('同步至 Google Sheet 失敗: ' + error.message);
            return false;
        } finally {
            if (showLoading) this.hideLoading();
        }
    },

    // 透過 GAS 伺服器端取得大盤指數（繞過 CORS 限制）
    async fetchIndexQuote(ticker = '^TWII') {
        try {
            const url = `${API_URL}?action=getIndexQuote&ticker=${encodeURIComponent(ticker)}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const result = await response.json();
            if (result.status === 'success' && result.data) {
                return result.data;
            }
            return null;
        } catch (e) {
            console.log('GAS fetchIndexQuote failed:', e.message);
            return null;
        }
    }
};
