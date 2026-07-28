// ===== JST統一ユーティリティ =====
export function toJSTDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

//表示形式をJSTに強制
export function toJST(date) {
   return new Date(new Date(date).getTime() + 9 * 60 * 60 * 1000);
}

export function getBusinessDateJST() {
  const now = new Date();
  // UTCからJSTに変換
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // JST 0:00～3:59 は前日扱い
  if (jst.getHours() < 4) {
    jst.setDate(jst.getDate() - 1);
  }
  // 時刻部分を破棄して日付だけにする
  return new Date(jst.getFullYear(), jst.getMonth(), jst.getDate());
}


// ===== 表示 =====
export function formatTransportDisplay(record) {
  const d = new Date(record.date);
  const arrow = record.roundTrip ? "⇆" : "→";
  const mark = record.roundTrip ? " (往復)" : "";

  return `${d.getMonth()+1}/${d.getDate()} ${record.from}${arrow}${record.to} ${record.amount}円${mark}`;
}


// ===== 通知 =====
export function parseNotifyToggle(text) {
  const t = text.replace(/\s/g,"").toLowerCase();

  if (["on", "オン", "おん"].includes(t)) return true;
  if (["off", "オフ", "おふ",].includes(t)) return false;
  return null;
}


// ===== 日付 =====
export function getTargetMonth(year, month) {
  // monthは1-12
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

// ===== その月の月末日を取得 =====
export function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}


// ===== 入力判定 =====
export function isTimeInput(text) {
  return /(\d{1,2})(時|:|：)?(\d{1,2})?(分|半)?/.test(text);
}

export function parseTimeInput(text) {
  let h, m = 0;
  // ① HH:MM / HH：MM
  let match = text.match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (match) {
    h = Number(match[1]);
    m = Number(match[2]);
  }
  // ② ○時 / ○時半 / ○時30分
  else if ((match = text.match(/^(\d{1,2})時(半|\d{1,2}分)?$/))) {
    h = Number(match[1]);
    if (match[2] === "半") m = 30;
    else if (match[2]) m = Number(match[2].replace("分", ""));
  }
  // ③ 数字のみ → 時指定とみなす
  else if ((match = text.match(/^(\d{1,2})$/))) {
    h = Number(match[1]);
    m = 0;
  }
  else {
    throw "時刻の形式が正しくありません。\n(例:22時, 22:00, 22時半, 22時30分)";
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw "時刻の形式が正しくありません。\n(例:22時, 22:00, 22時半, 22時30分)";
  }
  return { h, m };
}


// ===== PDF月入力パース =====
export function parsePDFMonthInput(text) {
  const now = new Date();
  let year, month;

  let match = text.match(/^(\d{4})[年\/](\d{1,2})月?$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  }
  else if ((match = text.match(/(\d{1,2})月/))) {
    month = Number(match[1]);
    year = now.getFullYear();
    if (month > now.getMonth() + 1) year--;
  }
  else if (/^\d{1,2}$/.test(text)) {
    month = Number(text);
    year = now.getFullYear();
    if (month > now.getMonth() + 1) year--;
  } else {
    throw "月の入力形式が正しくありません。";
  }
  if (month < 1 || month > 12) {
    throw "存在しない月です。";
  }
  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
    throw "未来の年月は指定できません。";
  }
  return { year, month };
}


// ===== 日付パース =====
export function parseDate(text) {
  const now = toJST(new Date());
  let y, m, d;

  let match = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  }
  else if ((match = text.match(/(\d{1,2})[\/\-](\d{1,2})/))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = now.getFullYear();
    const temp = new Date(y, m - 1, d);
    if (temp > now) y--;
  }
  else if ((match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    throw "日付の形式が正しくありません。";
  }

  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    throw "存在しない日付です。";
  }
  if (date > now) {
    throw "未来の日付は登録できません。";
  }
  return date;
}


// ===== 月次受信設定パース =====
export function parseSummarySettingInput(text) {
  let day, hour = 12, minute = 0;
  text = text.trim();
  // 時刻抽出（あれば）
  const timeMatch = text.match(/(\d{1,2})[:：](\d{1,2})/);
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw "時刻が不正です。";
    }
    text = text.replace(timeMatch[0], "").trim();
  }
  // 日付抽出
  let match;
  // 4月27日なら
  if ((match = text.match(/(\d{1,2})月(\d{1,2})日?/))) {
    day = Number(match[2]);
  }
  // 4/27なら
  else if ((match = text.match(/(\d{1,2})\/(\d{1,2})/))) {
    day = Number(match[2]);
  }
  // 27日なら
  else if ((match = text.match(/(\d{1,2})日?/))) {
    day = Number(match[1]);
  }
  else {
    throw "日付の形式が正しくありません。";
  }
  if (day < 1 || day > 31) {
    throw "存在しない日付です。";
  }
  return {
    day,
    hour,
    minute
  };
}


// ===== 交通費入力判定 =====
export function isTransportInput(text) {
  const parts = text.trim().split(/\s+/);
  return (
    (parts.length === 3 && !isNaN(parts[2])) ||
    (parts.length === 4 && parts[0].match(/[\/年月]/) && !isNaN(parts[3]))
  );
}


// ===== 交通費パース =====
export function parseTransport(text) {
  const parts = text.split(/\s+/);
  let date = getBusinessDateJST();
  let from, to, amountRaw;
  if (parts[0].match(/[\/年月]/)) {
    date = parseDate(parts[0]);
    from = parts[1];
    to = parts[2];
    amountRaw = parts[3];
  } else {
    from = parts[0];
    to = parts[1];
    amountRaw = parts[2];
  }
  if (!from || !to) {
    throw "入力形式が正しくありません。";
  }
  if (!/^[0-9]+$/.test(amountRaw)) {
    throw "金額の形式が正しくありません。";
  }
  const amount = Number(amountRaw);
  return { date, from, to, amount };
}