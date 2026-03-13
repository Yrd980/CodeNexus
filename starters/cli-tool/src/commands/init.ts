/**
 * Example "init" command — interactive project initialization.
 *
 * Demonstrates how to combine prompts, config, and output in a real command.
 */

import type { CommandHandler } from "../cli.js";
import { text, confirm, select } from "../prompts.js";
import { success, info } from "../output.js";

export const initCommand: CommandHandler = async (_args, ctx) => {
  info(ctx.output, "Initializing a new project...\n");

  const projectName = await text({
    message: "Project name",
    default: "my-project",
    validate: (v) => {
      if (!/^[a-z0-9-]+$/.test(v)) {
        return "Only lowercase letters, numbers, and hyphens allowed";
      }
      return undefined;
    },
  });

  const template = await select({
    message: "Choose a template:",
    choices: [
      { name: "Minimal", value: "minimal", description: "Bare-bones setup" },
      { name: "API Server", value: "api", description: "REST API with Express" },
      { name: "Full Stack", value: "fullstack", description: "Next.js + API" },
    ],
    default: "minimal",
  });

  const useTypeScript = await confirm({
    message: "Use TypeScript?",
    default: true,
  });

  const shouldContinue = await confirm({
    message: `Create project "${projectName}" with template "${template}"?`,
    default: true,
  });

  if (!shouldContinue) {
    info(ctx.output, "Aborted.");
    return;
  }

  // In a real CLI you would scaffold files here.
  // For the starter template, we just show what would happen.
  success(
    ctx.output,
    `Project "${projectName}" initialized with template "${template}" (TypeScript: ${useTypeScript})`,
  );
};
