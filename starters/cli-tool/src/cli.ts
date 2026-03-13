#!/usr/bin/env node

/**
 * CLI framework — command registration, dispatch, and lifecycle.
 *
 * This is the main entry point when the binary is invoked.
 * It also exports `createCLI()` for programmatic use.
 */

import {
  parse,
  generateHelp,
  ParseError,
  type ParserConfig,
  type OptionDefinition,
  type PositionalDefinition,
  type ParsedArgs,
} from "./parser.js";
import {
  createOutputContext,
  error as printError,
  type OutputContext,
} from "./output.js";
import { createHelpCommand } from "./commands/help.js";
import { initCommand } from "./commands/init.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CLIContext {
  output: OutputContext;
}

export type CommandHandler = (
  args: ParsedArgs,
  ctx: CLIContext,
) => void | Promise<void>;

export interface CommandDefinition {
  name: string;
  description?: string;
  positionals?: PositionalDefinition[];
  options?: OptionDefinition[];
  handler: CommandHandler;
}

export interface CLIOptions {
  name: string;
  version: string;
  description?: string;
  /** Global options added to every command */
  globalOptions?: OptionDefinition[];
  commands?: CommandDefinition[];
}

// ---------------------------------------------------------------------------
// CLI Builder
// ---------------------------------------------------------------------------

export interface CLI {
  /** Register a new command */
  command(def: CommandDefinition): CLI;
  /** Run the CLI against the given argv (defaults to process.argv.slice(2)) */
  run(argv?: string[]): Promise<void>;
}

export function createCLI(opts: CLIOptions): CLI {
  const commands = new Map<string, CommandDefinition>();

  // Register commands passed via options
  for (const cmd of opts.commands ?? []) {
    commands.set(cmd.name, cmd);
  }

  // Global options that every command inherits
  const globalOptions: OptionDefinition[] = [
    ...(opts.globalOptions ?? []),
    {
      name: "help",
      alias: "h",
      type: "boolean",
      description: "Show help",
      default: false,
    },
    {
      name: "version",
      alias: "V",
      type: "boolean",
      description: "Show version",
      default: false,
    },
    {
      name: "json",
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
    {
      name: "quiet",
      alias: "q",
      type: "boolean",
      description: "Suppress non-error output",
      default: false,
    },
    {
      name: "no-color",
      type: "boolean",
      description: "Disable colored output",
      default: false,
    },
  ];

  function buildParserConfig(): ParserConfig {
    const subcommands = new Map<string, ParserConfig>();
    for (const [name, cmd] of commands) {
      subcommands.set(name, {
        name: `${opts.name} ${name}`,
        description: cmd.description,
        positionals: cmd.positionals,
        options: [...(cmd.options ?? []), ...globalOptions],
      });
    }

    return {
      name: opts.name,
      description: opts.description,
      version: opts.version,
      positionals: [],
      options: globalOptions,
      subcommands: subcommands.size > 0 ? subcommands : undefined,
    };
  }

  const cli: CLI = {
    command(def: CommandDefinition): CLI {
      commands.set(def.name, def);
      return cli;
    },

    async run(argv?: string[]): Promise<void> {
      const args = argv ?? process.argv.slice(2);
      const config = buildParserConfig();

      // Register built-in help command
      if (!commands.has("help")) {
        commands.set("help", {
          name: "help",
          description: "Show help for a command",
          positionals: [
            { name: "command", required: false, description: "Command name" },
          ],
          handler: createHelpCommand(config),
        });
        // Rebuild config with help command
        const updatedConfig = buildParserConfig();
        // Re-register help with updated config
        commands.set("help", {
          name: "help",
          description: "Show help for a command",
          positionals: [
            { name: "command", required: false, description: "Command name" },
          ],
          handler: createHelpCommand(updatedConfig),
        });
      }

      let parsed: ParsedArgs;
      try {
        parsed = parse(buildParserConfig(), args);
      } catch (err) {
        if (err instanceof ParseError) {
          const out = createOutputContext();
          printError(out, err.message);
          process.exitCode = 1;
          return;
        }
        throw err;
      }

      // Create output context from global flags
      const out = createOutputContext({
        json: parsed.options["json"] === true,
        quiet: parsed.options["quiet"] === true,
        color: parsed.options["no-color"] === true ? false : undefined,
      });

      const ctx: CLIContext = { output: out };

      // --version flag
      if (parsed.options["version"] === true) {
        out.stdout.write(`${opts.version}\n`);
        return;
      }

      // --help flag (no command)
      if (parsed.options["help"] === true && !parsed.command) {
        const helpText = generateHelp(buildParserConfig());
        out.stdout.write(helpText + "\n");
        return;
      }

      // Dispatch command
      if (parsed.command) {
        const cmd = commands.get(parsed.command);
        if (!cmd) {
          printError(out, `Unknown command: ${parsed.command}`);
          process.exitCode = 1;
          return;
        }

        // --help flag with command
        if (parsed.options["help"] === true) {
          const subConfig = buildParserConfig().subcommands?.get(parsed.command);
          if (subConfig) {
            out.stdout.write(generateHelp(subConfig) + "\n");
          }
          return;
        }

        try {
          await cmd.handler(parsed, ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          printError(out, msg);
          process.exitCode = 1;
        }
        return;
      }

      // No command — show help
      const helpText = generateHelp(buildParserConfig());
      out.stdout.write(helpText + "\n");
    },
  };

  return cli;
}

// ---------------------------------------------------------------------------
// Default CLI instance — run when invoked as a binary
// ---------------------------------------------------------------------------

function main(): void {
  const cli = createCLI({
    name: "mycli",
    version: "1.0.0",
    description: "A CLI tool starter built with zero dependencies",
  });

  cli.command({
    name: "init",
    description: "Initialize a new project",
    handler: initCommand,
  });

  cli.run().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Only run main() when executed directly (not imported)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("/cli.ts"));

if (isMain) {
  main();
}

export { main };
