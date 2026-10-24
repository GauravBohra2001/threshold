/**
 * Case Agent evaluation runner (Req 9.5).
 *
 * Runs all 12 tasks x 3 isolated trials (36 trials) against synthetic fixture
 * 311 data, with NO live Azure call and NO live Boston 311 call (every trial is
 * driven by a scripted chat client and fixture-backed tools — see harness.ts).
 *
 * It prints:
 *  - per-task results (each trial pass/fail with the failing grader detail);
 *  - the overall success rate across all 36 trials;
 *  - pass^3: the share of the 12 tasks for which ALL 3 trials passed.
 *
 * It writes one JSON transcript per trial to tests/evals/results/, plus a
 * summary.json. That directory is gitignored.
 *
 * `main()` returns a structured summary so the thin executor (eval.test.ts, the
 * only offline TS runner available) can assert on it. This file does all the
 * printing and file writing itself, so it reads as a standalone runner.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TASKS } from "./tasks";
import { runTrial } from "./harness";
import { gradeTrial, type TrialGrade } from "./graders";

const TRIALS_PER_TASK = 3;

/** Per-task roll-up across its 3 trials. */
export interface TaskSummary {
  id: string;
  title: string;
  trials: Array<{ trial: number; passed: boolean; grade: TrialGrade }>;
  allPassed: boolean;
}

/** The whole-run summary returned by `main()`. */
export interface EvalSummary {
  totalTrials: number;
  passedTrials: number;
  successRate: number; // 0..1 across all trials
  passCubed: number; // 0..1 share of tasks where all 3 trials passed
  tasks: TaskSummary[];
}

/** Directory this file lives in, used to resolve the results output dir. */
function hereDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function resultsDir(): string {
  // tests/evals/case-agent/ -> tests/evals/results/
  return join(hereDir(), "..", "results");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Run the whole suite. `log` defaults to console.log; `write` controls whether
 * transcripts are written (the executor passes write=true).
 */
export async function main(
  opts: { log?: (line: string) => void; write?: boolean } = {},
): Promise<EvalSummary> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const write = opts.write ?? true;

  const outDir = resultsDir();
  if (write) await mkdir(outDir, { recursive: true });

  const taskSummaries: TaskSummary[] = [];
  let passedTrials = 0;
  let totalTrials = 0;

  log("");
  log("Case Agent evaluation — 12 tasks x 3 isolated trials (fixture 311 data, no live calls)");
  log("=".repeat(80));

  for (const task of TASKS) {
    const trials: TaskSummary["trials"] = [];
    log("");
    log(`Task ${task.id}: ${task.title}`);

    for (let trial = 1; trial <= TRIALS_PER_TASK; trial++) {
      const record = await runTrial(task, trial);
      const grade = gradeTrial(task, record);
      totalTrials += 1;
      if (grade.passed) passedTrials += 1;
      trials.push({ trial, passed: grade.passed, grade });

      const mark = grade.passed ? "PASS" : "FAIL";
      log(`  trial ${trial}: ${mark}`);
      if (!grade.passed) {
        for (const g of grade.graders) {
          if (!g.passed) log(`      - ${g.name}: ${g.detail}`);
        }
      }

      if (write) {
        const file = join(outDir, `${task.id}.trial-${trial}.json`);
        await writeFile(
          file,
          JSON.stringify(
            { taskId: task.id, trial, passed: grade.passed, grade, result: record.result },
            null,
            2,
          ),
          "utf8",
        );
      }
    }

    const allPassed = trials.every((t) => t.passed);
    log(`  => ${trials.filter((t) => t.passed).length}/${TRIALS_PER_TASK} trials passed`);
    taskSummaries.push({ id: task.id, title: task.title, trials, allPassed });
  }

  const tasksAllPassed = taskSummaries.filter((t) => t.allPassed).length;
  const summary: EvalSummary = {
    totalTrials,
    passedTrials,
    successRate: totalTrials === 0 ? 0 : passedTrials / totalTrials,
    passCubed: taskSummaries.length === 0 ? 0 : tasksAllPassed / taskSummaries.length,
    tasks: taskSummaries,
  };

  log("");
  log("=".repeat(80));
  log(`Overall success rate: ${passedTrials}/${totalTrials} trials (${pct(summary.successRate)})`);
  log(
    `pass^3 (tasks with all 3 trials passing): ${tasksAllPassed}/${taskSummaries.length} (${pct(
      summary.passCubed,
    )})`,
  );
  log("");

  if (write) {
    await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    log(`Transcripts written to ${outDir}`);
  }

  return summary;
}
