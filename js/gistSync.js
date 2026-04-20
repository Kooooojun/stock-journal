// gistSync.js - GitHub Gist 雲端同步

const GistSync = {
    KEYS: {
        TOKEN: 'trading_gist_token',
        GIST_ID: 'trading_gist_id',
        LAST_SYNC: 'trading_gist_last_sync',
        LAST_LOCAL: 'trading_gist_last_local'
    },

    _debounceTimer: null,
    _appVersion: '1.0',

    // --- Token / ID helpers ---

    hasToken() {
        return !!localStorage.getItem(this.KEYS.TOKEN);
    },

    getToken() {
        return localStorage.getItem(this.KEYS.TOKEN);
    },

    setToken(t) {
        localStorage.setItem(this.KEYS.TOKEN, t);
    },

    clearToken() {
        localStorage.removeItem(this.KEYS.TOKEN);
    },

    getGistId() {
        return localStorage.getItem(this.KEYS.GIST_ID);
    },

    setGistId(id) {
        localStorage.setItem(this.KEYS.GIST_ID, id);
    },

    getLastSyncAt() {
        return localStorage.getItem(this.KEYS.LAST_SYNC);
    },

    setLastSyncAt(iso) {
        localStorage.setItem(this.KEYS.LAST_SYNC, iso);
    },

    markLocalChange() {
        localStorage.setItem(this.KEYS.LAST_LOCAL, new Date().toISOString());
    },

    // --- HTTP helpers ---

    async _request(path, opts = {}) {
        const token = this.getToken();
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(opts.headers || {})
        };

        const response = await fetch(`https://api.github.com${path}`, {
            ...opts,
            headers
        });

        if (response.status === 401 || response.status === 403) {
            const remaining = response.headers.get('X-RateLimit-Remaining');
            const reset = response.headers.get('X-RateLimit-Reset');

            if (response.status === 403 && remaining === '0' && reset) {
                const minutesLeft = Math.ceil((parseInt(reset, 10) - Date.now() / 1000) / 60);
                alert(`GitHub API 限制中，約 ${minutesLeft} 分鐘後恢復`);
                throw new Error('rate_limit');
            }

            // 401 or other 403
            this.clearToken();
            alert('GitHub token 失效，請重新輸入');
            // 切換到設定 Tab
            const settingsBtn = document.querySelector('.tab-btn[data-tab="settings"]');
            if (settingsBtn) settingsBtn.click();
            throw new Error('auth_failed');
        }

        return response;
    },

    async verifyToken(token) {
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            };
            const res = await fetch('https://api.github.com/user', { headers });
            if (!res.ok) {
                return { ok: false, error: `HTTP ${res.status}` };
            }
            const data = await res.json();
            return { ok: true, username: data.login };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    async createGist(payload) {
        const content = JSON.stringify(payload);
        const res = await this._request('/gists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: 'Stock Journal 資料備份',
                public: false,
                files: {
                    'stock-journal-data.json': { content }
                }
            })
        });
        const data = await res.json();
        return { id: data.id, updated_at: data.updated_at };
    },

    async fetchGist() {
        const id = this.getGistId();
        if (!id) throw new Error('no_gist_id');

        const res = await this._request(`/gists/${id}`);
        const data = await res.json();

        const fileObj = data.files && data.files['stock-journal-data.json'];
        if (!fileObj) throw new Error('gist_file_missing');

        let content;
        if (fileObj.truncated && fileObj.raw_url) {
            const rawRes = await fetch(fileObj.raw_url);
            content = await rawRes.text();
        } else {
            content = fileObj.content;
        }

        const payload = JSON.parse(content);
        return { payload, updatedAt: data.updated_at };
    },

    async uploadGist(payload) {
        const id = this.getGistId();
        const content = JSON.stringify(payload);

        if (!id) {
            // 還沒有 gist_id，建立新的
            const created = await this.createGist(payload);
            this.setGistId(created.id);
            this.setLastSyncAt(new Date().toISOString());
            return created;
        }

        try {
            const res = await this._request(`/gists/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: {
                        'stock-journal-data.json': { content }
                    }
                })
            });
            const data = await res.json();
            this.setLastSyncAt(new Date().toISOString());
            return { id: data.id, updated_at: data.updated_at };
        } catch (e) {
            if (e.message === 'auth_failed' || e.message === 'rate_limit') throw e;
            // 其他錯誤嘗試建立新 Gist
            const created = await this.createGist(payload);
            this.setGistId(created.id);
            this.setLastSyncAt(new Date().toISOString());
            return created;
        }
    },

    _collectPayload() {
        return {
            trades: Storage.getTrades(),
            netValues: Storage.getNetValues(),
            settings: Storage.getSettings(),
            portfolio: Storage.getPortfolioCache(),
            updatedAt: new Date().toISOString(),
            appVersion: this._appVersion
        };
    },

    _applyPayload(p) {
        // 保留本地 onboarded/onboardedAt 標記，避免從雲端拉回後又跳引導精靈
        const currentSettings = Storage.getSettings();

        if (p.trades && Array.isArray(p.trades)) {
            Storage.saveTrades(p.trades);
        }
        if (p.netValues && Array.isArray(p.netValues)) {
            Storage.saveNetValues(p.netValues);
        }
        if (p.settings && typeof p.settings === 'object') {
            Storage.saveSettings({
                ...p.settings,
                onboarded: currentSettings.onboarded || p.settings.onboarded,
                onboardedAt: currentSettings.onboardedAt || p.settings.onboardedAt
            });
        }
        if (p.portfolio && typeof p.portfolio === 'object') {
            Storage.savePortfolioCache(p.portfolio, true);
        }
    },

    _showToast(msg) {
        // 簡易 toast 通知
        const existing = document.getElementById('gist-toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = 'gist-toast';
        el.textContent = msg;
        el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#333;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;opacity:1;transition:opacity 0.3s';
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    },

    showConflictModal(local, remote) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center';

            const box = document.createElement('div');
            box.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 10px 25px rgba(0,0,0,0.2)';
            box.innerHTML = `
                <h3 style="margin-top:0;color:#2c3e50">資料衝突</h3>
                <p style="color:#555;font-size:14px">本地與雲端都有未同步的更新，請選擇如何處理：</p>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
                    <button id="conflict-use-local" style="padding:10px;border:1px solid #3498db;background:#3498db;color:#fff;border-radius:6px;cursor:pointer;font-size:14px">用本地版（覆蓋雲端）</button>
                    <button id="conflict-use-remote" style="padding:10px;border:1px solid #e67e22;background:#e67e22;color:#fff;border-radius:6px;cursor:pointer;font-size:14px">用雲端版（覆蓋本地）</button>
                    <button id="conflict-download" style="padding:10px;border:1px solid #95a5a6;background:#fff;color:#555;border-radius:6px;cursor:pointer;font-size:14px">先下載本地版 JSON（不動資料）</button>
                </div>`;

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            document.getElementById('conflict-use-local').addEventListener('click', async () => {
                overlay.remove();
                await this.uploadGist(local);
                this._showToast('已推送本地版到雲端');
                resolve('local');
            });

            document.getElementById('conflict-use-remote').addEventListener('click', () => {
                overlay.remove();
                this._applyPayload(remote);
                this.setLastSyncAt(new Date().toISOString());
                this._showToast('已從雲端載入');
                location.reload();
                resolve('remote');
            });

            document.getElementById('conflict-download').addEventListener('click', () => {
                overlay.remove();
                // 觸發本地 JSON 下載
                const jsonStr = JSON.stringify(local, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                a.href = url;
                a.download = `stock-journal-local-${dateStr}.json`;
                a.click();
                URL.revokeObjectURL(url);
                resolve('download');
            });
        });
    },

    // --- 主要同步邏輯 ---

    async initialSync() {
        if (!this.hasToken()) return;
        if (!this.getGistId()) return;

        try {
            const { payload: remote, updatedAt: remoteUpdatedAt } = await this.fetchGist();

            const lastSync = this.getLastSyncAt();
            const lastLocal = localStorage.getItem(this.KEYS.LAST_LOCAL);

            const remoteTime = new Date(remoteUpdatedAt).getTime();
            const localTime = lastLocal ? new Date(lastLocal).getTime() : 0;
            const syncTime = lastSync ? new Date(lastSync).getTime() : 0;

            const remoteNewer = remoteTime > syncTime;
            const localNewer = localTime > syncTime;

            if (remoteNewer && localNewer) {
                // 衝突
                const local = this._collectPayload();
                await this.showConflictModal(local, remote);
            } else if (remoteNewer) {
                this._applyPayload(remote);
                this.setLastSyncAt(new Date().toISOString());
                this._showToast('已從雲端載入');
            } else if (localNewer) {
                await this.uploadGist(this._collectPayload());
                this._showToast('已推送到雲端');
            }
            // 兩邊都沒變 → 不動
        } catch (e) {
            if (e.message === 'auth_failed' || e.message === 'rate_limit') return;
            console.warn('GistSync.initialSync failed:', e.message);
        }
    },

    scheduleUpload() {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this.uploadGist(this._collectPayload()).catch(e => console.warn('GistSync upload failed:', e.message));
        }, 3000);
    },

    async manualSync() {
        if (!this.hasToken()) {
            return { ok: false, error: '尚未連接 Gist' };
        }
        if (!this.getGistId()) {
            return { ok: false, error: '尚未建立 Gist' };
        }

        try {
            const { payload: remote, updatedAt: remoteUpdatedAt } = await this.fetchGist();
            const lastSync = this.getLastSyncAt();
            const lastLocal = localStorage.getItem(this.KEYS.LAST_LOCAL);

            const remoteTime = new Date(remoteUpdatedAt).getTime();
            const localTime = lastLocal ? new Date(lastLocal).getTime() : 0;
            const syncTime = lastSync ? new Date(lastSync).getTime() : 0;

            const remoteNewer = remoteTime > syncTime;
            const localNewer = localTime > syncTime;

            if (remoteNewer && localNewer) {
                const local = this._collectPayload();
                await this.showConflictModal(local, remote);
                return { ok: true, msg: '衝突已處理' };
            } else if (remoteNewer) {
                this._applyPayload(remote);
                this.setLastSyncAt(new Date().toISOString());
                return { ok: true, msg: '已從雲端載入最新資料' };
            } else {
                await this.uploadGist(this._collectPayload());
                return { ok: true, msg: '已推送到雲端' };
            }
        } catch (e) {
            if (e.message === 'auth_failed' || e.message === 'rate_limit') {
                return { ok: false, error: e.message };
            }
            console.warn('GistSync.manualSync failed:', e.message);
            return { ok: false, error: e.message };
        }
    }
};
