// settings.js - 設定頁

const Settings = {
    init() {
        this._renderBasic();
        this._renderDataManagement();
        this._renderGistSync();
    },

    // 3-1 基本設定
    _renderBasic() {
        const settings = Storage.getSettings();
        const rateDisplay = ((settings.commissionRate || 0.001425) * 100).toFixed(4);
        const discountDisplay = Math.round((settings.commissionDiscount || 0.6) * 100);
        const capital = settings.initialCapital || 0;

        const section = document.getElementById('settings-basic');
        if (!section) return;

        section.innerHTML = `
            <h3 class="settings-section-title">基本設定</h3>
            <div class="settings-form">
                <div class="form-group">
                    <label for="st-capital">初始資金（元）</label>
                    <input type="number" id="st-capital" value="${capital}" min="0" step="1" placeholder="例：1000000">
                </div>
                <div class="form-group">
                    <label for="st-rate">手續費率 %</label>
                    <input type="number" id="st-rate" value="${rateDisplay}" min="0" step="0.0001" placeholder="例：0.1425">
                    <span class="settings-hint">此變更不影響已記錄的交易</span>
                </div>
                <div class="form-group">
                    <label for="st-discount">手續費折扣 %（0~100）</label>
                    <input type="number" id="st-discount" value="${discountDisplay}" min="0" max="100" step="1" placeholder="例：60">
                    <span class="settings-hint">此變更不影響已記錄的交易</span>
                </div>
                <div class="settings-form-actions">
                    <button id="st-save" class="btn btn-primary">儲存設定</button>
                    <span id="st-saved-msg" class="settings-saved-msg" style="display:none;">已儲存</span>
                </div>
            </div>`;

        document.getElementById('st-save').addEventListener('click', () => this._saveBasic());
    },

    _saveBasic() {
        const capital = parseFloat(document.getElementById('st-capital').value) || 0;
        const rate = parseFloat(document.getElementById('st-rate').value) || 0.1425;
        const discount = parseFloat(document.getElementById('st-discount').value);

        if (isNaN(discount) || discount < 0 || discount > 100) {
            alert('手續費折扣請輸入 0~100 之間的數字');
            return;
        }

        Storage.saveSettings({
            ...Storage.getSettings(),
            initialCapital: capital,
            commissionRate: rate / 100,
            commissionDiscount: discount / 100,
        });

        const msg = document.getElementById('st-saved-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2000);
    },

    // 3-2 資料管理
    _renderDataManagement() {
        const section = document.getElementById('settings-data');
        if (!section) return;

        section.innerHTML = `
            <h3 class="settings-section-title">資料管理</h3>
            <div class="settings-data-btns">
                <button id="st-export-json" class="btn btn-secondary">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    匯出 JSON
                </button>
                <button id="st-export-trades-csv" class="btn btn-secondary">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    匯出交易 CSV
                </button>
                <button id="st-export-netvalue-csv" class="btn btn-secondary">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    匯出淨值 CSV
                </button>
                <button id="st-import-json" class="btn btn-secondary">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    匯入 JSON
                </button>
                <input type="file" id="st-import-file" accept=".json" style="display:none;">
            </div>
            <div class="settings-danger-zone">
                <h4 class="settings-danger-title">危險區域</h4>
                <p class="settings-hint">以下操作無法復原，請謹慎操作。</p>
                <button id="st-clear-all" class="btn btn-danger">清除所有資料</button>
            </div>`;

        document.getElementById('st-export-json').addEventListener('click', () => Storage.exportToJSON());
        document.getElementById('st-export-trades-csv').addEventListener('click', () => Storage.exportTradesToCSV());
        document.getElementById('st-export-netvalue-csv').addEventListener('click', () => Storage.exportNetValuesToCSV());

        const importBtn = document.getElementById('st-import-json');
        const importFile = document.getElementById('st-import-file');

        importBtn.addEventListener('click', () => {
            // 二次確認
            if (!confirm('匯入 JSON 會覆蓋所有現有資料，確定繼續？')) return;
            importFile.click();
        });

        importFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await Storage.importFromFile(file);
                alert('匯入成功！頁面將重新載入。');
                location.reload();
            } catch (err) {
                alert('匯入失敗：' + err.message);
            } finally {
                importFile.value = '';
            }
        });

        document.getElementById('st-clear-all').addEventListener('click', () => this._confirmClearAll());
    },

    _confirmClearAll() {
        // 第一次確認 Modal（用原生 confirm 替代以保持簡潔）
        if (!confirm('這將清除所有交易紀錄、淨值記錄與設定，此操作無法復原。確定要繼續嗎？')) return;

        // 第二次：輸入 "DELETE" 確認
        const input = prompt('請輸入 DELETE 以確認清除所有資料：');
        if (input !== 'DELETE') {
            alert('輸入不符，操作已取消。');
            return;
        }

        // 第三次最終確認
        if (!confirm('最後確認：即將清除所有資料並重新整理頁面，確定嗎？')) return;

        // 清除 localStorage 中的應用資料
        localStorage.removeItem('trading_trades');
        localStorage.removeItem('trading_netvalue');
        localStorage.removeItem('trading_settings');
        localStorage.removeItem('trading_portfolio');

        location.reload();
    },

    // 3-3 Gist 同步（UI 骨架，Phase D 實作）
    _renderGistSync() {
        const section = document.getElementById('gist-sync-section');
        if (!section) return;

        section.innerHTML = `
            <h3 class="settings-section-title">跨裝置同步（Gist）</h3>
            <div class="settings-form">
                <div class="form-group">
                    <label for="gist-pat">GitHub Personal Access Token</label>
                    <input type="password" id="gist-pat" placeholder="ghp_..." autocomplete="off">
                </div>
                <div class="settings-form-actions">
                    <button id="gist-connect" class="btn btn-primary" onclick="alert('Gist 同步功能將在 Phase D 開放')">連接</button>
                </div>
                <div class="settings-gist-status">
                    <div class="settings-gist-row">
                        <span class="settings-gist-label">Gist ID</span>
                        <span id="gist-id-display" class="settings-gist-value">尚未連接</span>
                    </div>
                    <div class="settings-gist-row">
                        <span class="settings-gist-label">最後同步</span>
                        <span id="gist-last-sync" class="settings-gist-value">-</span>
                    </div>
                </div>
                <div class="settings-form-actions">
                    <button class="btn btn-secondary" disabled title="功能開發中">手動同步</button>
                    <button class="btn btn-secondary" disabled title="功能開發中">斷開連接</button>
                </div>
            </div>
            <div class="settings-gist-notice">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                <span>PAT 存於本地瀏覽器，不會上傳至任何伺服器。請到 GitHub Settings → Developer settings → Personal access tokens 產生，scope 只勾 <code>gist</code> 即可。遇可疑情況請隨時前往 GitHub 撤銷（Revoke）。</span>
            </div>`;
    }
};
