#!/usr/bin/env node
interface IRunnerDiagnostic {
    code: string;
    fix: {
        instruction: string;
    };
    message: string;
    severity: "error";
}
declare function exitCodeForReport(report: {
    assertionResults?: readonly unknown[];
    diagnostics?: ReadonlyArray<{
        code?: string;
    }>;
    pass: boolean;
}): 0 | 1 | 2;
declare function classifyRunnerError(error: unknown, options?: {
    cwd?: string;
    scenarioPath?: string;
}): IRunnerDiagnostic;
declare function main(argv?: readonly string[]): Promise<number>;

export { type IRunnerDiagnostic, classifyRunnerError, exitCodeForReport, main };
