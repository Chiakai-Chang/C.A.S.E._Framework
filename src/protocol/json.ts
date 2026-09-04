export type JsonValue = null | boolean | string | JsonValue[] | { [key: string]: JsonValue };

function caseParse(reason: string): Error {
  return new Error(`CASE_E_PARSE: ${reason}`);
}

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isNoncharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xffff) === 0xfffe || (codePoint & 0xffff) === 0xffff;
}

class StrictParser {
  private position = 0;

  constructor(private readonly text: string) {}

  parseValue(): JsonValue {
    this.skipWhitespace();
    const character = this.peek();

    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || (character !== undefined && character >= "0" && character <= "9")) {
      throw caseParse("numbers are forbidden");
    }
    throw caseParse("expected a JSON value");
  }

  requireEnd(): void {
    this.skipWhitespace();
    if (this.position !== this.text.length) throw caseParse("trailing data");
  }

  private parseObject(): { [key: string]: JsonValue } {
    this.consume("{");
    this.skipWhitespace();
    const result: { [key: string]: JsonValue } = {};
    const names = new Set<string>();
    if (this.peek() === "}") {
      this.position += 1;
      return result;
    }

    while (true) {
      this.skipWhitespace();
      if (this.peek() !== '"') throw caseParse("expected an object member name");
      const name = this.parseString();
      if (names.has(name)) throw caseParse("duplicate object member name");
      names.add(name);
      this.skipWhitespace();
      this.consume(":");
      const value = this.parseValue();
      Object.defineProperty(result, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.position += 1;
        return result;
      }
      this.consume(",");
    }
  }

  private parseArray(): JsonValue[] {
    this.consume("[");
    this.skipWhitespace();
    const result: JsonValue[] = [];
    if (this.peek() === "]") {
      this.position += 1;
      return result;
    }

    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === "]") {
        this.position += 1;
        return result;
      }
      this.consume(",");
    }
  }

  private parseString(): string {
    this.consume('"');
    let result = "";

    while (this.position < this.text.length) {
      const character = this.text[this.position]!;
      if (character === '"') {
        this.position += 1;
        return result;
      }
      if (character === "\\") {
        result += this.parseEscape();
        continue;
      }

      const codeUnit = character.charCodeAt(0);
      if (codeUnit <= 0x1f) throw caseParse("unescaped control character");
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const low = this.text.charCodeAt(this.position + 1);
        if (low < 0xdc00 || low > 0xdfff) throw caseParse("isolated surrogate");
        const codePoint = 0x10000 + ((codeUnit - 0xd800) << 10) + (low - 0xdc00);
        this.rejectNoncharacter(codePoint);
        result += character + this.text[this.position + 1]!;
        this.position += 2;
        continue;
      }
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) throw caseParse("isolated surrogate");
      this.rejectNoncharacter(codeUnit);
      result += character;
      this.position += 1;
    }

    throw caseParse("unterminated string");
  }

  private parseEscape(): string {
    this.position += 1;
    const escaped = this.peek();
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped !== undefined && Object.hasOwn(simpleEscapes, escaped)) {
      this.position += 1;
      return simpleEscapes[escaped]!;
    }
    if (escaped !== "u") throw caseParse("invalid string escape");

    this.position += 1;
    const highOrScalar = this.parseHexCodeUnit();
    if (highOrScalar >= 0xd800 && highOrScalar <= 0xdbff) {
      if (this.text.slice(this.position, this.position + 2) !== "\\u") throw caseParse("isolated surrogate");
      this.position += 2;
      const low = this.parseHexCodeUnit();
      if (low < 0xdc00 || low > 0xdfff) throw caseParse("isolated surrogate");
      const codePoint = 0x10000 + ((highOrScalar - 0xd800) << 10) + (low - 0xdc00);
      this.rejectNoncharacter(codePoint);
      return String.fromCodePoint(codePoint);
    }
    if (highOrScalar >= 0xdc00 && highOrScalar <= 0xdfff) throw caseParse("isolated surrogate");
    this.rejectNoncharacter(highOrScalar);
    return String.fromCharCode(highOrScalar);
  }

  private parseHexCodeUnit(): number {
    const hex = this.text.slice(this.position, this.position + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw caseParse("invalid Unicode escape");
    this.position += 4;
    return Number.parseInt(hex, 16);
  }

  private rejectNoncharacter(codePoint: number): void {
    if (isNoncharacter(codePoint)) throw caseParse("Unicode noncharacter");
  }

  private parseLiteral<T extends null | boolean>(source: string, value: T): T {
    if (this.text.slice(this.position, this.position + source.length) !== source) {
      throw caseParse("invalid literal");
    }
    this.position += source.length;
    return value;
  }

  private skipWhitespace(): void {
    while (isWhitespace(this.peek())) this.position += 1;
  }

  private consume(expected: string): void {
    if (this.peek() !== expected) throw caseParse(`expected ${expected}`);
    this.position += 1;
  }

  private peek(): string | undefined {
    return this.text[this.position];
  }
}

export function parseGovernedJson(bytes: Uint8Array): JsonValue {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw caseParse("BOM");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw caseParse("invalid UTF-8");
  }

  const parser = new StrictParser(text);
  const value = parser.parseValue();
  parser.requireEnd();
  return value;
}
