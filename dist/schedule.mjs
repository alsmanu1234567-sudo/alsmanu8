
// [SCHED-FIX-V2] العثور على أي سوكت متصل للمستخدم — يدعم مفاتيح الأرقام المتعددة userId_+phone
function _findSock(inMemoryDB, userId) {
  if (!inMemoryDB?.sessions) return null;
  const direct = inMemoryDB.sessions.get(userId) || inMemoryDB.sessions.get(`sess_${userId}`);
  if (direct?.sendMessage) return direct;
  if (direct?.sock?.sendMessage) return direct.sock;
  for (const [k, v] of inMemoryDB.sessions.entries()) {
    if (!String(k).startsWith(`${userId}_`)) continue;
    if (v?.sendMessage) return v;
    if (v?.sock?.sendMessage) return v.sock;
  }
  return null;
}

let _deps = {};
export function setDeps(d) { _deps = { ..._deps, ...d }; }

// ─── [SCHED-FIX] معالج النصوص للجدولة (كان مفقوداً تماماً) ───────────────
// الحالات: awaiting_schedule_target → awaiting_schedule_time → awaiting_schedule_message
//          awaiting_recurring_recipient → awaiting_recurring_interval → awaiting_recurring_message
export function isScheduleState(state) {
  return typeof state === "string" && (state.startsWith("awaiting_schedule_") || state.startsWith("awaiting_recurring_"));
}

function _normJid(input) {
  const raw = _asciiDigits(String(input || "")).trim().replace(/[+\s-]/g, "");
  if (!/^\d{6,20}$/.test(raw)) return null;
  // معرّفات المجموعات تبدأ عادة بـ 120 وطولها كبير
  if (raw.startsWith("120") && raw.length >= 15) return `${raw}@g.us`;
  return `${raw}@s.whatsapp.net`;
}

const DEFAULT_TIME_ZONE = "Africa/Khartoum";
const RECURRENCE_TYPES = new Set(["daily", "weekly", "monthly"]);
const _INTERVALS = {
  "يومي": "daily", daily: "daily",
  "اسبوعي": "weekly", "أسبوعي": "weekly", weekly: "weekly",
  "شهري": "monthly", monthly: "monthly"
};

function _validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function _asciiDigits(value) {
  return String(value).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function _localParts(timestamp, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: _validTimeZone(timeZone),
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const result = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return { year: result.year, month: result.month, day: result.day, hour: result.hour, minute: result.minute, second: result.second };
}

function _zonedTimestamp({ year, month, day, hour, minute, second = 0 }, timeZone = DEFAULT_TIME_ZONE) {
  const tz = _validTimeZone(timeZone);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = wanted;
  for (let i = 0; i < 5; i++) {
    const actual = _localParts(candidate, tz);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = wanted - represented;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  const check = _localParts(candidate, tz);
  return check.year === year && check.month === month && check.day === day &&
    check.hour === hour && check.minute === minute ? candidate : null;
}

function _addLocalDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function _addLocalMonth(parts, preferredDay = parts.day) {
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1;
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return { year: nextYear, month: nextMonth, day: Math.min(preferredDay, lastDay) };
}

export function getScheduleTimeZone(user) {
  return _validTimeZone(user?.scheduleTimeZone || DEFAULT_TIME_ZONE);
}

export function formatScheduleTime(timestamp, timeZone = DEFAULT_TIME_ZONE, includeDate = true) {
  return new Intl.DateTimeFormat("ar", {
    timeZone: _validTimeZone(timeZone),
    ...(includeDate ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(new Date(timestamp));
}

export function parseScheduleTime(text, { now = Date.now(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const t = _asciiDigits(text || "").trim().replace(/^بعد\s+/u, "");
  if (!t) return null;
  if (/^(دقيقة|دقيقه)$/u.test(t)) return now + 60000;
  if (/^(ساعة|ساعه)$/u.test(t)) return now + 3600000;
  if (/^يوم$/u.test(t)) return now + 86400000;

  const duration = t.match(/^(\d{1,5})\s*(m|min|mins|minute|minutes|د|دقيقة|دقائق|h|hr|hour|hours|س|ساعة|ساعات|d|day|days|ي|يوم|أيام|ايام)?$/iu);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = String(duration[2] || "m").toLowerCase();
    const multiplier = /^(h|hr|hour|hours|س|ساعة|ساعات)$/u.test(unit) ? 3600000 :
      /^(d|day|days|ي|يوم|أيام|ايام)$/u.test(unit) ? 86400000 : 60000;
    if (amount < 1 || amount > 36500) return null;
    return now + amount * multiplier;
  }

  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (match) {
    const parts = { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5] };
    if (parts.hour > 23 || parts.minute > 59) return null;
    const timestamp = _zonedTimestamp(parts, timeZone);
    return timestamp && timestamp > now ? timestamp : null;
  }
  match = t.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const current = _localParts(now, timeZone);
    const parts = { year: current.year, month: +match[2], day: +match[1], hour: +match[3], minute: +match[4] };
    if (parts.hour > 23 || parts.minute > 59) return null;
    const timestamp = _zonedTimestamp(parts, timeZone);
    return timestamp && timestamp > now ? timestamp : null;
  }
  match = t.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const current = _localParts(now, timeZone);
    const hour = +match[1], minute = +match[2];
    if (hour > 23 || minute > 59) return null;
    let timestamp = _zonedTimestamp({ ...current, hour, minute, second: 0 }, timeZone);
    if (!timestamp) return null;
    if (timestamp <= now) {
      const tomorrow = _addLocalDays(current, 1);
      timestamp = _zonedTimestamp({ ...tomorrow, hour, minute, second: 0 }, timeZone);
    }
    return timestamp;
  }
  return null;
}

function _parseTime(text, now, timeZone) {
  return parseScheduleTime(text, { now, timeZone });
}

function _nextRecurringTimestamp(item, previousTimestamp, now) {
  const timezone = getScheduleTimeZone({ scheduleTimeZone: item.timeZone });
  const recurrenceType = item.recurringType;
  if (!RECURRENCE_TYPES.has(recurrenceType)) {
    const interval = Number(item.recurring);
    if (!Number.isFinite(interval) || interval <= 0) return null;
    let next = previousTimestamp + interval;
    if (next <= now) next += (Math.floor((now - next) / interval) + 1) * interval;
    return next;
  }

  let dueParts = _localParts(previousTimestamp, timezone);
  let next;
  for (let i = 0; i < 1000; i++) {
    const date = recurrenceType === "monthly" ? _addLocalMonth(dueParts, Number(item.localDay) || dueParts.day) :
      _addLocalDays(dueParts, recurrenceType === "weekly" ? 7 : 1);
    dueParts = { ...date, hour: item.localHour ?? dueParts.hour, minute: item.localMinute ?? dueParts.minute, second: 0 };
    next = _zonedTimestamp(dueParts, timezone);
    if (next && next > now) return next;
  }
  return null;
}

export function nextScheduleOccurrence(item, previousTimestamp, now = Date.now()) {
  return _nextRecurringTimestamp(item, previousTimestamp, now);
}

function _normalizeRecipients(input, allowMultiple) {
  const values = String(input || "").split(/[,\n;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!values.length || (!allowMultiple && values.length > 1) || values.length > 10) return null;
  const jids = [];
  for (const value of values) {
    const jid = _normJid(value);
    if (!jid) return null;
    if (!jids.includes(jid)) jids.push(jid);
  }
  return jids.length ? jids : null;
}

function _scheduleMenuKeyboard(user) {
  const rows = [
    [{ text: "🟢 جدولة جديدة", callback_data: "schedule_add" }, { text: "🔁 متكررة", callback_data: "schedule_recurring" }],
    [{ text: "⏱ بعد دقيقة", callback_data: "schedule_quick_1m" }, { text: "⏱ بعد 5 دقائق", callback_data: "schedule_quick_5m" }],
    [{ text: "⏱ بعد ساعة", callback_data: "schedule_quick_1h" }, { text: "⏱ بعد يوم", callback_data: "schedule_quick_1d" }],
    [{ text: "📋 القائمة وإدارة المهام", callback_data: "schedule_list" }],
    [{ text: "🕒 الوقت الحالي", callback_data: "schedule_clock" }, { text: "📊 الإحصائيات", callback_data: "schedule_stats" }],
    [{ text: "🗑 حذف موعد", callback_data: "schedule_delete" }]
  ];
  if (user?.tier === "mizaj") {
    rows.push([{ text: "💎 ميزاج: أدوات الجدولة", callback_data: "schedule_mizaj", style: "success" }]);
  } else {
    rows.push([{ text: "🔒 أدوات ميزاج", callback_data: "schedule_mizaj" }]);
  }
  rows.push([{ text: "🔙 الرئيسية", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function _recurrenceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "يومي", callback_data: "schedule_rec_daily" }, { text: "أسبوعي", callback_data: "schedule_rec_weekly" }],
      [{ text: "شهري", callback_data: "schedule_rec_monthly" }],
      [{ text: "إلغاء", callback_data: "cancel" }]
    ]
  };
}

function _templateKeyboard(user, stateData) {
  const hasTemplates = Array.isArray(user?.scheduleTemplates) && user.scheduleTemplates.length > 0;
  return {
    inline_keyboard: [
      ...(user?.tier === "mizaj" && hasTemplates
        ? [[{ text: "💎 استخدام قالب", callback_data: "schedule_templates_current", style: "success" }]]
        : []),
      [{ text: "إلغاء", callback_data: "cancel" }]
    ]
  };
}

function _templateVariables(message, item, recipient, now) {
  const timezone = getScheduleTimeZone({ scheduleTimeZone: item.timeZone });
  const local = _localParts(now, timezone);
  const date = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return String(message)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{recipient}", String(recipient || "").split("@")[0]);
}

function _createScheduleItem(userId, state, message) {
  const user = _deps.getUser(userId);
  const data = state?.data || {};
  const recurringType = data.recInterval;
  const recipients = data.schedRecipients || data.recRecipients || [data.schedJid || data.recJid];
  const isRecurring = RECURRENCE_TYPES.has(recurringType);
  const localTime = isRecurring ? _localParts(data.recAt, data.timeZone || getScheduleTimeZone(user)) : null;
  const item = {
    id: `${isRecurring ? "rec" : "sch"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    jid: recipients[0],
    ...(recipients.length > 1 ? { recipients } : {}),
    message: String(message).trim(),
    sendAt: isRecurring ? data.recAt : data.schedAt,
    ...(isRecurring ? {
      recurringType,
      recurrenceLimit: Number(data.recurrenceLimit) || 0,
      sentCount: 0,
      localHour: localTime.hour,
      localMinute: localTime.minute,
      localDay: localTime.day
    } : {}),
    timeZone: data.timeZone || getScheduleTimeZone(user),
    templateVariables: user.tier === "mizaj",
    status: "pending",
    createdAt: Date.now()
  };
  const list = Array.isArray(user.scheduledMessages) ? user.scheduledMessages : [];
  list.push(item);
  _deps.saveUser(userId, { scheduledMessages: list });
  return item;
}

function _itemRecipients(item) {
  return Array.isArray(item.recipients) && item.recipients.length ? item.recipients : [item.jid].filter(Boolean);
}

export async function handleScheduleText(bot2, msg) {
  const { getUser, saveUser, setState, clearState, getState, cancelKeyboard, scheduleMenuKeyboard } = _deps;
  if (!getState) return false;
  const userId = String(msg.from?.id || "");
  const chatId = msg.chat.id;
  const st = getState(userId);
  if (!isScheduleState(st.state)) return false;
  const text = String(msg.text || "").trim();
  if (text === "إلغاء" || text === "/cancel") {
    clearState?.(userId);
    await bot2.sendMessage(chatId, "✅ تم الإلغاء.", { reply_markup: _scheduleMenuKeyboard(getUser(userId)) });
    return true;
  }
  const data = st.data || {};
  const user = getUser(userId);
  const timeZone = getScheduleTimeZone(user);
  const isMizaj = user.tier === "mizaj";

  if (st.state === "awaiting_schedule_template_name") {
    if (!isMizaj) {
      clearState?.(userId);
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    const name = text.slice(0, 32);
    if (!name) {
      await bot2.sendMessage(chatId, "❌ أدخل اسماً للقالب:", { reply_markup: cancelKeyboard?.() });
      return true;
    }
    setState(userId, "awaiting_schedule_template_content", { templateName: name });
    await bot2.sendMessage(chatId, "أرسل نص القالب. يمكنك استخدام المتغيرات `{date}` و`{time}` و`{recipient}`.", { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
    return true;
  }
  if (st.state === "awaiting_schedule_template_content") {
    if (!isMizaj) {
      clearState?.(userId);
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    if (!text) {
      await bot2.sendMessage(chatId, "❌ نص القالب لا يمكن أن يكون فارغاً.", { reply_markup: cancelKeyboard?.() });
      return true;
    }
    const templates = Array.isArray(user.scheduleTemplates) ? user.scheduleTemplates : [];
    if (templates.length >= 20) {
      clearState?.(userId);
      await bot2.sendMessage(chatId, "وصلت إلى الحد الأقصى: 20 قالباً.");
      return true;
    }
    templates.push({
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: data.templateName || "قالب",
      message: text.slice(0, 3000),
      createdAt: Date.now()
    });
    saveUser(userId, { scheduleTemplates: templates });
    clearState?.(userId);
    await bot2.sendMessage(chatId, "✅ تم حفظ القالب.", { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }

  // ── رسالة مجدولة لمرة واحدة ──
  if (st.state === "awaiting_schedule_target") {
    const recipients = _normalizeRecipients(text, isMizaj);
    if (!recipients) {
      await bot2.sendMessage(chatId, isMizaj
        ? "❌ أرسل أرقاماً صحيحة مع رمز الدولة، مفصولة بمسافة أو فاصلة (حتى 10 أرقام)."
        : "❌ رقم غير صالح. أدخل الرقم مع كود الدولة، مثال: `249960506662`",
      { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
      return true;
    }
    if (data.quickDelayMs) {
      setState(userId, "awaiting_schedule_message", {
        ...data, schedJid: recipients[0], schedRecipients: recipients,
        schedAt: Date.now() + data.quickDelayMs, timeZone
      });
      await bot2.sendMessage(chatId, `⏱️ الموعد بعد ${Math.round(data.quickDelayMs / 60000)} دقيقة.\nأرسل نص الرسالة الآن:`, { reply_markup: cancelKeyboard?.() });
      return true;
    }
    setState(userId, "awaiting_schedule_time", { ...data, schedJid: recipients[0], schedRecipients: recipients, timeZone });
    await bot2.sendMessage(
      chatId,
      `📅 *الخطوة 2/3:* متى تريد الإرسال؟\n\n• \`1m\` أو \`1 دقيقة\` → بعد دقيقة\n• \`2h\` → بعد ساعتين\n• \`1d\` أو \`1 يوم\` → بعد يوم\n• \`21:30\` → أقرب موعد قادم بهذا الوقت\n• \`2026-11-10 14:00\` → تاريخ ووقت محلي\n\nالمنطقة الزمنية: \`${timeZone}\`${isMizaj && recipients.length > 1 ? `\nالمستلمون: ${recipients.length}` : ""}`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() }
    );
    return true;
  }
  if (st.state === "awaiting_schedule_time") {
    const ts = _parseTime(text, Date.now(), data.timeZone || timeZone);
    if (!ts) {
      await bot2.sendMessage(chatId, "❌ الوقت غير صالح أو أصبح في الماضي. أمثلة: `1m` أو `1 يوم` أو `21:30` أو `2026-11-10 14:00`", { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
      return true;
    }
    setState(userId, "awaiting_schedule_message", { ...data, schedAt: ts });
    const date = formatScheduleTime(ts, data.timeZone || timeZone);
    await bot2.sendMessage(chatId, `📅 *الخطوة 3/3:* موعد الإرسال: ${date}\n\nأرسل *نص الرسالة* الآن:`, { parse_mode: "Markdown", reply_markup: _templateKeyboard(user, data) });
    return true;
  }
  if (st.state === "awaiting_schedule_message") {
    const finalMessage = String(data.templateMessage ?? text).trim();
    if (!finalMessage) {
      await bot2.sendMessage(chatId, "❌ الرسالة لا يمكن أن تكون فارغة. أرسل نص الرسالة:", { reply_markup: cancelKeyboard?.() });
      return true;
    }
    const list = user.scheduledMessages || [];
    const recipients = data.schedRecipients || [data.schedJid];
    const item = {
      id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      jid: recipients[0],
      ...(recipients.length > 1 ? { recipients } : {}),
      message: finalMessage,
      sendAt: data.schedAt,
      status: "pending",
      createdAt: Date.now(),
      timeZone: data.timeZone || timeZone,
      templateVariables: isMizaj
    };
    list.push(item);
    saveUser(userId, { scheduledMessages: list });
    clearState?.(userId);
    const date = formatScheduleTime(item.sendAt, item.timeZone);
    const recipientLabel = recipients.length > 1 ? `${recipients.length} مستلمين` : `+${item.jid.split("@")[0]}`;
    await bot2.sendMessage(chatId, `✅ تمت الجدولة بنجاح!\n\n📱 المستلم: ${recipientLabel}\n📅 الموعد: ${date}\n🌍 المنطقة: ${item.timeZone}\n💬 "${finalMessage.slice(0, 60)}"`, { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }

  // ── رسالة متكررة ──
  if (st.state === "awaiting_recurring_recipient") {
    const recipients = _normalizeRecipients(text, isMizaj);
    if (!recipients) {
      await bot2.sendMessage(chatId, isMizaj
        ? "❌ أرسل أرقاماً صحيحة مع رمز الدولة، مفصولة بمسافة أو فاصلة (حتى 10 أرقام)."
        : "❌ رقم غير صالح. أدخل الرقم مع كود الدولة:",
      { reply_markup: cancelKeyboard?.() });
      return true;
    }
    setState(userId, "awaiting_recurring_interval", { ...data, recJid: recipients[0], recRecipients: recipients, timeZone });
    await bot2.sendMessage(chatId, "🔁 *الخطوة 2/4:* اختر التكرار من الأزرار:", { parse_mode: "Markdown", reply_markup: _recurrenceKeyboard() });
    return true;
  }
  if (st.state === "awaiting_recurring_interval") {
    const iv = _INTERVALS[text.toLowerCase()] || _INTERVALS[text];
    if (!iv) {
      await bot2.sendMessage(chatId, "⚠️ اضغط أحد أزرار التكرار أعلاه.", { reply_markup: _recurrenceKeyboard() });
      return true;
    }
    setState(userId, "awaiting_recurring_time", { ...data, recInterval: iv });
    await bot2.sendMessage(chatId, "🔁 *الخطوة 3/4:* أدخل موعد أول إرسال، مثل `20:22` أو `2h`.\nإذا كان الوقت اليوم ما زال قادماً فسيبدأ اليوم.", { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
    return true;
  }
  if (st.state === "awaiting_recurring_time") {
    const ts = _parseTime(text, Date.now(), data.timeZone || timeZone);
    if (!ts) {
      await bot2.sendMessage(chatId, "❌ الموعد غير صالح أو أصبح في الماضي. مثال: `20:22` أو `2h`", { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
      return true;
    }
    if (isMizaj) {
      setState(userId, "awaiting_recurring_count", { ...data, recAt: ts });
      await bot2.sendMessage(chatId, "💎 حدد عدد مرات الإرسال (1–100)، أو أرسل `0` للتكرار بلا حد:", { parse_mode: "Markdown", reply_markup: cancelKeyboard?.() });
    } else {
      setState(userId, "awaiting_recurring_message", { ...data, recAt: ts, recurrenceLimit: 0 });
      await bot2.sendMessage(chatId, "🔁 *الخطوة 4/4:* أرسل *نص الرسالة* المتكررة:", { parse_mode: "Markdown", reply_markup: _templateKeyboard(user, data) });
    }
    return true;
  }
  if (st.state === "awaiting_recurring_count") {
    if (!isMizaj) {
      setState(userId, "awaiting_recurring_message", { ...data, recurrenceLimit: 0 });
      await bot2.sendMessage(chatId, "🔁 أرسل نص الرسالة المتكررة:", { reply_markup: _templateKeyboard(user, data) });
      return true;
    }
    const count = Number(_asciiDigits(text));
    if (!Number.isInteger(count) || count < 0 || count > 100) {
      await bot2.sendMessage(chatId, "❌ أرسل رقماً صحيحاً من 0 إلى 100.", { reply_markup: cancelKeyboard?.() });
      return true;
    }
    setState(userId, "awaiting_recurring_message", { ...data, recurrenceLimit: count });
    await bot2.sendMessage(chatId, "أرسل نص الرسالة المتكررة:", { reply_markup: _templateKeyboard(user, data) });
    return true;
  }
  if (st.state === "awaiting_recurring_message") {
    if (!text) {
      await bot2.sendMessage(chatId, "❌ الرسالة لا يمكن أن تكون فارغة.", { reply_markup: cancelKeyboard?.() });
      return true;
    }
    const list = user.scheduledMessages || [];
    const localTime = _localParts(data.recAt, data.timeZone || timeZone);
    const recipients = data.recRecipients || [data.recJid];
    const item = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      jid: recipients[0],
      ...(recipients.length > 1 ? { recipients } : {}),
      message: text,
      sendAt: data.recAt,
      recurringType: data.recInterval,
      recurrenceLimit: Number(data.recurrenceLimit) || 0,
      sentCount: 0,
      localHour: localTime.hour,
      localMinute: localTime.minute,
      localDay: localTime.day,
      timeZone: data.timeZone || timeZone,
      templateVariables: isMizaj,
      status: "pending",
      createdAt: Date.now()
    };
    list.push(item);
    saveUser(userId, { scheduledMessages: list });
    clearState?.(userId);
    const date = formatScheduleTime(item.sendAt, item.timeZone);
    const recipientLabel = recipients.length > 1 ? `${recipients.length} مستلمين` : `+${item.jid.split("@")[0]}`;
    const recurrenceLabel = data.recInterval === "daily" ? "يومي" : data.recInterval === "weekly" ? "أسبوعي" : "شهري";
    await bot2.sendMessage(chatId, `✅ *تم إنشاء الرسالة المتكررة!*\n\n📱 المستلم: ${recipientLabel}\n🔁 التكرار: ${recurrenceLabel}\n📅 أول إرسال: ${date}\n🌍 المنطقة: ${item.timeZone}`, { parse_mode: "Markdown", reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }
  return false;
}

// ─── حلقة تسليم الرسائل: المستخدمون من getAllUsers() سجلات، لا مفاتيح Map ──
let _loopTimer = null;
let _loopRunning = false;
export async function processDueSchedules(bot2, now = Date.now()) {
  if (_loopRunning) return;
  const { getAllUsers, getUser, saveUser, inMemoryDB } = _deps;
  if (!getAllUsers || !inMemoryDB) return;
  _loopRunning = true;
  try {
    const rawUsers = getAllUsers() || [];
    const entries = Array.isArray(rawUsers)
      ? rawUsers.map((u) => [String(u?.telegramId || ""), u])
      : Object.entries(rawUsers);
    for (const [candidateId] of entries) {
      const userId = String(candidateId || "");
      if (!userId) continue;
      const user = getUser ? getUser(userId) : entries.find(([id]) => String(id) === userId)?.[1];
      const list = Array.isArray(user?.scheduledMessages) ? user.scheduledMessages : [];
      let changed = false;
      for (const item of list) {
        if (item?.status !== "pending") continue;
        const dueAt = typeof item.sendAt === "number" ? item.sendAt : new Date(item.sendAt).getTime();
        if (!Number.isFinite(dueAt) || dueAt > now) continue;
        const sock = _findSock(inMemoryDB, userId);
        if (!sock?.sendMessage) {
          item._retries = (Number(item._retries) || 0) + 1;
          if (item._retries > 12) {
            item.status = "failed";
            item.error = "لا يوجد اتصال واتساب بعد 12 محاولة";
            item.failedAt = now;
          } else {
            item.sendAt = now + 300000;
          }
          changed = true;
          continue;
        }

        try {
          const recipients = _itemRecipients(item);
          if (!recipients.length) throw new Error("لا يوجد مستلم صالح");
          const deliveredRecipients = new Set(Array.isArray(item.deliveredRecipients) ? item.deliveredRecipients : []);
          for (let i = 0; i < recipients.length; i++) {
            const recipient = recipients[i];
            if (deliveredRecipients.has(recipient)) continue;
            const message = item.templateVariables
              ? _templateVariables(item.message || "", item, recipient, now)
              : String(item.message || "");
            await sock.sendMessage(recipient, { text: message });
            deliveredRecipients.add(recipient);
            if (recipients.length > 1) {
              item.deliveredRecipients = [...deliveredRecipients];
              saveUser?.(userId, { scheduledMessages: list });
            }
            if (i + 1 < recipients.length) await new Promise((resolve) => setTimeout(resolve, 300));
          }
          const recurring = RECURRENCE_TYPES.has(item.recurringType) || Number(item.recurring) > 0;
          delete item.deliveredRecipients;
          if (recurring) {
            item.sentCount = (Number(item.sentCount) || 0) + 1;
            if (Number(item.recurrenceLimit) > 0 && item.sentCount >= Number(item.recurrenceLimit)) {
              item.status = "sent";
              item.sentAt = now;
              item.completedAt = now;
              item.lastError = null;
              item._retries = 0;
            } else {
              const next = _nextRecurringTimestamp(item, dueAt, now);
              if (!next) {
              item.status = "failed";
              item.error = "تعذر حساب موعد التكرار التالي";
              item.failedAt = now;
              } else {
                item.sendAt = next;
                item.lastSentAt = now;
                item.lastError = null;
                item._retries = 0;
              }
            }
          } else {
            item.status = "sent";
            item.sentAt = now;
            item.lastError = null;
            item._retries = 0;
          }
          changed = true;
          try {
            if (user.telegramChatId) {
              const destination = recipients.length === 1 ? `+${recipients[0].split("@")[0]}` : `${recipients.length} مستلمين`;
              await bot2.sendMessage(user.telegramChatId, `✅ تم إرسال الرسالة المجدولة إلى ${destination}`);
            }
          } catch {}
        } catch (error) {
          item.status = "failed";
          item.error = String(error?.message || error).slice(0, 160);
          item.failedAt = now;
          changed = true;
          try {
            if (user.telegramChatId) await bot2.sendMessage(user.telegramChatId, `❌ تعذر إرسال الموعد إلى ${item.jid || "المستلم"}.\nالسبب: ${item.error}`);
          } catch {}
        }
      }
      if (changed) saveUser?.(userId, { scheduledMessages: list });
    }
  } finally {
    _loopRunning = false;
  }
}

export function startScheduleLoop(bot2) {
  if (_loopTimer) return;
  const runScheduleTick = () => processDueSchedules(bot2).catch(() => {});
  _loopTimer = setInterval(runScheduleTick, 5000);
  _loopTimer.unref?.();
  runScheduleTick();
}

export function stopScheduleLoop() {
  if (_loopTimer) clearInterval(_loopTimer);
  _loopTimer = null;
}

export async function handleScheduleCallback(bot2, chatId, userId, data) {
  const { getUser, saveUser, setState, clearState, getState, inMemoryDB, cancelKeyboard, scheduleMenuKeyboard } = _deps;
  const user = getUser(userId);
  const scheduled = Array.isArray(user.scheduledMessages) ? user.scheduledMessages : [];
  const timeZone = getScheduleTimeZone(user);

  if (data === "schedule_clock") {
    await bot2.sendMessage(chatId, `🕒 الوقت الآن: ${formatScheduleTime(Date.now(), timeZone)}\n🌍 المنطقة الزمنية: ${timeZone}`, { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }
  if (data.startsWith("schedule_quick_")) {
    const delay = { "schedule_quick_1m": 60000, "schedule_quick_5m": 300000, "schedule_quick_1h": 3600000, "schedule_quick_1d": 86400000 }[data];
    if (!delay) return false;
    if (!_findSock(inMemoryDB, userId)) {
      await bot2.sendMessage(chatId, "❌ اربط واتساب أولاً لجدولة الرسائل.");
      return true;
    }
    setState(userId, "awaiting_schedule_target", { quickDelayMs: delay, timeZone });
    await bot2.sendMessage(chatId, "أدخل رقم المستلم مع رمز الدولة، أو معرّف المجموعة:", { reply_markup: cancelKeyboard() });
    return true;
  }
  if (data.startsWith("schedule_rec_") && data !== "schedule_recurring") {
    const recurrenceType = {
      schedule_rec_daily: "daily",
      schedule_rec_weekly: "weekly",
      schedule_rec_monthly: "monthly"
    }[data];
    if (!recurrenceType) return false;
    const currentState = getState?.(userId);
    if (currentState?.state !== "awaiting_recurring_interval") {
      await bot2.sendMessage(chatId, "ابدأ إعداد الرسالة المتكررة من القائمة أولاً.");
      return true;
    }
    setState(userId, "awaiting_recurring_time", { ...(currentState.data || {}), recInterval: recurrenceType });
    await bot2.sendMessage(chatId, "أدخل موعد أول إرسال، مثل `20:22` أو `2h`. إذا كان الوقت اليوم ما زال قادماً فسيبدأ اليوم.", { parse_mode: "Markdown", reply_markup: cancelKeyboard() });
    return true;
  }
  if (data === "schedule_mizaj") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 هذه الأدوات متاحة لفئة ميزاج فقط.", {
        reply_markup: { inline_keyboard: [[{ text: "رجوع", callback_data: "menu_schedule" }]] }
      });
      return true;
    }
    await bot2.sendMessage(chatId, "💎 أدوات الجدولة لميزاج\n\n• منطقة زمنية قابلة للاختيار\n• حتى 10 مستلمين في موعد واحد\n• قوالب محفوظة مع متغيرات التاريخ والوقت والرقم", {
      reply_markup: {
        inline_keyboard: [
          [{ text: `🌍 المنطقة الحالية: ${timeZone}`, callback_data: "schedule_timezone", style: "success" }],
          [{ text: "👥 جدولة لعدة مستلمين", callback_data: "schedule_mizaj_multi", style: "success" }],
          [{ text: "➕ حفظ قالب", callback_data: "schedule_template_add", style: "success" }],
          [{ text: "📚 قوالبي", callback_data: "schedule_templates_current", style: "success" }],
          [{ text: "🔁 تكرار بعدد محدد", callback_data: "schedule_recurring", style: "success" }],
          [{ text: "🔤 متغيرات القوالب", callback_data: "schedule_variables_help", style: "success" }],
          [{ text: "🔙 رجوع", callback_data: "menu_schedule" }]
        ]
      }
    });
    return true;
  }
  if (data === "schedule_mizaj_multi") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 جدولة عدة مستلمين متاحة لفئة ميزاج فقط.");
      return true;
    }
    setState(userId, "awaiting_schedule_target", { timeZone });
    await bot2.sendMessage(chatId, "أدخل حتى 10 أرقام مع رمز الدولة، مفصولة بفاصلة أو مسافة. بعدها اختر وقت الإرسال والرسالة.", { reply_markup: cancelKeyboard() });
    return true;
  }
  if (data === "schedule_variables_help") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 متغيرات القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    await bot2.sendMessage(chatId, "في نص القالب يمكنك استخدام:\n• `{date}` — تاريخ التنفيذ حسب منطقتك الزمنية\n• `{time}` — وقت التنفيذ حسب منطقتك الزمنية\n• `{recipient}` — رقم المستلم الحالي\n\nتُستبدل القيم وقت الإرسال.");
    return true;
  }
  if (data === "schedule_timezone") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 اختيار المنطقة الزمنية متاح لفئة ميزاج فقط.");
      return true;
    }
    await bot2.sendMessage(chatId, "اختر المنطقة الزمنية التي تُستخدم في عرض المواعيد والتكرار:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "الخرطوم", callback_data: "schedule_tz_khartoum", style: "success" }],
          [{ text: "الرياض", callback_data: "schedule_tz_riyadh", style: "success" }],
          [{ text: "UTC", callback_data: "schedule_tz_utc", style: "success" }],
          [{ text: "رجوع", callback_data: "schedule_mizaj" }]
        ]
      }
    });
    return true;
  }
  if (data.startsWith("schedule_tz_")) {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 اختيار المنطقة الزمنية متاح لفئة ميزاج فقط.");
      return true;
    }
    const selected = {
      schedule_tz_khartoum: "Africa/Khartoum",
      schedule_tz_riyadh: "Asia/Riyadh",
      schedule_tz_utc: "UTC"
    }[data];
    if (!selected) return false;
    saveUser(userId, { scheduleTimeZone: selected });
    await bot2.sendMessage(chatId, `✅ تم ضبط المنطقة الزمنية على ${selected}.`, { reply_markup: _scheduleMenuKeyboard({ ...user, scheduleTimeZone: selected }) });
    return true;
  }
  if (data === "schedule_template_add") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    if ((user.scheduleTemplates || []).length >= 20) {
      await bot2.sendMessage(chatId, "وصلت إلى الحد الأقصى: 20 قالباً.");
      return true;
    }
    setState(userId, "awaiting_schedule_template_name");
    await bot2.sendMessage(chatId, "أرسل اسماً للقالب:", { reply_markup: cancelKeyboard() });
    return true;
  }
  if (data === "schedule_templates_current") {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    const templates = Array.isArray(user.scheduleTemplates) ? user.scheduleTemplates : [];
    const currentState = getState?.(userId);
    const canUse = ["awaiting_schedule_message", "awaiting_recurring_message"].includes(currentState?.state);
    if (!templates.length) {
      await bot2.sendMessage(chatId, "لا توجد قوالب محفوظة بعد.", { reply_markup: _scheduleMenuKeyboard(user) });
      return true;
    }
    const rows = templates.slice(-10).map((template) => [{
      text: `📄 ${String(template.name || "قالب").slice(0, 30)}`,
      callback_data: canUse ? `schedule_template_use_${template.id}` : `schedule_template_view_${template.id}`,
      ...(canUse ? { style: "success" } : {})
    }]);
    rows.push([{ text: "🔙 رجوع", callback_data: canUse ? "schedule_templates_current" : "schedule_mizaj" }]);
    await bot2.sendMessage(chatId, canUse
      ? "اختر قالباً لاستخدامه الآن. سيُنشأ الموعد بالرسالة المحفوظة."
      : "قوالبك المحفوظة. افتح قالباً لمعاينته أو حذفه.",
    { reply_markup: { inline_keyboard: rows } });
    return true;
  }
  if (data.startsWith("schedule_template_view_")) {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    const templateId = data.slice("schedule_template_view_".length);
    const template = (user.scheduleTemplates || []).find((entry) => entry.id === templateId);
    if (!template) {
      await bot2.sendMessage(chatId, "القالب غير موجود.");
      return true;
    }
    await bot2.sendMessage(chatId, `📄 ${template.name}\n\n${template.message}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗑️ حذف القالب", callback_data: `schedule_template_delete_${template.id}` }],
          [{ text: "🔙 رجوع", callback_data: "schedule_templates_current" }]
        ]
      }
    });
    return true;
  }
  if (data.startsWith("schedule_template_delete_")) {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    const templateId = data.slice("schedule_template_delete_".length);
    const templates = Array.isArray(user.scheduleTemplates) ? user.scheduleTemplates : [];
    const updated = templates.filter((entry) => entry.id !== templateId);
    if (updated.length === templates.length) {
      await bot2.sendMessage(chatId, "القالب غير موجود.");
      return true;
    }
    saveUser(userId, { scheduleTemplates: updated });
    await bot2.sendMessage(chatId, "✅ تم حذف القالب.", { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }
  if (data.startsWith("schedule_template_use_")) {
    if (user.tier !== "mizaj") {
      await bot2.sendMessage(chatId, "🔒 القوالب متاحة لفئة ميزاج فقط.");
      return true;
    }
    const currentState = getState?.(userId);
    if (!["awaiting_schedule_message", "awaiting_recurring_message"].includes(currentState?.state)) {
      await bot2.sendMessage(chatId, "ابدأ إعداد موعد جديد ثم اختر القالب عند خطوة كتابة الرسالة.");
      return true;
    }
    const templateId = data.slice("schedule_template_use_".length);
    const template = (user.scheduleTemplates || []).find((entry) => entry.id === templateId);
    if (!template) {
      await bot2.sendMessage(chatId, "القالب غير موجود. افتح القائمة وحاول مرة أخرى.");
      return true;
    }
    const item = _createScheduleItem(userId, currentState, template.message);
    clearState?.(userId);
    const date = formatScheduleTime(item.sendAt, item.timeZone);
    await bot2.sendMessage(chatId, `✅ تمت الجدولة من القالب «${template.name}».\n📅 ${date}\n📱 ${_itemRecipients(item).length} مستلم/مستلمين.`, { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }

  if (/^schedule_(pause|resume|retry)_/.test(data)) {
    const [, action, id] = data.match(/^schedule_(pause|resume|retry)_(.+)$/) || [];
    const item = scheduled.find((entry) => entry.id === id);
    if (!item || !action) {
      await bot2.sendMessage(chatId, "لم يتم العثور على هذا الموعد.");
      return true;
    }
    if (action === "pause" && item.status === "pending") item.status = "paused";
    else if (action === "resume" && item.status === "paused") item.status = "pending";
    else if (action === "retry" && item.status === "failed") {
      item.status = "pending";
      item.sendAt = Date.now();
      item.error = null;
      item._retries = 0;
    } else {
      await bot2.sendMessage(chatId, "هذا الإجراء غير متاح للحالة الحالية.");
      return true;
    }
    saveUser(userId, { scheduledMessages: scheduled });
    const labels = { pause: "⏸️ تم إيقاف الموعد مؤقتاً.", resume: "▶️ تم استئناف الموعد.", retry: "🔄 أُعيدت المحاولة الآن. إذا وصل الإرسال قبل انقطاع الاتصال فقد تصل نسخة مكررة." };
    await bot2.sendMessage(chatId, labels[action], { reply_markup: _scheduleMenuKeyboard(user) });
    return true;
  }

  if (data === "menu_schedule") {
    const active = scheduled.filter((m) => m.status === "pending").length;
    const sent = scheduled.filter((m) => m.status === "sent").length;
    await bot2.sendMessage(
      chatId,
      `📅 الرسائل المجدولة\n\n⏳ في الانتظار: ${active}\n✅ تم إرسالها: ${sent}\n📋 الإجمالي: ${scheduled.length}\n🕒 الوقت الآن: ${formatScheduleTime(Date.now(), timeZone)}\n🌍 ${timeZone}`,
      { reply_markup: _scheduleMenuKeyboard(user) }
    );
    return true;
  }
  if (data === "schedule_add") {
    const sock = _findSock(inMemoryDB, userId);
    if (!sock) {
      await bot2.sendMessage(chatId, "\u274C \u064A\u062C\u0628 \u0631\u0628\u0637 \u0648\u0627\u062A\u0633\u0627\u0628 \u0623\u0648\u0644\u0627\u064B \u0644\u062C\u062F\u0648\u0644\u0629 \u0631\u0633\u0627\u0626\u0644");
      return true;
    }
    setState(userId, "awaiting_schedule_target", { timeZone });
    await bot2.sendMessage(
      chatId,
      `📅 *جدولة رسالة جديدة*\n\n*الخطوة 1/3:* أدخل الرقم مع رمز الدولة أو معرّف مجموعة واتساب (1203…).${user.tier === "mizaj" ? "\n💎 ميزاج: يمكنك إدخال حتى 10 مستلمين مفصولين بفاصلة أو مسافة." : ""}\nمثال: \`249960506662\``,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
    return true;
  }
  if (data === "schedule_list") {
    if (scheduled.length === 0) {
      await bot2.sendMessage(chatId, "📋 لا توجد مواعيد محفوظة بعد.", { reply_markup: _scheduleMenuKeyboard(user) });
      return true;
    }
    const entries = scheduled.slice(-10).reverse();
    const lines = entries.map((m, i) => {
      const timestamp = typeof m.sendAt === "number" ? m.sendAt : new Date(m.sendAt).getTime();
      const date = Number.isFinite(timestamp) ? formatScheduleTime(timestamp, m.timeZone || timeZone) : "موعد غير صالح";
      const status = m.status === "sent" ? "✅ أُرسل" : m.status === "failed" ? "❌ فشل" : m.status === "paused" ? "⏸️ متوقف" : "⏳ قيد الانتظار";
      const recipients = _itemRecipients(m);
      const target = recipients.length > 1 ? `${recipients.length} مستلمين` : `+${(m.jid || "").split("@")[0]}`;
      return `${status} ${i + 1}. ${target}\n📅 ${date}${m.error ? `\n⚠️ ${String(m.error).slice(0, 90)}` : ""}\n💬 ${(m.message || "").slice(0, 45)}`;
    }).join("\n\n");
    const pendingCount = scheduled.filter((m) => m.status === "pending").length;
    const taskRows = entries.flatMap((m) => {
      if (m.status === "pending") return [[{ text: `⏸️ إيقاف ${String(m.jid || "").split("@")[0].slice(0, 12)}`, callback_data: `schedule_pause_${m.id}` }]];
      if (m.status === "paused") return [[{ text: `▶️ استئناف ${String(m.jid || "").split("@")[0].slice(0, 12)}`, callback_data: `schedule_resume_${m.id}` }]];
      if (m.status === "failed") return [[{ text: `🔄 إعادة ${String(m.jid || "").split("@")[0].slice(0, 12)}`, callback_data: `schedule_retry_${m.id}` }]];
      return [];
    });
    taskRows.push([{ text: "🔙 رجوع", callback_data: "menu_schedule" }]);
    await bot2.sendMessage(
      chatId,
      `📋 الرسائل المجدولة\n⏳ قيد الانتظار: ${pendingCount} | الإجمالي: ${scheduled.length}\n🌍 المنطقة: ${timeZone}\n\n${lines}`,
      { reply_markup: { inline_keyboard: taskRows } }
    );
    return true;
  }
  if (data === "schedule_delete") {
    const pending = scheduled.filter((m) => m.status === "pending" || m.status === "paused");
    if (pending.length === 0) {
      await bot2.sendMessage(chatId, "\u274C \u0644\u0627 \u062A\u0648\u062C\u062F \u0631\u0633\u0627\u0626\u0644 \u0641\u064A \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631");
      return true;
    }
    const rows = pending.slice(0, 8).map((m, i) => {
      const ts3 = typeof m.sendAt === 'number' ? m.sendAt : new Date(m.sendAt).getTime();
      const date = Number.isFinite(ts3) ? formatScheduleTime(ts3, m.timeZone || timeZone) : "—";
      return [{ text: `\uD83D\uDDD1\uFE0F +${(m.jid || "").split("@")[0]} \u2190 ${date}`, callback_data: `schedule_del_${m.id}` }];
    });
    rows.push([{ text: "\u{1F5D1}\uFE0F \u062D\u0630\u0641 \u0627\u0644\u0643\u0644", callback_data: "schedule_del_all" }]);
    rows.push([{ text: "\u{1F519} \u0631\u062C\u0648\u0639", callback_data: "menu_schedule" }]);
    await bot2.sendMessage(chatId, "\u{1F5D1}\uFE0F *\u0627\u062E\u062A\u0631 \u0631\u0633\u0627\u0644\u0629 \u0644\u062D\u0630\u0641\u0647\u0627:*", { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } });
    return true;
  }
  if (data.startsWith("schedule_del_")) {
    if (data === "schedule_del_all") {
      saveUser(userId, { scheduledMessages: scheduled.filter((m) => !["pending", "paused"].includes(m.status)) });
      await bot2.sendMessage(chatId, "\u2705 \u062A\u0645 \u062D\u0630\u0641 \u062C\u0645\u064A\u0639 \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0641\u064A \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631");
    } else {
      const id = data.replace("schedule_del_", "");
      saveUser(userId, { scheduledMessages: scheduled.filter((m) => m.id !== id) });
      await bot2.sendMessage(chatId, "\u2705 \u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0631\u0633\u0627\u0644\u0629");
    }
    return true;
  }
  if (data === "schedule_stats") {
    const sent = scheduled.filter((m) => m.status === "sent").length;
    const pending = scheduled.filter((m) => m.status === "pending").length;
    const failed = scheduled.filter((m) => m.status === "failed").length;
    await bot2.sendMessage(
      chatId,
      `\u{1F4CA} *\u0625\u062D\u0635\u0627\u0626\u064A\u0627\u062A \u0627\u0644\u062C\u062F\u0648\u0644\u0629*\n\n\u2705 \u0645\u064F\u0631\u0633\u064E\u0644\u0629: ${sent}\n\u23F3 \u0641\u064A \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631: ${pending}\n\u274C \u0641\u0634\u0644\u062A: ${failed}\n\u{1F4CB} \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A: ${scheduled.length}`,
      { parse_mode: "Markdown", reply_markup: _scheduleMenuKeyboard(user) }
    );
    return true;
  }
  if (data === "schedule_recurring") {
    setState(userId, "awaiting_recurring_recipient");
    await bot2.sendMessage(
      chatId,
      `🔁 *رسائل متكررة*\n\nيمكنك الإرسال يومياً أو أسبوعياً أو شهرياً.\n\n*الخطوة 1/4:* أدخل رقم المستلم مع رمز الدولة.${user.tier === "mizaj" ? "\n💎 ميزاج: حتى 10 مستلمين مفصولين بفاصلة أو مسافة." : ""}`,
      { parse_mode: "Markdown", reply_markup: cancelKeyboard() }
    );
    return true;
  }
  return false;
}
