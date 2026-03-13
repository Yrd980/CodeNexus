/**
 * Zero-dependency argument parser.
 *
 * Supports positional args, named options (--name value, --name=value, -n value),
 * boolean flags (--verbose, --no-color), sub-commands, type coercion, and validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptionType = "string" | "number" | "boolean";

export interface OptionDefinition {
  /** Long name without dashes, e.g. "output" for --output */
  name: string;
  /** Single-character alias, e.g. "o" for -o */
  alias?: string;
  /** Expected value type (default: "string") */
  type?: OptionType;
  /** Human-readable description shown in help text */
  description?: string;
  /** Default value when the option is not provided */
  default?: string | number | boolean;
  /** Whether the option must be provided */
  required?: boolean;
  /** Custom validation function — return an error string or undefined */
  validate?: (value: string | number | boolean) => string | undefined;
}

export interface PositionalDefinition {
  /** Positional name used as the key in parsed results */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether the positional argument is required (default: true) */
  required?: boolean;
  /** Default value when not provided */
  default?: string;
  /** Custom validation */
  validate?: (value: string) => string | undefined;
}

export interface ParsedArgs {
  /** The matched sub-command name, if any */
  command?: string;
  /** Positional argument values keyed by name */
  positionals: Record<string, string>;
  /** Named option values keyed by long name */
  options: Record<string, string | number | boolean>;
  /** Everything after "--" */
  rest: string[];
}

export interface ParserConfig {
  /** Application / command name (used in help text) */
  name: string;
  /** One-line description */
  description?: string;
  /** Version string */
  version?: string;
  /** Positional arguments in order */
  positionals?: PositionalDefinition[];
  /** Named options */
  options?: OptionDefinition[];
  /** Sub-commands — each with its own ParserConfig */
  subcommands?: Map<string, ParserConfig>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function coerce(
  raw: string,
  type: OptionType,
  optName: string,
): string | number | boolean {
  switch (type) {
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new ParseError(
          `Option --${optName} expects a number but got "${raw}"`,
        );
      }
      return n;
    }
    case "boolean":
      return raw === "true" || raw === "1" || raw === "yes";
    case "string":
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an argv-style string array against a ParserConfig.
 *
 * The array should **not** include the node binary or script path — only the
 * user-supplied arguments (i.e. `process.argv.slice(2)`).
 */
export function parse(config: ParserConfig, argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    positionals: {},
    options: {},
    rest: [],
  };

  // Build lookup maps for options
  const byLong = new Map<string, OptionDefinition>();
  const byAlias = new Map<string, OptionDefinition>();
  for (const opt of config.options ?? []) {
    byLong.set(opt.name, opt);
    if (opt.alias) {
      byAlias.set(opt.alias, opt);
    }
  }

  // Collect positional definitions
  const positionalDefs = config.positionals ?? [];
  let positionalIndex = 0;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    // Rest separator
    if (arg === "--") {
      result.rest = argv.slice(i + 1);
      break;
    }

    // Sub-command detection — first non-option token may be a subcommand
    if (
      config.subcommands &&
      config.subcommands.size > 0 &&
      !arg.startsWith("-") &&
      result.command === undefined &&
      positionalIndex === 0
    ) {
      const sub = config.subcommands.get(arg);
      if (sub) {
        result.command = arg;
        // Recursively parse the remaining argv against the subcommand config,
        // but merge global options already parsed.
        const subResult = parse(sub, argv.slice(i + 1));
        // Merge: subcommand results take precedence
        return {
          command: arg,
          positionals: { ...result.positionals, ...subResult.positionals },
          options: { ...result.options, ...subResult.options },
          rest: subResult.rest,
        };
      }
    }

    // Long option: --name=value or --name value or --no-name (boolean negation)
    if (arg.startsWith("--")) {
      const withoutDashes = arg.slice(2);

      // Handle --no-xxx boolean negation
      if (withoutDashes.startsWith("no-")) {
        const negatedName = withoutDashes.slice(3);
        const def = byLong.get(negatedName);
        if (def && (def.type === "boolean" || def.type === undefined)) {
          result.options[negatedName] = false;
          i++;
          continue;
        }
      }

      // Handle --name=value
      const eqIndex = withoutDashes.indexOf("=");
      if (eqIndex !== -1) {
        const name = withoutDashes.slice(0, eqIndex);
        const rawValue = withoutDashes.slice(eqIndex + 1);
        const def = byLong.get(name);
        if (!def) {
          throw new ParseError(`Unknown option --${name}`);
        }
        result.options[name] = coerce(rawValue, def.type ?? "string", name);
        i++;
        continue;
      }

      // Handle --name value or --flag (boolean)
      const def = byLong.get(withoutDashes);
      if (!def) {
        throw new ParseError(`Unknown option --${withoutDashes}`);
      }
      if (def.type === "boolean") {
        result.options[withoutDashes] = true;
        i++;
        continue;
      }
      // Consume next token as value
      const nextToken = argv[i + 1];
      if (nextToken === undefined || nextToken.startsWith("-")) {
        throw new ParseError(`Option --${withoutDashes} requires a value`);
      }
      result.options[withoutDashes] = coerce(
        nextToken,
        def.type ?? "string",
        withoutDashes,
      );
      i += 2;
      continue;
    }

    // Short option: -n value or -n (boolean)
    if (arg.startsWith("-") && arg.length === 2) {
      const alias = arg[1]!;
      const def = byAlias.get(alias);
      if (!def) {
        throw new ParseError(`Unknown option -${alias}`);
      }
      if (def.type === "boolean") {
        result.options[def.name] = true;
        i++;
        continue;
      }
      const nextToken = argv[i + 1];
      if (nextToken === undefined || nextToken.startsWith("-")) {
        throw new ParseError(`Option -${alias} (--${def.name}) requires a value`);
      }
      result.options[def.name] = coerce(
        nextToken,
        def.type ?? "string",
        def.name,
      );
      i += 2;
      continue;
    }

    // Positional argument
    const posDef = positionalDefs[positionalIndex];
    if (posDef) {
      result.positionals[posDef.name] = arg;
      positionalIndex++;
    } else {
      // Extra positional — store in rest
      result.rest.push(arg);
    }
    i++;
  }

  // Apply defaults for options not provided
  for (const opt of config.options ?? []) {
    if (!(opt.name in result.options) && opt.default !== undefined) {
      result.options[opt.name] = opt.default;
    }
  }

  // Apply defaults for positionals not provided
  for (const pos of positionalDefs) {
    if (!(pos.name in result.positionals) && pos.default !== undefined) {
      result.positionals[pos.name] = pos.default;
    }
  }

  // Validate required options
  for (const opt of config.options ?? []) {
    if (opt.required && !(opt.name in result.options)) {
      throw new ParseError(`Missing required option --${opt.name}`);
    }
  }

  // Validate required positionals
  for (const pos of positionalDefs) {
    const isRequired = pos.required !== false; // default true
    if (isRequired && !(pos.name in result.positionals)) {
      throw new ParseError(`Missing required argument <${pos.name}>`);
    }
  }

  // Run custom validators
  for (const opt of config.options ?? []) {
    const val = result.options[opt.name];
    if (val !== undefined && opt.validate) {
      const err = opt.validate(val);
      if (err) {
        throw new ParseError(`Invalid value for --${opt.name}: ${err}`);
      }
    }
  }

  for (const pos of positionalDefs) {
    const val = result.positionals[pos.name];
    if (val !== undefined && pos.validate) {
      const err = pos.validate(val);
      if (err) {
        throw new ParseError(`Invalid value for <${pos.name}>: ${err}`);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Help text generation
// ---------------------------------------------------------------------------

export function generateHelp(config: ParserConfig): string {
  const lines: string[] = [];

  // Header
  if (config.description) {
    lines.push(config.description);
    lines.push("");
  }

  // Usage line
  const parts = [config.name];
  if (config.subcommands && config.subcommands.size > 0) {
    parts.push("<command>");
  }
  for (const pos of config.positionals ?? []) {
    const required = pos.required !== false;
    parts.push(required ? `<${pos.name}>` : `[${pos.name}]`);
  }
  if ((config.options ?? []).length > 0) {
    parts.push("[options]");
  }
  lines.push(`Usage: ${parts.join(" ")}`);
  lines.push("");

  // Positionals
  if ((config.positionals ?? []).length > 0) {
    lines.push("Arguments:");
    for (const pos of config.positionals ?? []) {
      const desc = pos.description ?? "";
      const req = pos.required !== false ? " (required)" : "";
      const def =
        pos.default !== undefined ? ` [default: ${String(pos.default)}]` : "";
      lines.push(`  ${pos.name.padEnd(20)} ${desc}${req}${def}`);
    }
    lines.push("");
  }

  // Sub-commands
  if (config.subcommands && config.subcommands.size > 0) {
    lines.push("Commands:");
    for (const [name, sub] of config.subcommands) {
      const desc = sub.description ?? "";
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
    lines.push("");
  }

  // Options
  if ((config.options ?? []).length > 0) {
    lines.push("Options:");
    for (const opt of config.options ?? []) {
      const aliasStr = opt.alias ? `-${opt.alias}, ` : "    ";
      const longStr = `--${opt.name}`;
      const left = `  ${aliasStr}${longStr}`;
      const desc = opt.description ?? "";
      const def =
        opt.default !== undefined ? ` [default: ${String(opt.default)}]` : "";
      lines.push(`${left.padEnd(26)} ${desc}${def}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
