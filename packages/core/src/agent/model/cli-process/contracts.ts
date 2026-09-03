export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandInvocation {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}
