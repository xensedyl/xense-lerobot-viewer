import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { resolveDatasetRoot } from "@/lib/local-dataset-paths";
import {
  DOCTOR_CHECK_IDS,
  type DoctorCheckId,
  type DoctorRunResponse,
} from "@/types/doctor.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_EPISODES = 25;
const MAX_EPISODES_LIMIT = 500;
const DOCTOR_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const CHECK_IDS = new Set<string>(DOCTOR_CHECK_IDS);

interface DoctorRequestBody {
  maxEpisodes?: unknown;
  checks?: unknown;
}

interface BridgeError {
  ok: false;
  error?: string;
  error_type?: "dependency" | "diagnostic";
}

type BridgeResult = DoctorRunResponse | BridgeError;

interface ProcessResult {
  code: number | null;
  payload: BridgeResult | null;
  stderr: string;
  failure?: string;
}

function parseOptions(
  body: DoctorRequestBody,
):
  | { maxEpisodes: number | null; checks: DoctorCheckId[] | null }
  | { error: string } {
  let maxEpisodes: number | null = DEFAULT_MAX_EPISODES;
  if (body.maxEpisodes === null) {
    maxEpisodes = null;
  } else if (body.maxEpisodes !== undefined) {
    if (
      typeof body.maxEpisodes !== "number" ||
      !Number.isInteger(body.maxEpisodes) ||
      body.maxEpisodes < 1 ||
      body.maxEpisodes > MAX_EPISODES_LIMIT
    ) {
      return {
        error: `maxEpisodes must be null or an integer from 1 to ${MAX_EPISODES_LIMIT}.`,
      };
    }
    maxEpisodes = body.maxEpisodes;
  }

  let checks: DoctorCheckId[] | null = null;
  if (body.checks !== undefined) {
    if (!Array.isArray(body.checks) || body.checks.length === 0) {
      return { error: "checks must be a non-empty array when provided." };
    }
    const unique = [...new Set(body.checks)];
    if (
      unique.some((check) => typeof check !== "string" || !CHECK_IDS.has(check))
    ) {
      return { error: "checks contains an unknown Doctor check id." };
    }
    checks = unique as DoctorCheckId[];
  }

  return { maxEpisodes, checks };
}

async function validateDatasetRoot(
  encodedPath: string,
): Promise<string | null> {
  const datasetRoot = resolveDatasetRoot(encodedPath);
  if (!datasetRoot) return null;

  try {
    const [rootStat, infoStat] = await Promise.all([
      fs.stat(datasetRoot),
      fs.stat(path.join(datasetRoot, "meta", "info.json")),
    ]);
    if (!rootStat.isDirectory() || !infoStat.isFile()) return null;
  } catch {
    return null;
  }
  return datasetRoot;
}

function parseBridgePayload(stdout: string): BridgeResult | null {
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!lastLine) return null;
  try {
    return JSON.parse(lastLine) as BridgeResult;
  } catch {
    return null;
  }
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 2_000);
  forceTimer.unref();
}

function runDoctor(
  datasetRoot: string,
  maxEpisodes: number | null,
  checks: DoctorCheckId[] | null,
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const python = process.env.PYTHON_BIN?.trim() || "python3";
    const script = path.join(process.cwd(), "scripts", "run_lerobot_doctor.py");
    const args = [script, datasetRoot];
    if (maxEpisodes !== null) {
      args.push("--max-episodes", String(maxEpisodes));
    }
    if (checks) args.push("--checks", checks.join(","));

    const child = spawn(python, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let exceededOutput = false;

    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const appendBounded = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        exceededOutput = true;
        terminate(child);
        return current;
      }
      return current + chunk.toString();
    };
    const onAbort = () => {
      terminate(child);
      finish({ code: null, payload: null, stderr, failure: "aborted" });
    };
    const timeout = setTimeout(() => {
      terminate(child);
      finish({ code: null, payload: null, stderr, failure: "timeout" });
    }, DOCTOR_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({
        code: null,
        payload: null,
        stderr,
        failure: `Could not launch ${python}: ${error.message}`,
      });
    });
    child.on("close", (code) => {
      finish({
        code,
        payload: exceededOutput ? null : parseBridgePayload(stdout),
        stderr,
        failure: exceededOutput
          ? "Doctor produced more than 10 MiB of output."
          : undefined,
      });
    });

    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function lastStderrLine(stderr: string): string | null {
  return stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ encodedPath: string }> },
): Promise<Response> {
  const { encodedPath } = await context.params;
  const datasetRoot = await validateDatasetRoot(encodedPath);
  if (!datasetRoot) {
    return Response.json({ error: "Dataset not found." }, { status: 404 });
  }

  let body: DoctorRequestBody = {};
  try {
    const rawBody = (await request.json()) as unknown;
    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      return Response.json(
        { error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }
    body = rawBody as DoctorRequestBody;
  } catch {
    return Response.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const options = parseOptions(body);
  if ("error" in options) {
    return Response.json({ error: options.error }, { status: 400 });
  }

  const result = await runDoctor(
    datasetRoot,
    options.maxEpisodes,
    options.checks,
    request.signal,
  );
  if (result.failure === "aborted") {
    return new Response(null, { status: 499 });
  }
  if (result.failure === "timeout") {
    return Response.json(
      { error: "Doctor timed out after 5 minutes." },
      { status: 504 },
    );
  }
  if (result.payload?.ok) return Response.json(result.payload);

  const error =
    result.payload?.error ||
    result.failure ||
    lastStderrLine(result.stderr) ||
    `Doctor exited without a valid report (exit ${result.code ?? "unknown"}).`;
  const dependencyError = result.payload?.error_type === "dependency";
  return Response.json(
    {
      error,
      hint: dependencyError
        ? "Install the Python integration with: python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt -e ../lerobot-doctor, then start with PYTHON_BIN=.venv/bin/python bun dev."
        : undefined,
    },
    { status: dependencyError ? 503 : 500 },
  );
}
