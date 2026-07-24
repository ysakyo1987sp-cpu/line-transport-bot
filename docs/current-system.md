# 現在のシステム構成

## システム構成

```text
LINEユーザー
      │
      ▼
LINE Messaging API
      │
      ▼
Cloudflare Workers
      │
      ├── transport-data
      ├── USER_DATA
      └── USER_STATE
```

## KV Namespace

### transport-data

交通費データおよび通知管理用データを保存する。

保存しているキー例

- transport:<userId>
- today:<userId>:YYYY-MM-DD
- notified:<userId>:YYYY-MM-DD
- summary_sent:<userId>:YYYY-MM

### USER_DATA

ユーザーIDをキーとして保持する。

初回利用時に

Value = 1

を保存する。

### USER_STATE

LINE会話中の状態管理を行う。

## 現在の課題

- worker.jsに全処理が集約されている
- transport-dataがJSON配列保存になっている
- データ検索効率が低い
- Cloudflare D1への移行を検討