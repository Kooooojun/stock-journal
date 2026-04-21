# Stock Journal — 台股記帳模板

純前端台股投資組合記帳 Web App。資料存在你自己的瀏覽器，可選用 GitHub Gist 跨裝置同步。**零伺服器、零資料庫、零月費。**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow.svg)
![No Backend](https://img.shields.io/badge/backend-none-green.svg)

---

## ✨ 功能

- 📊 **三個 Tab**：庫存（含即時報價）、每日淨值、交易紀錄
- 💹 **即時台股報價**：透過 Yahoo Finance CORS proxy，零設定、免 API key
- 💰 **自動計算**：持股損益、手續費（可自訂費率 + 券商折扣）、證交稅、T+1/T+2 交割金額
- 📈 **風險管理**：自動算出 Total AUM 的 5/8/10/12/15/20% 風險金額
- 💾 **資料匯出匯入**：JSON 完整備份、CSV 分類匯出
- ☁️ **（可選）GitHub Gist 雲端同步**：跨裝置使用，private Gist 存你自己的 GitHub

## 🚀 30 秒快速開始

1. 點右上 **「Use this template」** 建立你自己的 repo
2. 進入你的新 repo → **Settings → Pages** → Source 選 `main` branch / `root`
3. 等 1–2 分鐘，開 `https://<你的帳號>.github.io/<repo 名稱>`
4. 跟著首次使用精靈填「初始資金 / 手續費率 / 折扣」即可開始記帳

> 想在本地跑？`cd` 進專案後 `python3 -m http.server 8000`，開 `http://localhost:8000`。

## ☁️ 跨裝置同步（可選）

想在手機、平板、多台電腦間同步資料？可以綁一個你自己的 private GitHub Gist：

1. 去 [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=gist&description=Stock%20Journal%20Sync) 產生 **Classic PAT**，scope **只勾 `gist`** 即可
2. 複製 token → 貼進 App 的「設定 → 跨裝置同步」→ 點「連接」
3. 換另一台裝置時貼同一個 token，會自動拉回資料
4. 之後每次新增交易都會 **debounce 3 秒** 後自動推上 Gist
5. 雙邊同時改會跳衝突 Modal 讓你選（用本地 / 用雲端 / 先下載本地版 JSON）

**資料去哪？** 一份 private Gist，檔名 `stock-journal-data.json`，只有你自己看得到。

## 🔒 隱私與安全

- 所有資料預設只存在你瀏覽器的 `localStorage`
- **不會**傳到作者或任何第三方伺服器
- 即時報價走 Yahoo Finance 公開 proxy，只送股票代號、不送個資
- 雲端同步功能走 **你自己**的 GitHub Gist（private）
- PAT 以明文存於 localStorage；請確保 scope 只開 `gist`，遇可疑狀況到 GitHub Settings 隨時 revoke

## 🏗 架構

```
stock-journal/
├── index.html          # 主頁面（四個 tab）
├── css/style.css       # 樣式
└── js/
    ├── app.js          # 入口、Tab 切換、Modal 元件
    ├── onboarding.js   # 首次使用引導精靈
    ├── storage.js      # localStorage CRUD + 庫存計算 + 手續費公式
    ├── api.js          # Yahoo Finance API 串接
    ├── portfolio.js    # Page 1: 庫存邏輯
    ├── netValue.js     # Page 2: 淨值邏輯
    ├── trades.js       # Page 3: 交易紀錄
    ├── settings.js     # Page 4: 設定（基本/資料管理/Gist 同步）
    ├── gistSync.js     # GitHub Gist 同步引擎（debounce + 衝突解決）
    └── stock_names.*   # 台股代號-名稱對照表（TWSE + TPEx）
```

**零外部依賴** — 純 Vanilla JS + 一個 Chart.js CDN。

## ❓ FAQ

**Q：資料會傳到作者的伺服器嗎？**
A：完全不會。所有資料只在你自己的瀏覽器或你自己的 Gist。

**Q：可以商用嗎？**
A：MIT License，隨便用。

**Q：清瀏覽器快取資料會不見嗎？**
A：會。建議定期用「設定 → 資料管理 → 匯出 JSON」備份，或啟用 Gist 同步。

**Q：手續費率改了會回溯計算舊交易嗎？**
A：不會，只影響之後新增的交易。舊交易 P/L 保持不動。

**Q：可以記帳美股 / 加密貨幣嗎？**
A：目前即時報價只支援台股（`.TW` / `.TWO`）。你可以手動輸入任何標的，但即時價格欄位會拉不到。

**Q：為什麼不做帳號系統？**
A：零伺服器是本模板的核心主張。需要跨裝置請用 Gist 同步方案。

## 🛠 開發

```bash
# Clone
git clone https://github.com/<你的帳號>/stock-journal
cd stock-journal

# 啟動本地伺服器（任選）
python3 -m http.server 8000
# 或
npx serve .

open http://localhost:8000
```

本專案純前端，無 build step。改 JS/HTML/CSS 後直接重整瀏覽器即可。

## 🤝 貢獻

歡迎 PR！本模板刻意保持簡單（vanilla JS、無 framework、無 build tool），請沿用相同風格。

## 📄 License

MIT © Stock Journal Contributors
