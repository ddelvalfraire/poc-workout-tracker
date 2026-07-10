/**
 * Path math for the inline-SVG sparkline (no charting dependency): maps a
 * chronological series onto a width×height box as an SVG `points` string,
 * "x1,y1 x2,y2 …". Pure and rendering-agnostic so the geometry is testable
 * without a DOM.
 *
 * Normalization: x spreads evenly across the full width; y maps the value
 * range [min, max] onto [height, 0] (SVG y grows downward, so the max value
 * sits at the top). A FLAT series has zero range — the divide-by-zero guard
 * draws it as a midline instead of NaN soup. Fewer than 2 points returns ''
 * (a one-point "trend" is not a line; the caller hides the sparkline).
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const step = width / (values.length - 1)
  return values
    .map((value, i) => {
      const x = i * step
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height
      // 2dp keeps the attribute compact without visible quantization at 64px.
      return `${round2(x)},${round2(y)}`
    })
    .join(' ')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
