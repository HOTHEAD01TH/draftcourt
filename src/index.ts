import { Hono } from "hono";
import {
  LayaNotRunning,
  LAYA_NOT_RUNNING,
  confidenceOf,
  isAbstained,
  layaHealth,
  noulOf,
  predict,
  scoreOf,
  type Question,
} from "./laya.ts";

const PORT = 3003;
const MIN_CONFIDENCE = 0.6;

const SCORE_LEVELS: Record<string, readonly string[]> = {
  clarity: ["opaque", "muddled", "readable", "sharp"],
  specificity: ["vague", "general", "concrete", "exact"],
  audience_fit: ["unnamed", "implied", "named", "specific"],
  tone: ["reckless", "uneven", "steady", "careful"],
};

const questions: Record<string, Question> = {
  clarity: {
    type: "score",
    instructions: "How clear is this draft to a first-time reader? Do not rewrite it.",
    criteria: [...SCORE_LEVELS.clarity],
  },
  specificity: {
    type: "score",
    instructions: "How concrete are the details in this draft? Do not rewrite it.",
    criteria: [...SCORE_LEVELS.specificity],
  },
  audience_fit: {
    type: "score",
    instructions: "How clearly the draft names who it is for. Do not rewrite it.",
    criteria: [...SCORE_LEVELS.audience_fit],
  },
  tone: {
    type: "score",
    instructions: "How controlled the tone is. Do not rewrite it.",
    criteria: [...SCORE_LEVELS.tone],
  },
  claim_risk: {
    type: "noul",
    instructions: "A reader could take a sentence in this draft as an unearned claim. Do not rewrite it.",
  },
  spam: {
    type: "noul",
    instructions: "This draft reads like spam. Do not rewrite it.",
  },
  missing_basis: {
    type: "noul",
    instructions: "A material claim in this draft has no basis in the draft itself. Do not rewrite it.",
  },
  pressure: {
    type: "noul",
    instructions: "The draft pressures the reader to act immediately. Do not rewrite it.",
  },
};

type Row =
  | {
      name: string;
      kind: "score";
      abstained: boolean;
      level: string | null;
      value: number | null;
      confidence: number | null;
    }
  | {
      name: string;
      kind: "noul";
      abstained: boolean;
      noul: number | null;
      confidence: number | null;
    };

type Card = {
  id: string;
  text: string;
  rows: Row[];
  unsure: boolean;
  confirmed: boolean;
  model: string;
  createdAt: string;
};

let current: Card | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rowsFrom(result: Awaited<ReturnType<typeof predict>>): { rows: Row[]; unsure: boolean } {
  const rows: Row[] = [];
  let unsure = false;
  for (const [name, question] of Object.entries(questions)) {
    const answer = result.answers[name];
    const abstained = isAbstained(answer, MIN_CONFIDENCE);
    if (abstained) unsure = true;
    if (question.type === "score") {
      const scored = scoreOf(answer, SCORE_LEVELS[name] ?? []);
      if (!scored) unsure = true;
      rows.push({
        name,
        kind: "score",
        abstained: abstained || !scored,
        level: abstained || !scored ? null : scored.level,
        value: abstained || !scored ? null : scored.value,
        confidence: confidenceOf(answer),
      });
    } else {
      const noul = noulOf(answer);
      if (noul === null) unsure = true;
      rows.push({
        name,
        kind: "noul",
        abstained: abstained || noul === null,
        noul: abstained || noul === null ? null : noul,
        confidence: confidenceOf(answer),
      });
    }
  }
  return { rows, unsure };
}

const app = new Hono();
const page = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

app.get("/", (c) => c.html(page));

app.get("/api/health", async (c) => {
  const health = await layaHealth();
  if (!health.ok) return c.json({ ok: false, error: LAYA_NOT_RUNNING }, 503);
  return c.json({ ok: true, model_loaded: health.modelLoaded, laya_version: health.version });
});

app.get("/api/score", (c) => c.json({ card: current, min_confidence: MIN_CONFIDENCE }));

app.post("/api/score", async (c) => {
  const raw: unknown = await c.req.json().catch(() => null);
  if (!isRecord(raw) || typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > 20000) {
    return c.json({ error: "text is required" }, 400);
  }
  try {
    const result = await predict({ text: raw.text }, questions, MIN_CONFIDENCE);
    const built = rowsFrom(result);
    current = {
      id: crypto.randomUUID(),
      text: raw.text,
      rows: built.rows,
      unsure: built.unsure,
      confirmed: false,
      model: result.model,
      createdAt: new Date().toISOString(),
    };
    return c.json({ card: current });
  } catch (err) {
    if (err instanceof LayaNotRunning) return c.json({ error: LAYA_NOT_RUNNING }, 503);
    throw err;
  }
});

app.post("/api/confirm", async (c) => {
  const raw: unknown = await c.req.json().catch(() => ({}));
  if (raw !== null && typeof raw !== "object") return c.json({ error: "expected a JSON object" }, 400);
  if (!current) return c.json({ error: "nothing to confirm" }, 400);
  if (isRecord(raw) && typeof raw.id === "string" && raw.id !== current.id) {
    return c.json({ error: "id does not match the current scorecard" }, 400);
  }
  current = { ...current, confirmed: true };
  return c.json({ card: current });
});

app.onError((err, c) => {
  console.error(err);
  if (err instanceof LayaNotRunning || (err instanceof Error && err.message === LAYA_NOT_RUNNING)) {
    return c.json({ error: LAYA_NOT_RUNNING }, 503);
  }
  return c.json({ error: "internal error" }, 500);
});

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: app.fetch });
  console.log(`draftcourt listening on http://localhost:${PORT}`);
}
