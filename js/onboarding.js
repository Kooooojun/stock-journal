// onboarding.js - 首次使用引導精靈

const Onboarding = {
    _overlay: null,
    _step: 1,
    _onComplete: null,

    // 檢查是否需要引導；回傳 true 表示已完成引導，false 表示正在顯示引導
    check() {
        const settings = Storage.getSettings();
        if (settings.onboarded === true) {
            return true;
        }
        this.show();
        return false;
    },

    show(onComplete) {
        this._onComplete = onComplete || null;
        this._step = 1;
        this._render();
    },

    _render() {
        // 移除舊的 overlay（若有）
        const existing = document.getElementById('onboarding-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        overlay.className = 'onboarding-overlay';
        overlay.innerHTML = this._buildStep(this._step);
        document.body.appendChild(overlay);
        this._overlay = overlay;

        this._bindEvents();
    },

    _buildStep(step) {
        const indicators = `
            <div class="onboarding-steps">
                <span class="onboarding-step-dot ${step >= 1 ? 'active' : ''}"></span>
                <span class="onboarding-step-dot ${step >= 2 ? 'active' : ''}"></span>
                <span class="onboarding-step-dot ${step >= 3 ? 'active' : ''}"></span>
            </div>`;

        if (step === 1) {
            return `
                <div class="onboarding-modal">
                    ${indicators}
                    <div class="onboarding-icon">
                        <svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="1" x2="12" y2="23"></line>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                    </div>
                    <h2 class="onboarding-title">歡迎使用 Stock Journal</h2>
                    <p class="onboarding-desc">
                        這是一款純前端的台股記帳工具。<br>
                        所有資料只存在你自己的瀏覽器，不經過任何伺服器。
                    </p>
                    <p class="onboarding-desc onboarding-desc--muted">
                        讓我們花一點時間完成初始設定，只需要兩個步驟。
                    </p>
                    <div class="onboarding-actions">
                        <button class="btn btn-primary onboarding-next">下一步</button>
                    </div>
                </div>`;
        }

        if (step === 2) {
            const settings = Storage.getSettings();
            const rateDisplay = ((settings.commissionRate || 0.001425) * 100).toFixed(4);
            const discountDisplay = Math.round((settings.commissionDiscount || 0.6) * 100);
            const capital = settings.initialCapital || '';

            return `
                <div class="onboarding-modal">
                    ${indicators}
                    <h2 class="onboarding-title">基本設定</h2>
                    <p class="onboarding-desc onboarding-desc--muted">以下設定可於之後在「設定」頁修改。</p>

                    <div class="onboarding-form">
                        <div class="form-group">
                            <label for="ob-capital">初始資金（元）<span class="onboarding-required">*</span></label>
                            <input type="number" id="ob-capital" placeholder="例：1000000" value="${capital || ''}" min="1" step="1">
                            <span class="onboarding-error" id="ob-capital-err" style="display:none;">請輸入大於 0 的初始資金</span>
                        </div>
                        <div class="form-group">
                            <label for="ob-rate">手續費率 %</label>
                            <input type="number" id="ob-rate" value="${rateDisplay}" min="0" step="0.0001" placeholder="例：0.1425">
                            <span class="onboarding-hint">預設 0.1425%（全額手續費）</span>
                        </div>
                        <div class="form-group">
                            <label for="ob-discount">手續費折扣 %（0~100）</label>
                            <input type="number" id="ob-discount" value="${discountDisplay}" min="0" max="100" step="1" placeholder="例：60">
                            <span class="onboarding-hint">預設 60，代表 6 折（乘以折扣後的實際費率：${(rateDisplay * discountDisplay / 100).toFixed(6)}%）</span>
                            <span class="onboarding-error" id="ob-discount-err" style="display:none;">請輸入 0~100 之間的數字</span>
                        </div>
                    </div>

                    <div class="onboarding-actions">
                        <button class="btn btn-secondary onboarding-prev">上一步</button>
                        <button class="btn btn-primary onboarding-next">下一步</button>
                    </div>
                </div>`;
        }

        if (step === 3) {
            return `
                <div class="onboarding-modal">
                    ${indicators}
                    <h2 class="onboarding-title">跨裝置同步（選填）</h2>
                    <p class="onboarding-desc">
                        想在多個裝置間同步資料？可選擇使用 GitHub Gist —— 免費、Private、零伺服器。
                    </p>
                    <div class="onboarding-sync-info">
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <span>此功能在 Phase D 開放，目前可先跳過。</span>
                    </div>
                    <div class="onboarding-actions">
                        <button class="btn btn-secondary onboarding-prev">上一步</button>
                        <button class="btn btn-secondary onboarding-skip">稍後再設定</button>
                        <button class="btn btn-primary onboarding-setup-gist">立即設定</button>
                    </div>
                </div>`;
        }

        return '';
    },

    _bindEvents() {
        const overlay = this._overlay;

        const nextBtn = overlay.querySelector('.onboarding-next');
        const prevBtn = overlay.querySelector('.onboarding-prev');
        const skipBtn = overlay.querySelector('.onboarding-skip');
        const gistBtn = overlay.querySelector('.onboarding-setup-gist');

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this._handleNext());
        }
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this._step--;
                this._render();
            });
        }
        if (skipBtn) {
            skipBtn.addEventListener('click', () => this._complete(false));
        }
        if (gistBtn) {
            gistBtn.addEventListener('click', () => this._complete(true));
        }
    },

    _handleNext() {
        if (this._step === 1) {
            this._step = 2;
            this._render();
            return;
        }

        if (this._step === 2) {
            if (!this._validateStep2()) return;
            this._saveStep2();
            this._step = 3;
            this._render();
            return;
        }
    },

    _validateStep2() {
        const capital = parseFloat(document.getElementById('ob-capital').value);
        const discount = parseFloat(document.getElementById('ob-discount').value);
        let valid = true;

        const capitalErr = document.getElementById('ob-capital-err');
        const discountErr = document.getElementById('ob-discount-err');

        if (!capital || capital <= 0 || isNaN(capital)) {
            capitalErr.style.display = 'block';
            valid = false;
        } else {
            capitalErr.style.display = 'none';
        }

        if (isNaN(discount) || discount < 0 || discount > 100) {
            discountErr.style.display = 'block';
            valid = false;
        } else {
            discountErr.style.display = 'none';
        }

        return valid;
    },

    _saveStep2() {
        const capital = parseFloat(document.getElementById('ob-capital').value);
        const rate = parseFloat(document.getElementById('ob-rate').value);
        const discount = parseFloat(document.getElementById('ob-discount').value);

        Storage.saveSettings({
            ...Storage.getSettings(),
            initialCapital: capital,
            commissionRate: rate / 100,
            commissionDiscount: discount / 100,
        });
    },

    _complete(goToGist) {
        const settings = Storage.getSettings();
        Storage.saveSettings({
            ...settings,
            onboarded: true,
            onboardedAt: new Date().toISOString(),
        });

        const overlay = document.getElementById('onboarding-overlay');
        if (overlay) overlay.remove();

        if (this._onComplete) {
            this._onComplete();
        } else {
            // 預設行為：初始化主應用程式
            App.initAfterOnboarding();
        }

        if (goToGist) {
            // 切到設定 tab 並捲到 Gist 區塊
            setTimeout(() => {
                const settingsBtn = document.querySelector('.tab-btn[data-tab="settings"]');
                if (settingsBtn) settingsBtn.click();
                const gistSection = document.getElementById('gist-sync-section');
                if (gistSection) gistSection.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    }
};
