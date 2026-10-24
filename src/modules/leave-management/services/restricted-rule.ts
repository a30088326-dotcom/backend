/** A deliberately small rule language. This parses data into an AST; it never evaluates JS.
 * No globals, property traversal, functions, constructors, imports, loops or dynamic calls.
 */
type Value = string | number | boolean | null;
type Expression = { kind: 'literal'; value: Value } | { kind: 'name'; name: string } |
  { kind: 'unary'; op: string; value: Expression } | { kind: 'binary'; op: string; left: Expression; right: Expression } |
  { kind: 'conditional'; condition: Expression; yes: Expression; no: Expression } | { kind: 'call'; name: string; args: Expression[] };
type Statement = { kind: 'block'; body: Statement[] } | { kind: 'if'; condition: Expression; yes: Statement; no?: Statement } |
  { kind: 'assign'; name: string; value: Expression; declaration?: boolean } | { kind: 'log'; args: Expression[] };
const CONTEXT = new Set(['EmployeeNo', 'IsMale', 'IsFemale', 'JoinedYear', 'JoinedMonth', 'CurrentYear', 'ServiceMonths', 'LeaveType']);
const OUTPUTS = new Set(['output.entitlement', 'output.carryForwardAmount']);
const MATH = new Map<string, (...values: number[]) => number>([['Math.min', Math.min], ['Math.max', Math.max], ['Math.floor', Math.floor], ['Math.ceil', Math.ceil], ['Math.round', Math.round], ['Math.abs', Math.abs]]);
const RESERVED = new Set(['constructor', '__proto__', 'prototype', 'process', 'globalThis', 'global', 'require', 'module', 'exports', 'Function', 'eval', 'this']);
const PRECEDENCE: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export class LeaveRuleScriptError extends Error {
  constructor(message: string) { super(`Unsupported leave rule: ${message}`); this.name = 'LeaveRuleScriptError'; }
}

type Token = { text: string; value?: Value; literal?: boolean };
function tokenize(source: string) {
  if (source.length > 20000) throw new LeaveRuleScriptError('rule exceeds 20,000 characters.');
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (rest.startsWith('//')) { const end = rest.indexOf('\n'); index += end < 0 ? rest.length : end; continue; }
    if (rest.startsWith('/*')) { const end = rest.indexOf('*/', 2); if (end < 0) throw new LeaveRuleScriptError('unfinished comment.'); index += end + 2; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new LeaveRuleScriptError('numbers must be finite.');
      tokens.push({ text: number[0], value, literal: true }); index += number[0].length;
    } else if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0]; let value = ''; let offset = 1;
      while (offset < rest.length && rest[offset] !== quote) {
        let char = rest[offset++];
        if (char === '\\') {
          const escaped = rest[offset++];
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
          if (!Object.prototype.hasOwnProperty.call(escapes, escaped)) throw new LeaveRuleScriptError('unsupported string escape.');
          char = escapes[escaped];
        }
        value += char;
      }
      if (rest[offset] !== quote || value.length > 2000) throw new LeaveRuleScriptError('invalid or oversized string.');
      tokens.push({ text: rest.slice(0, offset + 1), value, literal: true }); index += offset + 1;
    } else {
      const name = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/);
      if (name) { tokens.push({ text: name[0] }); index += name[0].length; }
      else {
        const op = rest.match(/^(===|!==|<=|>=|==|!=|&&|\|\||[{}();,.?:=+*/%!<>-])/);
        if (!op) throw new LeaveRuleScriptError(`unexpected character at position ${index}.`);
        tokens.push({ text: op[0] }); index += op[0].length;
      }
    }
    if (tokens.length > 2000) throw new LeaveRuleScriptError('rule exceeds the expression complexity limit.');
  }
  return tokens;
}

class Parser {
  private at = 0;
  private depth = 0;
  private readonly locals = new Set<string>();
  constructor(private readonly tokens: Token[]) {}
  private peek() { return this.tokens[this.at]?.text; }
  private eat(text: string) { if (this.peek() !== text) return false; this.at++; return true; }
  private expect(text: string) { if (!this.eat(text)) throw new LeaveRuleScriptError(`expected '${text}'.`); }
  private nested<T>(work: () => T): T {
    if (++this.depth > 50) throw new LeaveRuleScriptError('expression nesting exceeds 50 levels.');
    try { return work(); } finally { this.depth--; }
  }
  private name() {
    const name = this.tokens[this.at++]?.text;
    if (!name || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || RESERVED.has(name)) throw new LeaveRuleScriptError('invalid or reserved variable.');
    if (this.eat('.')) {
      const field = this.tokens[this.at++]?.text;
      if (!field || RESERVED.has(field)) throw new LeaveRuleScriptError('invalid property.');
      return `${name}.${field}`;
    }
    return name;
  }
  parse() {
    const body: Statement[] = [];
    while (this.at < this.tokens.length) body.push(this.statement());
    return body;
  }
  private statement(): Statement {
    return this.nested(() => {
      if (this.eat('{')) {
        const body: Statement[] = [];
        while (this.peek() && this.peek() !== '}') body.push(this.statement());
        this.expect('}'); return { kind: 'block', body };
      }
      if (this.eat('if')) {
        this.expect('('); const condition = this.expression(); this.expect(')');
        const yes = this.statement(); const no = this.eat('else') ? this.statement() : undefined;
        return { kind: 'if', condition, yes, no };
      }
      const declaration = ['let', 'const', 'var'].includes(this.peek() || '');
      if (declaration) this.at++;
      const name = this.name();
      if (name === 'console.log' && !declaration) { const args = this.arguments(); this.eat(';'); return { kind: 'log', args }; }
      if (declaration) {
        if (name.includes('.') || this.locals.has(name) || CONTEXT.has(name)) throw new LeaveRuleScriptError('invalid variable declaration.');
        this.locals.add(name);
      } else if (!OUTPUTS.has(name) && !this.locals.has(name)) throw new LeaveRuleScriptError('only local variables and output entitlement fields may be assigned.');
      this.expect('='); const value = this.expression(); this.eat(';');
      return { kind: 'assign', name, value, declaration };
    });
  }
  private arguments() {
    this.expect('('); const args: Expression[] = [];
    if (!this.eat(')')) {
      do { args.push(this.expression()); if (args.length > 8) throw new LeaveRuleScriptError('at most eight call arguments are allowed.'); } while (this.eat(','));
      this.expect(')');
    }
    return args;
  }
  private expression(min = 0): Expression {
    return this.nested(() => {
      let left = this.primary();
      while (Object.prototype.hasOwnProperty.call(PRECEDENCE, this.peek() || '') && PRECEDENCE[this.peek()!] >= min) {
        const op = this.tokens[this.at++].text;
        left = { kind: 'binary', op, left, right: this.expression(PRECEDENCE[op] + 1) };
      }
      if (min === 0 && this.eat('?')) { const yes = this.expression(); this.expect(':'); left = { kind: 'conditional', condition: left, yes, no: this.expression() }; }
      return left;
    });
  }
  private primary(): Expression {
    if (['!', '+', '-'].includes(this.peek() || '')) { const op = this.tokens[this.at++].text; return this.nested(() => ({ kind: 'unary' as const, op, value: this.primary() })); }
    if (this.eat('(')) { const value = this.expression(); this.expect(')'); return value; }
    const token = this.tokens[this.at];
    if (!token) throw new LeaveRuleScriptError('incomplete expression.');
    if (token.literal) { this.at++; return { kind: 'literal', value: token.value! }; }
    if (['true', 'false', 'null'].includes(token.text)) { this.at++; return { kind: 'literal', value: token.text === 'null' ? null : token.text === 'true' }; }
    const name = this.name();
    if (MATH.has(name) || ['parseFloat', 'parseInt', 'isNaN'].includes(name)) return { kind: 'call', name, args: this.arguments() };
    if (!CONTEXT.has(name) && !OUTPUTS.has(name) && !this.locals.has(name)) throw new LeaveRuleScriptError(`unknown variable '${name}'.`);
    return { kind: 'name', name };
  }
}

export function compileLeaveRule(script: string) { return new Parser(tokenize(script)).parse(); }
export function evaluateLeaveRule(script: string, context: Record<string, unknown>) {
  const body = compileLeaveRule(script);
  const variables = new Map<string, Value>([['output.entitlement', 0], ['output.carryForwardAmount', 0]]);
  for (const name of CONTEXT) {
    const value = context[name];
    if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new LeaveRuleScriptError('context must contain scalar values.');
    variables.set(name, (value ?? null) as Value);
  }
  const logs: string[] = [];
  let budget = 5000;
  const tick = () => { if (--budget < 0) throw new LeaveRuleScriptError('execution complexity limit exceeded.'); };
  const expression = (node: Expression): Value => {
    tick();
    if (node.kind === 'literal') return node.value;
    if (node.kind === 'name') return variables.get(node.name) ?? null;
    if (node.kind === 'unary') { const value = expression(node.value); return node.op === '!' ? !value : node.op === '-' ? -Number(value) : Number(value); }
    if (node.kind === 'conditional') return expression(expression(node.condition) ? node.yes : node.no);
    if (node.kind === 'call') {
      const values = node.args.map(expression);
      if (node.name === 'parseFloat') return parseFloat(String(values[0]));
      if (node.name === 'parseInt') return parseInt(String(values[0]), values[1] === undefined ? 10 : Number(values[1]));
      if (node.name === 'isNaN') return isNaN(Number(values[0]));
      return MATH.get(node.name)!(...values.map(Number));
    }
    const left = expression(node.left);
    if (node.op === '&&') return left ? expression(node.right) : left;
    if (node.op === '||') return left || expression(node.right);
    const right = expression(node.right);
    switch (node.op) {
      case '+': return typeof left === 'string' || typeof right === 'string' ? String(left) + String(right) : Number(left) + Number(right);
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': return Number(left) / Number(right);
      case '%': return Number(left) % Number(right);
      case '===': return left === right;
      case '!==': return left !== right;
      case '==': return left == right;
      case '!=': return left != right;
      case '<': return typeof left === 'string' && typeof right === 'string' ? left < right : Number(left) < Number(right);
      case '<=': return typeof left === 'string' && typeof right === 'string' ? left <= right : Number(left) <= Number(right);
      case '>': return typeof left === 'string' && typeof right === 'string' ? left > right : Number(left) > Number(right);
      case '>=': return typeof left === 'string' && typeof right === 'string' ? left >= right : Number(left) >= Number(right);
      default: throw new LeaveRuleScriptError('unknown operator.');
    }
  };
  const statement = (node: Statement): void => {
    tick();
    if (node.kind === 'block') { for (const item of node.body) statement(item); }
    else if (node.kind === 'if') { if (expression(node.condition)) statement(node.yes); else if (node.no) statement(node.no); }
    else if (node.kind === 'assign') variables.set(node.name, expression(node.value));
    else if (logs.length < 100) logs.push(node.args.map(expression).map(String).join(' ').slice(0, 1000));
  };
  for (const node of body) statement(node);
  const entitlement = Number(variables.get('output.entitlement')), carryForwardAmount = Number(variables.get('output.carryForwardAmount'));
  if (![entitlement, carryForwardAmount].every(value => Number.isFinite(value) && value >= 0 && value <= 366)) throw new LeaveRuleScriptError('entitlement outputs must be finite values between zero and 366.');
  return { entitlement, carryForwardAmount, logs };
}
