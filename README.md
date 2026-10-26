# X Timeline Filter

X（旧Twitter）のホームタイムラインに表示する投稿者を、端末内の許可リストで制限するManifest V3のChrome拡張機能です。

- 対象は `/home` の「おすすめ」「フォロー中」。プロフィールや検索、投稿詳細は変更しません。
- 再投稿は元の著者、引用投稿は外側の投稿者で判定します。判定できない投稿は、フィルターON時には非表示にします。
- 無限スクロール、SPA画面遷移、投稿セルの再利用に追従します。
- ポップアップでグループ・アカウントの追加と切り替え、フィルターのON/OFFができます。
- 設定はChromeの `chrome.storage.local` に保存します。初期状態はOFFです。
- Xへの独自API通信やCookieの取得、閲覧データの外部送信はしません。

## インストール

[Releases](https://github.com/kikutadev/x-timeline-filter/releases) のChrome向けZIPをダウンロードし、解凍したフォルダーをChromeの `chrome://extensions/` から「パッケージ化されていない拡張機能を読み込む」で選択してください。

Xtendでは、対応するバージョンのアプリにGitHubリポジトリURLを入力して導入できます。

## 使い方

1. 拡張機能のアイコンを開き、表示したい `@username` を登録します。改行やカンマで複数指定できます。
2. フィルターをONにします。グループ変更は表示中のタイムラインにも反映されます。
3. Xリストの「メンバー」を開いて閲覧・スクロールすると、画面に描画されたメンバーが拡張機能のローカルストレージに蓄積されます。拡張機能の設定画面で、直近のリストIDと取得件数を確認して「取得済みメンバーを追加」を押します。ChromeとXtendで同じ手順です。自動スクロール・未表示メンバーの全件同期は行いません。別のリストのメンバー画面を開くと取得対象が切り替わります。

## 開発・テスト

Node.jsとpnpmが必要です。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm zip
pnpm test:e2e
```

`test:e2e` はPlaywrightのChromiumを使用します。初回は `pnpm exec playwright install chromium` を実行してください。

XのDOM変更で判定が壊れる場合があります。非表示処理の絶対的な検知回避は保証しません。

## 配布物とライセンス

`release/` に配布用ZIPとSHA-256検証値があります。アイコンの原本は `assets/icon.svg`、Chrome用PNGは `public/icon/` に配置しています。

MITライセンス。詳細は [LICENSE](LICENSE) を参照してください。
