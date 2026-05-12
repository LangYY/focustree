/**
 * 浏览器本地时间 → 给 agent 用的标准化结构
 */
export function getClientTime(now = new Date()) {
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const hour = now.getHours()
  let period
  if (hour < 6)        period = '深夜'
  else if (hour < 9)   period = '清晨'
  else if (hour < 12)  period = '上午'
  else if (hour < 14)  period = '中午'
  else if (hour < 18)  period = '下午'
  else if (hour < 21)  period = '傍晚'
  else                 period = '晚上'

  return {
    iso: now.toISOString(),
    weekday: weekdayNames[now.getDay()],
    hour,
    period,
    dateKey: localDateKey(now),
  }
}

/**
 * YYYY-MM-DD 按浏览器本地时区（不要直接 toISOString().slice(0,10)，那是 UTC）
 */
export function localDateKey(d = new Date()) {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${dy}`
}
