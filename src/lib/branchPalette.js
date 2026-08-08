import * as d3 from 'd3'

export const DEFAULT_PROJECT_COLOR = '#4A8C5C'

export const BRANCH_PALETTE = {
  dark: ['#6E9E5A', '#C97B54', '#5D82B8', '#C2A24C', '#8F7FB0', '#B85C57', '#4E9E96', '#7E93A6', '#B77E8E'],
  light: ['#4E7A3E', '#A0562F', '#3D5F91', '#8E7223', '#6A5A8C', '#8F3B36', '#2F7972', '#556B7E', '#8C5566'],
}

export function isDefaultProjectColor(color) {
  return String(color || '').trim().toLowerCase() === DEFAULT_PROJECT_COLOR.toLowerCase()
}

export function resolveBranchBaseColor(hNode, index, theme = 'dark') {
  const stored = String(hNode?.data?.color || '').trim()
  if (stored && !isDefaultProjectColor(stored)) return stored
  const palette = BRANCH_PALETTE[theme === 'light' ? 'light' : 'dark']
  return palette[index % palette.length]
}

export function shadeBranchColor(baseColor, depth = 0, status = 'active', theme = 'dark') {
  const fallback = d3.hsl(BRANCH_PALETTE[theme === 'light' ? 'light' : 'dark'][0])
  const color = d3.hsl(baseColor || fallback.formatHex())
  const hue = Number.isFinite(color.h) ? color.h : fallback.h
  const sourceSaturation = Number.isFinite(color.s) ? color.s : fallback.s
  const sourceLightness = Number.isFinite(color.l) ? color.l : fallback.l
  const depthStep = Math.min(Number(depth) || 0, 5)
  const saturation = clamp(sourceSaturation * (0.96 - depthStep * 0.03), 0.34, 0.86)
  let lightness = theme === 'light'
    ? clamp(sourceLightness - depthStep * 0.04, 0.26, 0.58)
    : clamp(sourceLightness + depthStep * 0.048, 0.40, 0.74)
  let nextSaturation = saturation
  if (status === 'done') {
    nextSaturation *= 0.38
    lightness = clamp(lightness * 0.92, 0.30, 0.68)
  }
  if (status === 'dormant') {
    nextSaturation *= 0.26
    lightness = clamp(lightness * 0.84, 0.26, 0.60)
  }
  return d3.hsl(hue, nextSaturation, lightness).formatHex()
}

export function branchColorAt(index, theme = 'dark') {
  return (BRANCH_PALETTE[theme === 'light' ? 'light' : 'dark'][index] || BRANCH_PALETTE.dark[0])
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
