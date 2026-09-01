import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { hasMatchLabAccess } from "../../access";
import u01LlmResult from "../../../U01_LLM_Matching_Evaluation.json";

export const dynamic = "force-dynamic";

async function ensureSchema() {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_name TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, evaluator_id TEXT NOT NULL, evaluator_name TEXT NOT NULL, query_id TEXT NOT NULL, candidate_id TEXT NOT NULL, intent TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_evaluator_pair_intent ON reviews(evaluator_id, query_id, candidate_id, intent)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS llm_runs (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)"),
  ]);
  await env.DB.prepare("INSERT OR IGNORE INTO llm_runs (id,query_id,payload,created_at) VALUES (?,?,?,?)")
    .bind("u01-codex-v1","U01",JSON.stringify(u01LlmResult),Date.parse(u01LlmResult.generated_at)).run();
}

export async function GET() {
  if (!await hasMatchLabAccess()) return Response.json({error:"Access password required"},{status:403});
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Sign in required"},{status:401});
  await ensureSchema();
  const [profileRows, reviewRows, llmRows] = await Promise.all([
    env.DB.prepare("SELECT payload FROM profiles ORDER BY id").all<{payload:string}>(),
    env.DB.prepare("SELECT evaluator_id, evaluator_name, query_id, candidate_id, intent, payload, updated_at FROM reviews ORDER BY updated_at DESC").all<any>(),
    env.DB.prepare("SELECT payload FROM llm_runs ORDER BY created_at DESC").all<{payload:string}>(),
  ]);
  return Response.json({
    evaluator:{id:user.userId,name:user.displayName,email:user.email},
    profiles:profileRows.results.map(r=>JSON.parse(r.payload)),
    reviews:reviewRows.results.map(r=>({evaluatorId:r.evaluator_id,evaluatorName:r.evaluator_name,queryId:r.query_id,candidateId:r.candidate_id,socialIntent:r.intent,updatedAt:r.updated_at,...JSON.parse(r.payload)})),
    llmRuns:llmRows.results.map(r=>JSON.parse(r.payload)),
  });
}

export async function POST(request: Request) {
  if (!await hasMatchLabAccess()) return Response.json({error:"Access password required"},{status:403});
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Sign in required"},{status:401});
  await ensureSchema();
  const body = await request.json() as any;
  const now = Date.now();
  if (body.action === "import" && Array.isArray(body.profiles)) {
    await env.DB.prepare("DELETE FROM profiles").run();
    const statements = body.profiles.map((profile:any)=>env.DB.prepare("INSERT INTO profiles (id,payload,uploaded_by,uploaded_name,updated_at) VALUES (?,?,?,?,?)").bind(profile.id,JSON.stringify(profile),user.userId,user.displayName,now));
    if (statements.length) await env.DB.batch(statements);
    return Response.json({ok:true,count:statements.length});
  }
  if (body.action === "review" && body.review) {
    const r=body.review;
    const payload=JSON.stringify({overall:r.overall,intentScore:r.intent,interaction:r.interaction,context:r.context,mutuality:r.mutuality,reason:r.reason,uncertainty:r.uncertainty});
    await env.DB.prepare("INSERT INTO reviews (evaluator_id,evaluator_name,query_id,candidate_id,intent,payload,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(evaluator_id,query_id,candidate_id,intent) DO UPDATE SET evaluator_name=excluded.evaluator_name,payload=excluded.payload,updated_at=excluded.updated_at")
      .bind(user.userId,user.displayName,r.queryId,r.candidateId,r.socialIntent,payload,now).run();
    return Response.json({ok:true,evaluatorName:user.displayName,updatedAt:now});
  }
  return Response.json({error:"Unsupported action"},{status:400});
}
