// Every command returns plain data. Humans get a rendering, agents get --json.

export class GluelyError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export const fail = (code, message, hint) => {
  throw new GluelyError(code, message, hint);
};

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const color = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

export const mark = {
  ok: () => color.green('✔'),
  bad: () => color.red('✘'),
  warn: () => color.yellow('!'),
  next: () => color.cyan('→'),
};

export function printIssues(issues, indent = '  ') {
  for (const issue of issues) {
    const icon = issue.level === 'error' ? mark.bad() : mark.warn();
    console.log(`${indent}${icon} ${issue.file ? `${issue.file}: ` : ''}${issue.message}`);
  }
}
