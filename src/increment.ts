const SEPARATOR = "_";

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

function saturate(v: bigint): bigint {
  if (v > I128_MAX) return I128_MAX;
  if (v < I128_MIN) return I128_MIN;
  return v;
}

function parseRadix(s: string, radix: number): bigint | null {
  if (s === "") return null;
  let neg = false;
  let body = s;
  if (radix === 10 && (s.startsWith("-") || s.startsWith("+"))) {
    neg = s.startsWith("-");
    body = s.slice(1);
  }
  if (body === "") return null;
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, radix);
  let v = 0n;
  for (const c of body.toLowerCase()) {
    const d = digits.indexOf(c);
    if (d < 0) return null;
    v = v * BigInt(radix) + BigInt(d);
  }
  return neg ? -v : v;
}

function pad(s: string, width: number): string {
  if (s.startsWith("-")) return "-" + s.slice(1).padStart(Math.max(0, width - 1), "0");
  return s.padStart(width, "0");
}

export function incrementInteger(selected: string, amount: number): string | null {
  if (selected === "" || selected.endsWith(SEPARATOR) || selected.startsWith(SEPARATOR)) return null;
  const radix = selected.startsWith("0x") ? 16 : selected.startsWith("0o") ? 8 : selected.startsWith("0b") ? 2 : 10;
  const chars = [...selected];
  const sepRtl: number[] = [];
  chars
    .slice()
    .reverse()
    .forEach((c, i) => {
      if (c === SEPARATOR) sepRtl.push(i);
    });
  const word = chars.filter((c) => c !== SEPARATOR).join("");
  let newText: string;
  if (radix === 10) {
    const value = parseRadix(word, 10);
    if (value === null) return null;
    const newValue = saturate(value + BigInt(amount));
    let formatLength = word.length;
    if (value < 0n && newValue >= 0n) formatLength = word.length - 1;
    else if (value >= 0n && newValue < 0n) formatLength = word.length + 1;
    formatLength -= sepRtl.length;
    newText = word.startsWith("0") || word.startsWith("-0") ? pad(newValue.toString(), formatLength) : newValue.toString();
  } else {
    const number = word.slice(2);
    if (number.startsWith("+") || number.startsWith("-")) return null;
    const value = parseRadix(number, radix);
    if (value === null || value >= 1n << 128n) return null;
    let newValue = saturate(BigInt.asIntN(128, value) + BigInt(amount));
    if (newValue < 0n) newValue = 0n;
    const formatLength = selected.length - 2 - sepRtl.length;
    if (radix === 2) newText = "0b" + newValue.toString(2).padStart(formatLength, "0");
    else if (radix === 8) newText = "0o" + newValue.toString(8).padStart(formatLength, "0");
    else {
      let lower = 0;
      let upper = 0;
      for (const c of number) {
        if (/[a-z]/.test(c)) lower++;
        else if (/[A-Z]/.test(c)) upper++;
      }
      const hex = newValue.toString(16).padStart(formatLength, "0");
      newText = "0x" + (upper > lower ? hex.toUpperCase() : hex);
    }
  }
  for (const rtl of sepRtl) {
    if (rtl < newText.length) {
      const idx = Math.max(0, newText.length - rtl);
      if (idx > 0) newText = newText.slice(0, idx) + SEPARATOR + newText.slice(idx);
    }
  }
  if (newText.length > selected.length && sepRtl.length > 0) {
    const spacing = sepRtl.length >= 2 ? sepRtl[sepRtl.length - 1]! - sepRtl[sepRtl.length - 2]! - 1 : sepRtl[0]!;
    const prefixLength = radix === 10 ? 0 : 2;
    let index = newText.indexOf(SEPARATOR);
    if (index >= 0) {
      while (index - prefixLength > spacing) {
        index -= spacing;
        newText = newText.slice(0, index) + SEPARATOR + newText.slice(index);
      }
    }
  }
  return newText;
}

type Unit = "years" | "months" | "days" | "hours" | "minutes" | "seconds" | "ampm";

interface Field {
  spec: string;
  regex: string;
  unit: Unit;
}

const FIELDS: Record<string, Omit<Field, "spec">> = {
  Y: { regex: "\\d{4}", unit: "years" },
  y: { regex: "\\d\\d", unit: "years" },
  m: { regex: "[0-1]\\d", unit: "months" },
  d: { regex: "[0-3]\\d", unit: "days" },
  "-d": { regex: "[1-3]?\\d", unit: "days" },
  a: { regex: "Sun|Mon|Tue|Wed|Thu|Fri|Sat", unit: "days" },
  A: { regex: "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday", unit: "days" },
  b: { regex: "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec", unit: "months" },
  B: {
    regex: "January|February|March|April|May|June|July|August|September|October|November|December",
    unit: "months",
  },
  H: { regex: "[0-2]\\d", unit: "hours" },
  M: { regex: "[0-5]\\d", unit: "minutes" },
  S: { regex: "[0-5]\\d", unit: "seconds" },
  I: { regex: "[0-1]\\d", unit: "hours" },
  "-I": { regex: "1?\\d", unit: "hours" },
  P: { regex: "am|pm", unit: "ampm" },
  p: { regex: "AM|PM", unit: "ampm" },
};

interface Format {
  fmt: string;
  parts: (string | Field)[];
  regex: RegExp;
  fields: Field[];
}

function makeFormat(fmt: string): Format {
  const parts: (string | Field)[] = [];
  const fields: Field[] = [];
  let re = "^";
  let i = 0;
  while (i < fmt.length) {
    const p = fmt.indexOf("%", i);
    if (p < 0) {
      parts.push(fmt.slice(i));
      re += escape(fmt.slice(i));
      break;
    }
    if (p > i) {
      parts.push(fmt.slice(i, p));
      re += escape(fmt.slice(i, p));
    }
    const spec = fmt[p + 1] === "-" ? fmt.slice(p + 1, p + 3) : fmt[p + 1]!;
    const field = { spec, ...FIELDS[spec]! };
    parts.push(field);
    fields.push(field);
    re += `(${field.regex})`;
    i = p + 1 + spec.length;
  }
  return { fmt, parts, regex: new RegExp(re + "$"), fields };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const FORMATS = [
  "%Y-%m-%d %H:%M:%S",
  "%Y/%m/%d %H:%M:%S",
  "%Y-%m-%d %H:%M",
  "%Y/%m/%d %H:%M",
  "%Y-%m-%d",
  "%Y/%m/%d",
  "%a %b %d %Y",
  "%d-%b-%Y",
  "%Y %b %d",
  "%b %d, %Y",
  "%-I:%M:%S %P",
  "%-I:%M %P",
  "%-I:%M:%S %p",
  "%-I:%M %p",
  "%H:%M:%S",
  "%H:%M",
].map(makeFormat);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Parsed {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number | null;
  hour12: number | null;
  pm: boolean | null;
}

function parse(format: Format, m: RegExpExecArray): Parsed | null {
  const p: Parsed = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, weekday: null, hour12: null, pm: null };
  format.fields.forEach((f, idx) => {
    const v = m[idx + 1]!;
    switch (f.spec) {
      case "Y":
        p.year = Number(v);
        break;
      case "y":
        p.year = 2000 + Number(v) - (Number(v) >= 70 ? 100 : 0);
        break;
      case "m":
        p.month = Number(v);
        break;
      case "d":
      case "-d":
        p.day = Number(v);
        break;
      case "a":
        p.weekday = DAYS.indexOf(v);
        break;
      case "A":
        p.weekday = DAYS_LONG.indexOf(v);
        break;
      case "b":
        p.month = MONTHS.indexOf(v) + 1;
        break;
      case "B":
        p.month = MONTHS_LONG.indexOf(v) + 1;
        break;
      case "H":
        p.hour = Number(v);
        break;
      case "M":
        p.minute = Number(v);
        break;
      case "S":
        p.second = Number(v);
        break;
      case "I":
      case "-I":
        p.hour12 = Number(v);
        break;
      case "P":
      case "p":
        p.pm = v.toLowerCase() === "pm";
        break;
    }
  });
  if (p.hour12 !== null) {
    if (p.hour12 < 1 || p.hour12 > 12) return null;
    p.hour = (p.hour12 % 12) + (p.pm ? 12 : 0);
  }
  if (p.month < 1 || p.month > 12 || p.hour > 23 || p.minute > 59 || p.second > 59) return null;
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  date.setUTCFullYear(p.year);
  if (date.getUTCMonth() !== p.month - 1 || date.getUTCDate() !== p.day) return null;
  if (p.weekday !== null && date.getUTCDay() !== p.weekday) return null;
  return p;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function format(fmt: Format, d: Date): string {
  let out = "";
  for (const part of fmt.parts) {
    if (typeof part === "string") {
      out += part;
      continue;
    }
    const h = d.getUTCHours();
    switch (part.spec) {
      case "Y":
        out += String(d.getUTCFullYear()).padStart(4, "0");
        break;
      case "y":
        out += two(d.getUTCFullYear() % 100);
        break;
      case "m":
        out += two(d.getUTCMonth() + 1);
        break;
      case "d":
        out += two(d.getUTCDate());
        break;
      case "-d":
        out += String(d.getUTCDate());
        break;
      case "a":
        out += DAYS[d.getUTCDay()];
        break;
      case "A":
        out += DAYS_LONG[d.getUTCDay()];
        break;
      case "b":
        out += MONTHS[d.getUTCMonth()];
        break;
      case "B":
        out += MONTHS_LONG[d.getUTCMonth()];
        break;
      case "H":
        out += two(h);
        break;
      case "M":
        out += two(d.getUTCMinutes());
        break;
      case "S":
        out += two(d.getUTCSeconds());
        break;
      case "I":
        out += two(h % 12 === 0 ? 12 : h % 12);
        break;
      case "-I":
        out += String(h % 12 === 0 ? 12 : h % 12);
        break;
      case "P":
        out += h >= 12 ? "pm" : "am";
        break;
      case "p":
        out += h >= 12 ? "PM" : "AM";
        break;
    }
  }
  return out;
}

export function incrementDateTime(selected: string, amount: number): string | null {
  if (selected === "") return null;
  for (const fmt of FORMATS) {
    const m = fmt.regex.exec(selected);
    if (!m) continue;
    const hasDate = fmt.fields.some((f) => ["years", "months", "days"].includes(f.unit));
    const hasTime = fmt.fields.some((f) => ["hours", "minutes", "seconds"].includes(f.unit));
    const p = parse(fmt, m);
    if (!p) continue;
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
    base.setUTCFullYear(p.year);
    if (hasDate && hasTime) return format(fmt, new Date(base.getTime() + amount * 60000));
    if (hasDate) return format(fmt, new Date(base.getTime() + amount * 86400000));
    if (hasTime) {
      const dayMs = 86400000;
      const t = (((p.hour * 3600 + p.minute * 60 + p.second) * 1000 + amount * 60000) % dayMs + dayMs) % dayMs;
      return format(fmt, new Date(t));
    }
    return null;
  }
  return null;
}
