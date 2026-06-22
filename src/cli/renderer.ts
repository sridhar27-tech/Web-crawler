/**
 * Terminal rendering utilities — colours, symbols, layout helpers.
 * Keeps all ANSI logic in one place so the wizard stays readable.
 */

export const c = {
  reset:     "\x1b[0m",
  bold:      "\x1b[1m",
  dim:       "\x1b[2m",
  italic:    "\x1b[3m",

  // foreground
  white:     "\x1b[97m",
  gray:      "\x1b[90m",
  cyan:      "\x1b[96m",
  green:     "\x1b[92m",
  yellow:    "\x1b[93m",
  red:       "\x1b[91m",
  blue:      "\x1b[94m",
  magenta:   "\x1b[95m",
  orange:    "\x1b[38;5;208m",
};

export const sym = {
  dot:       "·",
  bullet:    "•",
  arrow:     "›",
  check:     "✓",
  cross:     "✗",
  warn:      "⚠",
  info:      "ℹ",
  sparkle:   "◆",
  bar:       "│",
  corner:    "╰",
  tee:       "├",
  horiz:     "─",
};

/** Wraps text in an ANSI style sequence. */
export function style(text: string, ...styles: string[]): string {
  return styles.join("") + text + c.reset;
}

/** Prints a blank line. */
export function blank(): void { console.log(); }

/** dim separator line */
export function divider(width = 52): void {
  console.log(style(sym.horiz.repeat(width), c.dim, c.gray));
}

/** A styled section label, e.g.  ◆ Seeds */
export function section(label: string): void {
  console.log(style(`${sym.sparkle} ${label}`, c.bold, c.cyan));
}

/** A key/value summary row, e.g.   › depth    3 */
export function row(key: string, value: string, valueColor = c.white): void {
  const pad = 16;
  const k = style(key.padEnd(pad), c.gray);
  const v = style(value, valueColor);
  console.log(`  ${style(sym.arrow, c.dim, c.gray)} ${k}${v}`);
}

/** Success line */
export function ok(msg: string): void {
  console.log(`  ${style(sym.check, c.green)} ${style(msg, c.white)}`);
}

/** Warning line */
export function warn(msg: string): void {
  console.log(`  ${style(sym.warn, c.yellow)} ${style(msg, c.yellow)}`);
}

/** Error line */
export function err(msg: string): void {
  console.log(`  ${style(sym.cross, c.red)} ${style(msg, c.red)}`);
}

/** Info line */
export function info(msg: string): void {
  console.log(`  ${style(sym.info, c.blue)} ${style(msg, c.gray)}`);
}
