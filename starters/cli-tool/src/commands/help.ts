/**
 * Built-in help command — displays formatted help for the CLI or a subcommand.
 */

import type { CommandHandler, CLIContext } from "../cli.js";
import type { ParserConfig } from "../parser.js";
import { generateHelp } from "../parser.js";
import { info } from "../output.js";

export function createHelpCommand(rootConfig: ParserConfig): CommandHandler {
  return (_args, ctx) => {
    const { positionals } = _args;
    const subName = positionals["command"];

    if (subName && rootConfig.subcommands) {
      const sub = rootConfig.subcommands.get(subName);
      if (sub) {
        const helpText = generateHelp(sub);
        ctx.output.stdout.write(helpText + "\n");
        return;
      }
      info(ctx.output, `Unknown command "${subName}". Showing main help.`);
    }

    const helpText = generateHelp(rootConfig);
    ctx.output.stdout.write(helpText + "\n");
  };
}
