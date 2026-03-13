/**
 * Interactive prompts using Node.js built-in readline.
 *
 * Provides text input, confirmation, and selection prompts — zero dependencies.
 */

import { createInterface, Interface as ReadlineInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRL(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): ReadlineInterface {
  return createInterface({ input, output });
}

function question(rl: ReadlineInterface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

// ---------------------------------------------------------------------------
// Prompt options
// ---------------------------------------------------------------------------

export interface PromptStreamOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export interface TextPromptOptions extends PromptStreamOptions {
  message: string;
  default?: string;
  /** Validate input — return an error string or undefined */
  validate?: (value: string) => string | undefined;
}

export interface ConfirmPromptOptions extends PromptStreamOptions {
  message: string;
  default?: boolean;
}

export interface SelectPromptOptions extends PromptStreamOptions {
  message: string;
  choices: Array<{ name: string; value: string; description?: string }>;
  default?: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * Prompt for free-text input.
 */
export async function text(opts: TextPromptOptions): Promise<string> {
  const rl = createRL(opts.input, opts.output);
  const defaultHint = opts.default !== undefined ? ` (${opts.default})` : "";
  const query = `${opts.message}${defaultHint}: `;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const answer = await question(rl, query);
      const value = answer.trim() || opts.default || "";

      if (opts.validate) {
        const err = opts.validate(value);
        if (err) {
          const stream = opts.output ?? process.stdout;
          stream.write(`  Error: ${err}\n`);
          continue;
        }
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

/**
 * Prompt for yes/no confirmation.
 */
export async function confirm(opts: ConfirmPromptOptions): Promise<boolean> {
  const rl = createRL(opts.input, opts.output);
  const hint = opts.default === false ? "y/N" : "Y/n";
  const query = `${opts.message} (${hint}): `;

  try {
    const answer = await question(rl, query);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") {
      return opts.default ?? true;
    }
    return trimmed === "y" || trimmed === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Prompt to select from a list.
 *
 * Displays numbered choices and waits for the user to enter a number.
 */
export async function select(opts: SelectPromptOptions): Promise<string> {
  const rl = createRL(opts.input, opts.output);
  const stream = opts.output ?? process.stdout;

  try {
    stream.write(`${opts.message}\n`);
    for (let i = 0; i < opts.choices.length; i++) {
      const choice = opts.choices[i]!;
      const desc = choice.description ? ` - ${choice.description}` : "";
      const marker = choice.value === opts.default ? " (default)" : "";
      stream.write(`  ${i + 1}) ${choice.name}${desc}${marker}\n`);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const answer = await question(rl, "Enter selection: ");
      const trimmed = answer.trim();

      // Allow selecting by number
      const num = parseInt(trimmed, 10);
      if (num >= 1 && num <= opts.choices.length) {
        return opts.choices[num - 1]!.value;
      }

      // Allow selecting by value name
      const byValue = opts.choices.find((c) => c.value === trimmed);
      if (byValue) return byValue.value;

      // Empty input with default
      if (trimmed === "" && opts.default !== undefined) {
        return opts.default;
      }

      stream.write(`  Please enter a number between 1 and ${opts.choices.length}\n`);
    }
  } finally {
    rl.close();
  }
}
