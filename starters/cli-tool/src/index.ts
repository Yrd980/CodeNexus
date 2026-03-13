/**
 * Public API — re-exports everything needed to build a CLI.
 *
 * Usage:
 * ```ts
 * import { createCLI, createConfig, createOutputContext } from "@codenexus/cli-tool";
 * ```
 */

// CLI framework
export { createCLI } from "./cli.js";
export type { CLI, CLIOptions, CLIContext, CommandDefinition, CommandHandler } from "./cli.js";

// Argument parser
export { parse, generateHelp, ParseError } from "./parser.js";
export type {
  ParserConfig,
  OptionDefinition,
  PositionalDefinition,
  ParsedArgs,
  OptionType,
} from "./parser.js";

// Output formatting
export {
  createOutputContext,
  success,
  error,
  warning,
  info,
  formatTable,
  printTable,
  createSpinner,
  bold,
  dim,
  red,
  green,
  yellow,
  blue,
  cyan,
} from "./output.js";
export type {
  OutputOptions,
  OutputContext,
  TableOptions,
  Spinner,
} from "./output.js";

// Config management
export { createConfig, getConfigDir, getConfigPath } from "./config.js";
export type {
  ConfigOptions,
  ConfigManager,
  ConfigSchema,
  ConfigRecord,
  ConfigValue,
} from "./config.js";

// Interactive prompts
export { text, confirm, select } from "./prompts.js";
export type {
  TextPromptOptions,
  ConfirmPromptOptions,
  SelectPromptOptions,
} from "./prompts.js";
