const DEPRECATED_PLANNING_PATTERNS = [
  /每(?:个|项|条)[^。！？\n]{0,30}(?:保留|留|放)[^。！？\n]{0,30}(?:一个|1\s*个)[^。！？\n]{0,20}(?:关键)?(?:下一步|任务|动作|启动动作)/,
  /每(?:个|项|条)[^。！？\n]{0,30}(?:一个|1\s*个)[^。！？\n]{0,20}(?:关键)?(?:下一步|启动动作)/,
  /(?:更多|后续|其余|剩余)?[^。！？\n]{0,20}细节[^。！？\n]{0,30}(?:打开项目|逐步展开|再逐步展开|以后再展开|后续再细化)/,
]

export function containsDeprecatedPlanningPolicy(text) {
  const value = String(text || '')
  return DEPRECATED_PLANNING_PATTERNS.some(re => re.test(value))
}

export function redactDeprecatedPlanningPolicy(text) {
  return DEPRECATED_PLANNING_PATTERNS.reduce((value, re) => {
    const globalRe = new RegExp(re.source, 'g')
    return value.replace(globalRe, '旧版项目压缩口径')
  }, String(text || ''))
}

export function containsDeprecatedPlanningPolicyDeep(value) {
  return containsDeprecatedPlanningPolicy(collectTextValues(value).join('\n'))
}

function collectTextValues(value, result = []) {
  if (typeof value === 'string') {
    result.push(value)
    return result
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectTextValues(item, result))
    return result
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectTextValues(item, result))
  }
  return result
}
