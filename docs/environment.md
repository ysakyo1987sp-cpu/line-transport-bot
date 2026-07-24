# 開発環境・本番環境

## 現在の環境

### Cloudflare

- 本番環境のみ
- Cloudflare Workers
- Cloudflare KV

### LINE

- Messaging API チャネル：1つ
- 開発・本番で共用

## 現在の課題

- 開発と本番が同じCloudflareアカウント
- 開発中のアクセスが本番へ影響する可能性がある
- Webhookを切り替えながら開発する必要がある

## 改善方針

### 開発環境

- Cloudflare（開発用アカウント）
- 開発用Messaging APIチャネル
- GitHub main ブランチ

### 本番環境

- Cloudflare（本番用アカウント）
- 本番用Messaging APIチャネル
- GitHubの安定版をデプロイ

## 移行予定

- Cloudflareアカウントを分離
- LINE Botを開発用・本番用に分離
- Cloudflare D1へ移行
