"use strict";

function validateSchedule({ enabled, start, end, timeZone }) {
  if (typeof enabled !== "boolean") throw new Error("schedule_enabled must be true or false");
  for (const time of [start, end]) {
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Schedule times must use HH:MM (24-hour clock)");
  }
  if (start === end) throw new Error("Schedule start and end must differ; disable scheduling for all-day processing");
  try { new Intl.DateTimeFormat("en-GB", { timeZone }).format(); }
  catch { throw new Error("Invalid schedule_timezone; use an IANA name such as Europe/London"); }
  return { enabled, start, end, timeZone };
}

function scheduleStatus(schedule, now = new Date()) {
  if (!schedule) return { enabled: false, allowed: true, nextOpeningAt: null };
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: schedule.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const minutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const start = minutes(schedule.start), end = minutes(schedule.end);
  const allowedAt = date => {
    const parts = format.formatToParts(date);
    const current = Number(parts.find(p => p.type === "hour").value) * 60 + Number(parts.find(p => p.type === "minute").value);
    return start < end ? current >= start && current < end : current >= start || current < end;
  };
  const allowed = !schedule.enabled || allowedAt(now);
  let nextOpeningAt = null;
  if (!allowed) {
    // Scan real instants rather than doing local date arithmetic: this handles
    // skipped/repeated wall-clock times at daylight-saving transitions.
    const nextMinute = Math.floor(now.getTime() / 60000) * 60000 + 60000;
    for (let offset = 0; offset < 48 * 60; offset++) {
      const date = new Date(nextMinute + offset * 60000);
      if (allowedAt(date)) { nextOpeningAt = date.toISOString(); break; }
    }
  }
  return { ...schedule, allowed, nextOpeningAt, runningJobPolicy: "finish" };
}

module.exports = { validateSchedule, scheduleStatus };
