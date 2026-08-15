import {
  toJSTDateString
} from "./utils.js";

// ===== DB操作関数 =====
export async function addTransportRecord(env, userId, record) {
  const key = `transport:${userId}`;
  const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];

  list.push(record);

  await env.TRANSPORT_DATA.put(key, JSON.stringify(list));

  const todayKey = `today:${userId}:${toJSTDateString(record.date)}`;
  await env.TRANSPORT_DATA.put(todayKey, "true",{ expirationTtl: 60 * 60 * 24 * 3 });
}

// ===== 直前削除関数 =====
export async function deleteLastTransport(env, userId) {
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
export async function getTransportByMonth(env, userId, year, month) {
  const key = `transport:${userId}`;
  const list = await env.TRANSPORT_DATA.get(key, { type: "json" }) || [];

  return list
    .map(t => ({ ...t, date: new Date(t.date) }))
    .filter(t =>
      t.date.getFullYear() === year &&
      t.date.getMonth() === month - 1
    );
}