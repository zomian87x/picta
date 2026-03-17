# Picta - Gemini 画像生成デスクトップアプリ

[English version is here](README.en.md)

Google Gemini の画像生成モデルを使用した、Electron ベースのデスクトップアプリケーションです。日本語プロンプト対応、複数画像入力に対応しています。

## 機能

- **2つのモード**:
  - **画像生成**: テキストプロンプトから画像を生成
  - **画像編集**: 入力画像をプロンプトに基づいて編集
- **複数画像入力スロット**: 番号付きスロット＋キャンバス（PNG/JPG）
- **出力設定**: アスペクト比 1:1, 2:3, 3:2, 4:3, 3:4, 16:9, 9:16 / 解像度 1K/2K/4K
- **手描きキャンバス**: フリーハンド描画ツール
- **スマート画像選択**: 使用する画像を選択（1回の生成で最大3枚）
- **モデル切り替え**: `nano banana`, `nanobanana 2`, `nano banana pro`
- **生成履歴**: メタデータ付きで直近の生成履歴を管理
- **プロンプトプリセット**: よく使うプロンプトを保存・管理
- **自動アップデート**: アプリ内でアップデートを確認・適用

## セットアップ

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd picta
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. アプリの起動

```bash
npm start
```

### 4. API キーの設定

初回起動時に設定画面（⌘, / Ctrl+,）で Gemini API キーを入力してください。
API キーは OS のセキュアストレージ（macOS Keychain / Windows Credential Manager）が利用可能な場合にのみ暗号化保存されます。
セキュアストレージが利用できない環境では、アプリは API キーを保存しません。

API キーの取得先: https://ai.google.dev/

## ビルド

```bash
# macOS
npm run build

# Windows
npm run build:win

# 全プラットフォーム
npm run build:all
```

macOS の公開配布用コード署名と notarization については [docs/macos-signing-notarization.md](docs/macos-signing-notarization.md) を参照してください。
GitHub Actions での自動リリース用 workflow は [`.github/workflows/release-macos.yml`](/Users/ibuki/Projects/active/picta/.github/workflows/release-macos.yml) です。

## 動作要件

- Node.js 18+
- Gemini API キー
- インターネット接続

## モデルエイリアス

| エイリアス | モデル | 備考 |
|---|---|---|
| `nano banana` | `gemini-3-pro-image-preview` | - |
| `nanobanana 2` | `gemini-3.1-flash-image-preview` | thinking: MINIMAL |
| `nano banana pro` | `gemini-3-pro-image-preview` | - |

## 注意事項

- 生成された画像には SynthID の透かしが入ります
- 1回の処理で最大3枚の画像を扱えます（Google の推奨）
- 使用権限のある画像のみアップロードしてください

## セキュリティ

- API キーは renderer プロセスからアクセスできません（main プロセスのみが保持）
- API キーは OS のセキュアストレージが利用可能な場合のみ保存され、非対応環境では保存を拒否します
- ファイル保存はダイアログで承認されたパスにのみ書き込み可能です
- 外部 URL は `https:` のみ許可されています
