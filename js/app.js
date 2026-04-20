// app.js - 主程式入口

// App 命名空間，供 Onboarding 呼叫
const App = {
    initAfterOnboarding() {
        _initApp();
    }
};

// Modal 通用元件
const Modal = {
    show({ title, fields, onSubmit, afterRender }) {
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modal-title');
        const modalFields = document.getElementById('modal-fields');
        const modalForm = document.getElementById('modal-form');

        modalTitle.textContent = title;

        // 建立表單欄位
        let html = '';
        for (const field of fields) {
            if (field.type === 'html') {
                html += field.content;
                continue;
            }
            html += `<div class="form-group">`;
            html += `<label for="${field.name}">${field.label}</label>`;

            if (field.type === 'select') {
                html += `<select id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>`;
                for (const opt of field.options) {
                    const selected = opt === field.value ? 'selected' : '';
                    html += `<option value="${opt}" ${selected}>${opt}</option>`;
                }
                html += `</select>`;
            } else if (field.type === 'textarea') {
                html += `<textarea id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}>${field.value || ''}</textarea>`;
            } else {
                const step = field.step ? `step="${field.step}"` : '';
                const placeholder = field.placeholder ? `placeholder="${field.placeholder}"` : '';
                html += `<input type="${field.type}" id="${field.name}" name="${field.name}" value="${field.value || ''}" ${step} ${placeholder} ${field.required ? 'required' : ''}>`;
            }

            html += `</div>`;
        }

        modalFields.innerHTML = html;

        // 處理表單提交
        modalForm.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(modalForm);
            const data = {};
            for (const [key, value] of formData.entries()) {
                data[key] = value;
            }
            // 顯示一個處理中的狀態
            const submitBtn = modalForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '處理中...';
            submitBtn.disabled = true;
            
            try {
                await onSubmit(data);
                this.hide();
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        };

        modal.classList.add('active');

        // 呼叫 afterRender 回調
        if (afterRender) {
            afterRender();
        }
    },

    hide() {
        const modal = document.getElementById('modal');
        modal.classList.remove('active');
    }
};

// Tab 切換
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // 更新按鈕狀態
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 更新內容顯示
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Modal 關閉事件
function initModal() {
    const modal = document.getElementById('modal');
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.modal-cancel');

    closeBtn.addEventListener('click', () => Modal.hide());
    cancelBtn.addEventListener('click', () => Modal.hide());

    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            Modal.hide();
        }
    });

    // ESC 關閉
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            Modal.hide();
        }
    });
}

// 匯出/匯入功能
function initExportImport() {
    // 雲端同步
    const syncBtn = document.getElementById('sync-data');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (typeof ApiClient !== 'undefined') {
                const data = await ApiClient.fetchData();
                if (data) {
                    if (data.trades) Storage.saveTrades(data.trades);
                    if (data.netValues) Storage.saveNetValues(data.netValues);
                    
                    // 重新載入所有頁面資料
                    Portfolio.loadData();
                    Portfolio.render();
                    NetValue.loadData();
                    NetValue.render();
                    Trades.loadData();
                    Trades.render();
                    alert('同步完成！');
                }
            } else {
                alert('無法連線到同步伺服器，請稍後再試。');
            }
        });
    }

    // 匯出 JSON
    document.getElementById('export-json').addEventListener('click', () => {
        Storage.exportToJSON();
    });

    // 匯出交易紀錄 CSV
    document.getElementById('export-trades-csv').addEventListener('click', () => {
        Storage.exportTradesToCSV();
    });

    // 匯出淨值 CSV
    document.getElementById('export-netvalue-csv').addEventListener('click', () => {
        Storage.exportNetValuesToCSV();
    });

    // 匯入 JSON
    const importBtn = document.getElementById('import-json');
    const importFile = document.getElementById('import-file');

    importBtn.addEventListener('click', () => {
        importFile.click();
    });

    importFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            await Storage.importFromFile(file);
            alert('匯入成功！頁面將重新載入資料。');
            
            // 重新載入所有頁面資料
            Portfolio.loadData();
            Portfolio.render();
            NetValue.loadData();
            NetValue.render();
            Trades.loadData();
            Trades.render();
        } catch (error) {
            alert('匯入失敗：' + error.message);
        } finally {
            // 清空檔案選擇，以便可以再次選擇同一個檔案
            importFile.value = '';
        }
    });
}

// 主要初始化邏輯（onboarding 完成後呼叫）
async function _initApp() {
    // 初始化各頁面（先從 localStorage 渲染畫面，確保物件已就緒）
    Portfolio.init();
    NetValue.init();
    Trades.init();
    Settings.init();

    // 從 Google Sheet 同步資料
    if (typeof ApiClient !== 'undefined') {
        const data = await ApiClient.fetchData();
        if (data) {
            let hasUpdates = false;
            
            if (data.trades) {
                const localStr = JSON.stringify(Storage.getTrades());
                const remoteStr = JSON.stringify(data.trades);
                if (localStr !== remoteStr) {
                    Storage.saveTrades(data.trades);
                    hasUpdates = true;
                }
            }
            if (data.netValues) {
                const localStr = JSON.stringify(Storage.getNetValues());
                const remoteStr = JSON.stringify(data.netValues);
                if (localStr !== remoteStr) {
                    Storage.saveNetValues(data.netValues);
                    hasUpdates = true;
                }
            }
            if (data.settings) {
                const localStr = JSON.stringify(Storage.getPortfolioCache());
                const remoteStr = JSON.stringify(data.settings);
                if (localStr !== remoteStr) {
                    Storage.savePortfolioCache(data.settings, true);
                    hasUpdates = true;
                }
            }
            
            // 如果從雲端取得的資料與本地不同，立刻重新喧染畫面
            if (hasUpdates) {
                Portfolio.loadData();
                Portfolio.render();
                NetValue.loadData();
                NetValue.render();
                Trades.loadData();
                Trades.render();
            }
        }
    }

    // 當網頁從背景切換回前景時，自動同步資料 (Auto-Sync on Visibility)
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && typeof ApiClient !== 'undefined') {
            console.log('App is visible again, syncing data...');
            // 背景回前景的同步盡量不打斷使用者操作（不顯示全螢幕 loader）
            const data = await ApiClient.fetchData({ showLoading: false });
            if (data) {
                if (data.trades) {
                    const localStr = JSON.stringify(Storage.getTrades());
                    const remoteStr = JSON.stringify(data.trades);
                    if (localStr !== remoteStr) {
                        Storage.saveTrades(data.trades);
                        Trades.loadData();
                        Trades.render();
                        Portfolio.loadData();
                        Portfolio.render();
                    }
                }
                if (data.netValues) {
                    const localStr = JSON.stringify(Storage.getNetValues());
                    const remoteStr = JSON.stringify(data.netValues);
                    if (localStr !== remoteStr) {
                        Storage.saveNetValues(data.netValues);
                        NetValue.loadData();
                        NetValue.render();
                    }
                }
                if (data.settings) {
                    const localStr = JSON.stringify(Storage.getPortfolioCache());
                    const remoteStr = JSON.stringify(data.settings);
                    if (localStr !== remoteStr) {
                        Storage.savePortfolioCache(data.settings, true);
                        Portfolio.loadData();
                        Portfolio.render();
                    }
                }
            }
        }
    });

    // GitHub Gist 雲端同步（Phase D）
    if (typeof GistSync !== 'undefined') {
        GistSync.initialSync().catch(e => console.warn('Initial sync failed:', e.message));
    }

    console.log('股票記帳 App 已載入');
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initModal();
    initExportImport();

    // 首次使用引導；若已完成則直接初始化
    if (!Onboarding.check()) {
        // Onboarding.check() 回傳 false 表示正在顯示引導精靈，等待完成後呼叫 App.initAfterOnboarding()
        return;
    }

    _initApp();
});
