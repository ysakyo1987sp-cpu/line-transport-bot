// ===== ログユーティリティ =====
const logBuffer = [];

function logUnified(message, extra = {}) {
  const now = new Date().toISOString();
  logBuffer.push({ timestamp: now, message, ...extra });
}
// 最後にまとめて出力
function flushLogs() {
  console.log(JSON.stringify(logBuffer, null, 2));
  logBuffer.length = 0; // バッファクリア
}

// ===== JST統一ユーティリティ =====
function toJSTDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

//表示形式をJSTに強制
function toJST(date) {
   return new Date(new Date(date).getTime() + 9 * 60 * 60 * 1000);
}

function getBusinessDateJST() {
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

function formatTransportDisplay(record) {
  const d = new Date(record.date);
  const arrow = record.roundTrip ? "⇆" : "→";
  const mark = record.roundTrip ? " (往復)" : "";

  return `${d.getMonth()+1}/${d.getDate()} ${record.from}${arrow}${record.to} ${record.amount}円${mark}`;
}

//ON/OFF判定関数
function parseNotifyToggle(text) {
  const t = text.replace(/\s/g,"").toLowerCase();

  if (["on", "オン", "おん"].includes(t)) return true;
  if (["off", "オフ", "おふ",].includes(t)) return false;
  return null;
}

function getTargetMonth(year, month) {
  // monthは1-12
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
}

// ===== その月の月末日を取得 =====
function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ===== DB操作関数 =====
async function addTransportRecord(env, userId, record) {
  const key = `transport:${userId}`;
  const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];

  list.push(record);

  await env.TRANSPORT_DATA.put(key, JSON.stringify(list));

  const todayKey = `today:${userId}:${toJSTDateString(record.date)}`;
  await env.TRANSPORT_DATA.put(todayKey, "true",{ expirationTtl: 60 * 60 * 24 * 3 });
}

// ===== 直前削除関数 =====
async function deleteLastTransport(env, userId) {
  const key = `transport:${userId}`;
  const list = await env.TRANSPORT_DATA.get(key, { type: "json" });
  
  if (!list || list.length === 0) return null;
  
  const last = list.pop();

  if (list.length === 0) {
    await env.TRANSPORT_DATA.delete(key);
  } else {
    await env.TRANSPORT_DATA.put(key, JSON.stringify(list));
  }
  //今日分がまだ残っているか確認
  const targetDate = toJSTDateString(last.date);
  const stillExists = list.some(t =>
    toJSTDateString(t.date) === targetDate
  );
  if (!stillExists) {
    const todayKey = `today:${userId}:${targetDate}`;
    await env.TRANSPORT_DATA.delete(todayKey);
  }
  return last;
}

// ===== 月取得関数 =====
async function getTransportByMonth(env, userId, year, month) {
  const key = `transport:${userId}`;
  const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];

  return list
    .map(t => ({ ...t, date: new Date(t.date) }))
    .filter(t =>
      t.date.getFullYear() === year &&
      t.date.getMonth() === month - 1
    );
}

// ===== 通知送信関数 =====
async function pushNotify(env, userId) {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: userId,
      messages: [{
        type: "text",
        text: "今日の交通費登録がありません。\n忘れずに登録してください！"
      }]
    })
  });
}

// ===== 月次一覧送信関数 =====
async function sendMonthlySummary(env, userId, year, month) {
  const records = await getTransportByMonth(
    env,
    userId,
    year,
    month
  );
  let message;
  if (records.length === 0) {
    message = `【${year}年${month}月の交通費】\n登録はありません。`;
  }
  else {
    let total = 0;
    const listText = records.map(r => {
      total += r.amount;
      return formatTransportDisplay(r);
    }).join("\n");
    message =
      `【${year}年${month}月の交通費一覧】\n` +
      `${listText}\n` +
      `--------------------\n` +
      `合計:${total}円`;
  }
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: userId,
      messages: [{
        type: "text",
        text: message
      }]
    })
  });
}


// ===== サイクルクローンの判定 =====
async function handleCron(env, ctx) {
  //log
  logUnified("CRON fired", new Date().toISOString());
  const users = await env.USER_DATA.list({ prefix: "user:" });
  logUnified("USER LIST", users.keys.map(k => k.name));

  const nowJST = toJST(new Date());
  const today = toJSTDateString(nowJST);
  const hour = nowJST.getHours();
  const minute = nowJST.getMinutes();
  const nowTotal = hour * 60 + minute;
  const year = nowJST.getFullYear();
  const month = nowJST.getMonth() + 1;
  const day = nowJST.getDate();


  // 友達追加済みユーザー一覧
  for (const u of users.keys) {
    const userId = u.name.replace("user:", "");
    logUnified("CHECK USER", userId);
    let notify =
      await env.TRANSPORT_DATA.get(`notify:${userId}`, { type: "json" });
    // notify未作成 → デフォルト22:00 ON
    if (!notify) {
      notify = {
        hour: 22,
        minute: 0,
        enabled: true
      };
    }

    // ===== 月次一覧送信チェック =====
    let summary =
      await env.TRANSPORT_DATA.get(`summary:${userId}`, { type: "json" });
    // デフォルト設定
    if (!summary) {
      summary = {
        day: 1,
        hour: 12,
        minute: 0
      };
    }
    const summaryTotal = summary.hour * 60 + summary.minute;
    const summaryInWindow =
      nowTotal >= summaryTotal &&
      nowTotal < summaryTotal + 30;
    // ===== 月末丸め処理 =====
    const lastDay = getLastDayOfMonth(year, month);
    const adjustedDay = Math.min(summary.day, lastDay);
    if (summaryInWindow && day === adjustedDay) {
      const { year: targetYear, month: targetMonth } =
        getTargetMonth(year, month);
      const sentKey =
        `summary_sent:${userId}:${targetYear}-${targetMonth}`;
      const alreadySent =
        await env.TRANSPORT_DATA.get(sentKey);
      if (!alreadySent) {
        ctx.waitUntil(sendMonthlySummary(
          env,
          userId,
          targetYear,
          targetMonth
        ));
        ctx.waitUntil(env.TRANSPORT_DATA.put(sentKey, "true",{
          expirationTtl: 60* 60* 24* 40
        }));
      }
    }

    if (!notify.enabled) continue;
    const notifyTotal = notify.hour * 60 + notify.minute;
    //30分窓判定
    const inWindow = nowTotal >= notifyTotal && nowTotal < notifyTotal + 30;

    if (!inWindow) continue;
    const todayKey = `today:${userId}:${today}`;
    const hasRegistered = await env.TRANSPORT_DATA.get(todayKey);
    const alreadyNotified = await env.TRANSPORT_DATA.get(
      `notified:${userId}:${today}`
    );
    if (!hasRegistered && !alreadyNotified) {
      ctx.waitUntil(pushNotify(env, userId));
      ctx.waitUntil(env.TRANSPORT_DATA.put(
        `notified:${userId}:${today}`,
        "true",
        { expirationTtl: 60 * 60 * 24 * 3 }
      ));
    }
  }
}

// ===== 時刻入力判定 =====
function isTimeInput(text) {
  return /(\d{1,2})(時|:|：)?(\d{1,2})?(分|半)?/.test(text);
}

// ===== 時刻パース =====
function parseTimeInput(text) {
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
function parsePDFMonthInput(text) {
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
function parseDate(text) {
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
function parseSummarySettingInput(text) {
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
function isTransportInput(text) {
  const parts = text.trim().split(/\s+/);
  return (
    (parts.length === 3 && !isNaN(parts[2])) ||
    (parts.length === 4 && parts[0].match(/[\/年月]/) && !isNaN(parts[3]))
  );
}

// ===== 交通費パース =====
function parseTransport(text) {
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



// ===== 本体 =====
export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }
    const body = await request.json();
    if (!body.events || body.events.length === 0) {
      return new Response("OK", { status: 200 });
    }
    const event = body.events[0];
    const replyToken = event.replyToken;
    if (event.type !== "message" || event.message.type !== "text") {
      return new Response("OK", { status: 200 });
    }
    const text = event.message.text.trim();
    let replyText = "";
    const userId = event.source.userId;
    // ===== ユーザー存在記録（必ず1回は残る）=====
    ctx.waitUntil(env.USER_DATA.put(`user:${userId}`, "1"));

    // ===== state取得（追加）=====
    const stateKey = `state:${userId}`;
    const state = await env.USER_STATE.get(stateKey, { type: "json" });

    if (text !== "キャンセル") {
      await env.USER_STATE.delete(`cancelable:${userId}`);
    }
    if (state && state.expiresAt < Date.now()) {
      await env.USER_STATE.delete(stateKey);

      //state切れ時の専用文
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          replyToken,
          messages: [{
            type: "text",
            text: "操作がタイムアウトしました。もう一度やり直してください。"
          }]
        })
      });
      return new Response("OK", { status: 200 });
    }

    const USAGE_MESSAGE = `
交通費申請Botです。
このアカウントでは、LINEで交通費の登録・管理ができます。

【使い方】
1.交通費の登録
▼当日分を登録する場合
(例) 渋谷 新宿 220

▼日付を指定して登録する場合
(例) 4/27 渋谷 新宿 220

2.登録情報の削除
▼直前の登録を削除
[キャンセル]と入力してください。

▼日付を指定して削除
[◯/◯ キャンセル]と入力してください。
(例) 4/27 キャンセル

3.登録催促通知
毎日、設定時間に交通費登録の
リマインドが届きます。
※デフォルトは毎日22:00です。

▼設定時間の変更
[通知] と入力してください。
※30分単位で変更が可能です。

4.PDF受信設定と再送
▼受信設定
[受信設定]と入力してください。
月1回の一覧送信日を変更できます。
※デフォルトは翌月1日の12:00です。

▼再送
[再送]と入力してください。
指定月のPDFを入手できます。

[使い方] と入力することでいつでも確認できます。`;

    //通知変更state処理
    if (state?.mode === "WAIT_TIME") {
      if (text === "キャンセル") {
        await env.USER_STATE.delete(stateKey);
        replyText = "通知設定を中止しました。";
      }
      else {
        const toggle = parseNotifyToggle(text);
        // ===== ON / OFF =====
        if (toggle !== null) {
          let current =
            await env.TRANSPORT_DATA.get(`notify:${userId}`, { type: "json" });
          const hour = current?.hour ?? 22;
          const minute = current?.minute ?? 0;
          ctx.waitUntil(env.TRANSPORT_DATA.put(
            `notify:${userId}`,
            JSON.stringify({
              hour,
              minute,
              enabled: toggle
            })
          ));
          replyText = toggle
            ? "通知をONにしました。"
            : "通知をOFFにしました。";
          ctx.waitUntil(env.USER_STATE.delete(stateKey));
        }
        // ===== 時刻変更 =====
        else {
          try {
            if (!isTimeInput(text)) {
              throw "時刻の形式が正しくありません。\n(例:22時, 22:00, 22時半, 22時30分)";
            }
            const { h, m } = parseTimeInput(text);
            if (m !== 0 && m !== 30) {
              throw "通知時間は00分または30分のみ指定できます。";
            }
            ctx.waitUntil(env.TRANSPORT_DATA.put(
              `notify:${userId}`,
              JSON.stringify({
                hour: h,
                minute: m,
                enabled: true
              })
            ));
            replyText = `通知時間を ${h}時${m}分 に設定しました。`;
            ctx.waitUntil(env.USER_STATE.delete(stateKey));
          } catch (e) {
            replyText = String(e);
          }
        }
      }
    }

    //往復返信待ち処理
    else if (state?.mode === "WAIT_ROUND_CONFIRM") {
      if (text === "キャンセル") {
        await env.USER_STATE.delete(stateKey);
        replyText = "登録を中止しました。";
      }
      else if (text === "はい" || text.toLowerCase() === "y") {
        const temp = state.temp;
        const createdAt = new Date().toISOString();

        const record = {
          date: toJSTDateString(temp.date),  // ← 文字列で保存
          from: temp.from,
          to: temp.to,
          amount: temp.amount * 2,
          createdAt,
          roundTrip: true,
        };
        //cancelラベル
        await env.USER_STATE.put(
          `cancelable:${userId}`,
          "true",
          { expirationTtl: 60 * 3 }
        );
        ctx.waitUntil((async () => {
          await addTransportRecord(env, userId, record);
          await env.USER_STATE.delete(stateKey);
        })());

        replyText = "往復として登録しました。";
      }
      else if (text === "いいえ" || text.toLowerCase() === "n") {
        const temp = state.temp;
        const createdAt = new Date().toISOString();

        const record = {
          date: toJSTDateString(temp.date),  // ← 文字列で保存
          from: temp.from,
          to: temp.to,
          amount: temp.amount,
          createdAt,
          roundTrip: false,
        };
        //cancelラベル
        await env.USER_STATE.put(
          `cancelable:${userId}`,
          "true",
          { expirationTtl: 60 * 3 }
        );
        ctx.waitUntil((async () => {
          await addTransportRecord(env, userId, record);
          await env.USER_STATE.delete(stateKey);
        })());

        replyText = "片道として登録しました。";
      }
      else {
        replyText = "「はい」または「いいえ」で入力してください。";
      }
    }

    // 再送STATE管理
    else if (state?.mode === "WAIT_PDF_MONTH") {
      if (text === "キャンセル") {
        await env.USER_STATE.delete(stateKey);
        replyText = "再送を中止しました。";
      }
      else{
        try {
          const { year, month } = parsePDFMonthInput(text);
          const records = await getTransportByMonth(env, userId, year, month);
          if (records.length === 0) {
            replyText = `${year}年${month}月 のデータは存在しません。`;
            await env.USER_STATE.delete(stateKey);
          } else {
            let total = 0;
            const listText = records.map(r => {
              total += r.amount;
              return formatTransportDisplay(r);
            }).join("\n");

            replyText = `【${year}年${month}月の交通費】\n${listText}\n合計: ${total}円`;
            await env.USER_STATE.delete(stateKey);
          }
        }
          catch (e) {
          replyText = e + "\nもう一度入力してください。";
        }
      }
    }

    // ===== 月次受信設定STATE処理 =====
    else if (state?.mode === "WAIT_SUMMARY_SETTING") {
      if (text === "キャンセル") {
        await env.USER_STATE.delete(stateKey);
        replyText = "受信設定を中止しました。";
      }
      else {
        try {
          const parsed = parseSummarySettingInput(text);
          ctx.waitUntil(env.TRANSPORT_DATA.put(
            `summary:${userId}`,
            JSON.stringify(parsed)
          ));
          replyText =
            `送信日を毎月${parsed.day}日 ${parsed.hour}時${parsed.minute}分に設定しました。\n` +
            `※送信対象は前月分になります。`;
          await env.USER_STATE.delete(stateKey);
        } catch (e) {
          replyText = e + "\nもう一度入力してください。";
        }
      }
    }

    //キャンセルSTAET管理
    else if (state?.mode === "WAIT_DELETE_INDEX") {
      if (text === "キャンセル") {
        await env.USER_STATE.delete(stateKey);
        replyText = "削除を中止しました。";
      }
      else {
        const index = Number(text);
        if (isNaN(index)) {
          replyText = "番号を入力してください。";
        } else {
          const key = `transport:${userId}`;
          const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];
          const indexes = state.temp.indexes;

          if (index === 0) {
            // 一括削除
            replyText = "該当日の登録を全て削除しました。";
            await env.USER_STATE.delete(stateKey);          
            ctx.waitUntil((async() => {
              const remaining = list.filter(t =>
                toJSTDateString(t.date) !== state.temp.date
              );
              if (remaining.length === 0) {
                const todayKey = `today:${userId}:${state.temp.date}`;
                await env.TRANSPORT_DATA.delete(todayKey);
                ctx.waitUntil(env.TRANSPORT_DATA.delete(key));
              } else {
                ctx.waitUntil(env.TRANSPORT_DATA.put(key, JSON.stringify(remaining)));
              }

              // 今日フラグ再判定
              const stillExists = remaining.some(t =>
                toJSTDateString(t.date) === state.temp.date
              );
              if (!stillExists) {
                const todayKey = `today:${userId}:${state.temp.date}`;
                await env.TRANSPORT_DATA.delete(todayKey);
              }
            })());
          }

          else if (index >= 1 && index <= indexes.length) {
            //先に返信
            replyText = "指定した登録を削除しました。";
            await env.USER_STATE.delete(stateKey);

            ctx.waitUntil((async() => {
              const targetCreatedAt = indexes[index - 1];
              const newList = list.filter(t =>
                t.createdAt !== targetCreatedAt
              );
              if (newList.length === 0) {
                ctx.waitUntil(env.TRANSPORT_DATA.delete(key));
              } else {
                ctx.waitUntil(env.TRANSPORT_DATA.put(key, JSON.stringify(newList)));
              }
              // その日がまだ残っているか確認
              const stillExists = newList.some(t =>
                toJSTDateString(t.date) === state.temp.date
              );
              if (!stillExists) {
                const todayKey = `today:${userId}:${state.temp.date}`;
                await env.TRANSPORT_DATA.delete(todayKey);
              }
            })());
          }
          else {
            replyText = "無効な番号です。";
          }
        }
      }
    }

    // ===== 使い方 =====
    else if (text === "使い方") {
      replyText = USAGE_MESSAGE;
    }

    //登録催促通知
    else if (text.replace(/\s/g, "") === "通知") {
      await env.USER_STATE.put(stateKey, JSON.stringify({
        mode: "WAIT_TIME",
        expiresAt: Date.now() + 60 * 1000
      }));
      replyText = "通知時間またはオン/オフと入力してください。\n(例:22:00, 22:30, 22, 22時半)\nキャンセルと送ると中止できます。";
    }

    //月データ再取得
    else if (text === "再送") {
      await env.USER_STATE.put(stateKey, JSON.stringify({
        mode: "WAIT_PDF_MONTH",
        expiresAt: Date.now() + 60 * 1000
      }));
      replyText = "再送する月を入力してください(例:4月, 2025年4月, 2025/4)\nキャンセルと送ると中止できます。";
    }

    // ===== 月次受信設定 =====
    else if (text.replace(/\s/g, "") === "受信設定") {
      await env.USER_STATE.put(stateKey, JSON.stringify({
        mode: "WAIT_SUMMARY_SETTING",
        expiresAt: Date.now() + 60 * 1000
      }));

      replyText =
        "送信日を入力してください。\n" +
        "(例:27日, 4月27日, 27日 12:00)\n" +
        "※日付のみ入力時は12:00に送信されます。\n" +
        "キャンセルと送ると中止できます。";
    }

    //登録取り消し
    else if (text === "キャンセル") {
      const canCancel = await env.USER_STATE.get(`cancelable:${userId}`);
      if (!canCancel) {
        replyText = "直前にキャンセル可能な登録はありません。";
      } else{
          const key = `transport:${userId}`;
          const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];
          if (list.length === 0) {
            replyText = "直前にキャンセル可能な登録はありません。";
          } else {
            const last = list[list.length - 1];
            const created = new Date(last.createdAt).getTime();
            const diff = Date.now() - created;

            if (diff > 3 * 60 * 1000) {
              replyText = "直前キャンセルの有効時間(3分)を過ぎています。";
            } else {
              ctx.waitUntil(deleteLastTransport(env, userId));
              await env.USER_STATE.delete(`cancelable:${userId}`)
              const d = new Date(last.date);
              replyText =
                `直前の登録を削除しました。\n` +
                formatTransportDisplay(last);
            }
          }
        await env.USER_STATE.delete(stateKey);
        }
    }

    else if (text.endsWith("キャンセル")) {
      try {
        const token = text.replace("キャンセル", "").trim();
        const date = parseDate(token);
        const target = toJSTDateString(date);
        const key = `transport:${userId}`;
        const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];

        //log確認
          logUnified("=== 日付指定キャンセル ===");
          logUnified("入力テキスト:", text);
          logUnified("解析した日付:", date);
          logUnified("target (toJSTDateString):", target);
          logUnified("現在のtransportリスト:", list);

        const matches = list
          .map((t, index) => ({ ...t, index }))
          .filter(t => toJSTDateString(t.date) === target);

        logUnified("一致したレコード:", matches);
        logUnified("t.date (raw):", list.map(t => t.date));
        logUnified("target:", target);

        if (matches.length === 0) {
          replyText = `日付:${date.toLocaleDateString("ja-JP")} の登録はありません。`;
        }
        else if (matches.length === 1) {
          const t = matches[0];
          list.splice(t.index, 1);
          if (list.length === 0) {
            ctx.waitUntil(env.TRANSPORT_DATA.delete(key));
          } else {
            await env.TRANSPORT_DATA.put(key, JSON.stringify(list));
          }
          replyText = `日付:${date.toLocaleDateString("ja-JP")} の登録を削除しました。`;
          const todayKey = `today:${userId}:${target}`;
          ctx.waitUntil(env.TRANSPORT_DATA.delete(todayKey));

        }
        else {
          let message = "複数件の登録があります。\n";
          message += "0: 一括削除\n";
          matches.forEach((t, i) => {
            const d = new Date(t.date);
            message += `${i + 1}: ${formatTransportDisplay(t)}\n`;
          });
          message += "削除するデータの番号を選択してください。\nキャンセルと送ると中止できます。";
          await env.USER_STATE.put(
            stateKey,
            JSON.stringify({
              mode: "WAIT_DELETE_INDEX",
              expiresAt: Date.now() + 60 * 1000,
              temp: {
                date: target,
                indexes: matches.map(t => t.createdAt)
              }
            })
          );
          replyText = message;
        }
      } catch (e) {
        logUnified("キャンセル処理エラー:", e);
        replyText = e + "\nもう一度入力してください。";
      }
    }

    //交通費登録
    else if (isTransportInput(text)) {
      try {
        const data = parseTransport(text);

        // ★ 先に返信文を確定
        replyText = `以下の内容で登録しました。
日付:${data.date.toLocaleDateString("ja-JP")}
区間:${data.from} → ${data.to}
金額:${data.amount}円
往復ですか？ (はい/いいえ)`;

        // ★ ここから後処理（返信と切り離す）
        await env.USER_STATE.put(stateKey, JSON.stringify({
          mode: "WAIT_ROUND_CONFIRM",
          expiresAt: Date.now() + 60 * 1000,
          temp: {
            date: data.date.toISOString(),
            from: data.from,
            to: data.to,
            amount: data.amount
          }
        }));
      } catch (e) {
        replyText = String(e?.message ?? e);
      }
    }

    //未対応内容の受信
    else {
      replyText = "未対応の入力です。\n「使い方」と送ると操作方法を確認できます。";
    }

    //デバック用log
    logUnified("FINAL replyText:", replyText);
    logUnified("STATE:", state);
    logUnified("TEXT:", text);

    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: replyText }]
      })
    });
    flushLogs();
    return new Response("OK", { status: 200 });
  },
  //スケジュール機能の利用
  async scheduled(event, env, ctx) {
    await handleCron(env, ctx);
  }
}