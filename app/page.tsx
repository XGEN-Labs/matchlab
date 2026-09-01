"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Profile = {
  id: string; name: string; gender?: string; age: number; city: string; role: string;
  bio: string; tags: string[]; availability: string; interaction: string;
  assertions?: ProfileAssertion[]; intent?: string; domainSummaries?: Record<string,string>; schema?: "matchlab" | "self-layer";
};
type AssertionSource = { path:string; memories:string[] };
type ProfileAssertion = { text:string; sources:AssertionSource[] };

type Review = {
  overall?: number; intent?: number; interaction?: number; context?: number;
  mutuality?: number; reason: string; uncertainty: "low" | "medium" | "high";
};
type Evaluator = { id:string; name:string; email:string };
type TeamReview = Review & { evaluatorId:string; evaluatorName:string; queryId:string; candidateId:string; socialIntent:string; updatedAt:number };
type LLMRow = { rank:number; candidate_id:string; overall_fit:number; intent_fit:number; interaction_compatibility:number; context_fit:number; mutuality:number; reason:string; supporting_evidence:string[]; conflicts:string[]; uncertainty:string };
type LLMRun = { schema_version:string; generated_at:string; judge:string; query_user_id:string; ranking:LLMRow[]; summary:{top_1:string;top_3:string[];top_5:string[];key_pattern:string;largest_false_positive_risk:string;limitations:string[]} };

const seedProfiles: Profile[] = [
  { id:"maya", name:"Maya Chen", age:28, city:"Shanghai", role:"Product designer", bio:"Designing calm digital tools. I like small groups, long walks and conversations that wander into unexpected places.", tags:["urban hiking","indie films","coffee","design"], availability:"Weekend mornings", interaction:"Warm, curious · prefers 1:1" },
  { id:"leo", name:"Leo Wang", age:30, city:"Shanghai", role:"AI researcher", bio:"Trail runner who treats every hill like a personal best. Social, energetic, and always organizing the next challenge.", tags:["trail running","AI","climbing","photography"], availability:"Saturday mornings", interaction:"High-energy · competitive" },
  { id:"nina", name:"Nina Zhou", age:27, city:"Shanghai", role:"Documentary editor", bio:"Weekday editor, weekend explorer. I enjoy easy hikes, unhurried conversation, and finding a good noodle shop afterwards.", tags:["easy hikes","documentaries","food","journaling"], availability:"Weekends flexible", interaction:"Thoughtful · easygoing" },
  { id:"sam", name:"Sam Liu", age:29, city:"Hangzhou", role:"Community builder", bio:"I bring people together around books, food and nature. Happy in groups and usually the one making introductions.", tags:["community","books","camping","cooking"], availability:"Sunday afternoons", interaction:"Inclusive · group-oriented" },
  { id:"iris", name:"Iris Xu", age:26, city:"Shanghai", role:"Brand strategist", bio:"New to hiking but keen to learn. I value honest conversation, gentle pacing and plans that leave room for spontaneity.", tags:["museums","beginner hiking","writing","jazz"], availability:"Saturday all day", interaction:"Open · reflective" },
  { id:"omar", name:"Omar Hassan", age:31, city:"Suzhou", role:"Architect", bio:"Architecture, tea and quiet landscapes. I hike to reset, not to race, and prefer comfortable silence over constant conversation.", tags:["architecture","tea","nature","sketching"], availability:"Twice a month", interaction:"Reserved · comfortable silence" },
];

const intents = [
  "这个周末想找个人轻松爬山，边走边聊，不追求训练强度。",
  "想认识一个能长期交换创意反馈、坦诚但不咄咄逼人的朋友。",
  "想找一位下班后偶尔探索新餐厅的小伙伴，计划不要太重。",
];

const emptyReview = (): Review => ({ reason:"", uncertainty:"medium" });
const dims: Array<[keyof Review, string, string]> = [
  ["intent","意图契合","是否回应这一次的具体需求"],
  ["interaction","互动兼容","相处节奏与沟通方式是否合拍"],
  ["context","情境契合","时间、地点与活动条件是否可行"],
  ["mutuality","双向意愿","对方也可能从这次匹配中获益吗"],
];

function asText(value: unknown, fallback = "—") {
  if (Array.isArray(value)) return value.filter(Boolean).join(" · ") || fallback;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function makeId(name: string, index: number) {
  const safe = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g,"-").replace(/^-|-$/g,"");
  return `${safe || "user"}-${index + 1}`;
}

const userLabel = (index:number) => `U${String(index+1).padStart(2,"0")}`;
const avatarNumber = (name:string) => name.replace(/\D/g,"") || name.slice(-2);
const domainLabels: Record<string,string> = {
  pursuit:"追求与目标", interest:"兴趣", lifestyle:"生活方式", experience:"经历",
  inner:"内在需求", personality:"性格", identity:"身份认同", wellbeing:"身心状态",
  astrology_context:"命理语境", relationship_record:"关系记录",
};

function cleanDomainSummaries(summary:any) {
  const source={...(summary?.Domain_Summaries?.Core_Domains || {}),...(summary?.Domain_Summaries?.Additional_Domains || {})};
  return Object.fromEntries(Object.entries(source).flatMap(([key,value])=>{
    const text=asText(value,"");
    return !text || /^(unknown|未知|不详|未提供|—|null|n\/a)$/i.test(text) ? [] : [[key,text]];
  }));
}

function readPath(root:any,path:string) {
  return path.split(".").reduce((value,key)=>value?.[key],root);
}

function memoryContents(node:any):string[] {
  if (!node || typeof node!=="object") return [];
  if (Array.isArray(node)) return node.flatMap(memoryContents);
  if (typeof node.content==="string" && node.content.trim() && !/^(unknown|未知|暂无|未提供)/i.test(node.content.trim()) && node.status!=="unknown") return [node.content.trim()];
  return Object.values(node).flatMap(memoryContents);
}

const relevanceTerms=["朋友","搭子","社交","活动","线下","周末","时间","城市","本地","展览","音乐","演出","livehouse","摄影","散步","citywalk","徒步","运动","旅行","游戏","读书","电影","咖啡","吃饭","沟通","聊天","倾听","分享","情绪","支持","陪伴","轻松","节奏","边界","恋爱","约会","职业","求职","创业","学习","创意","反馈","合作","成长","生活"];
function relevantAssertions(assertions:Array<ProfileAssertion|string>,intent:string) {
  const lowerIntent=intent.toLowerCase();
  const activeTerms=relevanceTerms.filter(term=>lowerIntent.includes(term));
  const normalized=assertions.map(item=>typeof item==="string"?{text:item,sources:[]}:({...item,sources:Array.isArray(item?.sources)?item.sources:[]}));
  const ranked=normalized.map((item,index)=>{
    const haystack=`${item.text} ${item.sources.map(s=>s.path).join(" ")}`.toLowerCase();
    const termScore=activeTerms.reduce((score,term)=>score+(haystack.includes(term)?3:0),0);
    const socialSource=item.sources.some(s=>/(interest|lifestyle|personality|identity|relationship|wellbeing)/i.test(s.path))?1:0;
    const intentChars=new Set(lowerIntent.replace(/[\s，。、“”！？；：,.!?;:]/g,"").split(""));
    const charScore=[...new Set(item.text.replace(/[\s，。、“”！？；：,.!?;:]/g,"").split(""))].filter(c=>intentChars.has(c)).length/12;
    return {item,index,score:termScore+socialSource+charScore};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
  const relevant=ranked.filter(x=>x.score>=2).slice(0,5);
  return (relevant.length>=3?relevant:ranked.slice(0,Math.min(3,ranked.length))).map(x=>x.item);
}

function collectProfiles(node: any, path: string[] = []): any[] {
  if (!node || typeof node !== "object") return [];
  if (node["06_User_Summary"] || node["00_Core_Profile"] || node["05_Matching_Profile"]) {
    return [{...node, __sourceId:path.join("-") || undefined}];
  }
  if (Array.isArray(node)) return node.flatMap((item,index)=>collectProfiles(item,[...path,String(index+1)]));
  return Object.entries(node).flatMap(([key,value])=>key.startsWith("_") ? [] : collectProfiles(value,[...path,key]));
}

function extractProfile(raw: any, index: number): Profile {
  const summary = raw?.["06_User_Summary"] || raw?.user_summary;
  const core = raw?.["00_Core_Profile"] || {};
  const matching = raw?.["05_Matching_Profile"] || {};
  if (summary || core?.identity || matching?.Social_Intent) {
    const domains = summary?.Domain_Summaries?.Core_Domains || {};
    const domainSummaries = cleanDomainSummaries(summary);
    const currentIntent = summary?.Current_Social_Intent?.intent;
    const assertions:ProfileAssertion[] = Array.isArray(summary?.Profile_Assertions) ? summary.Profile_Assertions.map((x:any)=>({
      text:asText(x?.assertion,""),
      sources:(Array.isArray(x?.source_fields)?x.source_fields:[]).map((path:any)=>({path:String(path),memories:memoryContents(readPath(raw,String(path))).slice(0,5)})),
    })).filter((x:ProfileAssertion)=>Boolean(x.text)) : [];
    const name = asText(core?.identity?.nickname || summary?.identity?.nickname || raw?.__sourceId, `User ${index+1}`);
    const birth = core?.identity?.birth?.date;
    const age = birth ? Math.max(0, new Date().getFullYear() - new Date(birth).getFullYear()) : Number(raw?.age || 0);
    const interestItems = raw?.["01_Self_Memory"]?.interest?.爱好;
    const rawTags = Array.isArray(interestItems) ? interestItems.map((x:any)=>x?.content).filter(Boolean) : [];
    const tags = matching?.Social_Intent?.shared_context || rawTags;
    const style = matching?.Social_Style || {};
    const styleParts = [style.warm_up_style, ...(style.conversation_style || []), ...(style.setting_preference || [])].filter(Boolean);
    const pursuit = domains.pursuit || raw?.["01_Self_Memory"]?.pursuit?.正在做的?.[0]?.content;
    const role = raw?.["01_Self_Memory"]?.pursuit?.正在做的?.[0]?.role || pursuit || "Profile participant";
    const bioParts = [domains.personality, domains.interest].filter(Boolean);
    return { id:String(raw?.id || raw?.__sourceId || makeId(name,index)), name, gender:asText(core?.identity?.gender,"未提供"), age, city:asText(core?.residence?.city || domains.identity), role:asText(role),
      bio:bioParts.join(" ") || assertions.slice(0,2).map(x=>x.text).join(" ") || "暂无公开简介", tags:Array.isArray(tags)?tags.slice(0,8).map(String):[],
      availability:asText(domains.lifestyle || matching?.Social_Status?.social_availability,"未说明"), interaction:asText(styleParts,"未说明"),
      assertions, intent:currentIntent || matching?.Social_Intent?.current_motivation?.content, domainSummaries, schema:"self-layer" };
  }
  return { id:String(raw.id || makeId(String(raw.name || `User ${index+1}`),index)), name:String(raw.name || `User ${index+1}`), gender:String(raw.gender || "未提供"), age:Number(raw.age || 0),
    city:String(raw.city || "—"), role:String(raw.role || raw.occupation || "—"), bio:String(raw.bio || raw.about || ""),
    tags:Array.isArray(raw.tags)?raw.tags:[], availability:String(raw.availability || "Not specified"), interaction:String(raw.interaction || "Not specified"),
    assertions:Array.isArray(raw.assertions)?raw.assertions.map((x:any)=>typeof x==="string"?{text:x,sources:[]}:x):[], intent:raw.intent, domainSummaries:raw.domainSummaries, schema:"matchlab" };
}

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>(seedProfiles);
  const [queryId, setQueryId] = useState("maya");
  const [intent, setIntent] = useState(intents[0]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [showDims, setShowDims] = useState(true);
  const [view, setView] = useState<"review"|"results">("review");
  const [inspectedSource, setInspectedSource] = useState("mine");
  const [toast, setToast] = useState("");
  const [evaluator, setEvaluator] = useState<Evaluator|null>(null);
  const [teamReviews, setTeamReviews] = useState<TeamReview[]>([]);
  const [llmRuns, setLlmRuns] = useState<LLMRun[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [access, setAccess] = useState<boolean|null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const queryProfile = profiles.find(p => p.id === queryId) || profiles[0];
  const candidates = useMemo(() => profiles.filter(p => p.id !== queryId), [profiles, queryId]);
  const candidate = candidates[Math.min(candidateIndex, Math.max(0,candidates.length-1))];
  const key = `${queryId}:${candidate?.id || "none"}:${intent}`;
  const review = reviews[key] || emptyReview();
  const completed = candidates.filter(c => reviews[`${queryId}:${c.id}:${intent}`]?.overall !== undefined).length;
  const avg = completed ? candidates.reduce((s,c)=>s+(reviews[`${queryId}:${c.id}:${intent}`]?.overall ?? 0),0)/completed : 0;
  const llmCandidateScore=llmRuns.find(run=>run.query_user_id===queryProfile?.name)?.ranking.find(row=>row.candidate_id===candidate?.name);
  const inspectedTeamScore=inspectedSource.startsWith("person:")?teamReviews.find(r=>r.evaluatorId===inspectedSource.replace("person:","")&&r.queryId===queryId&&r.candidateId===candidate?.id):undefined;
  const inspectedReview:Review|undefined=inspectedSource==="llm"&&llmCandidateScore?{overall:llmCandidateScore.overall_fit,intent:llmCandidateScore.intent_fit,interaction:llmCandidateScore.interaction_compatibility,context:llmCandidateScore.context_fit,mutuality:llmCandidateScore.mutuality,reason:llmCandidateScore.reason,uncertainty:llmCandidateScore.uncertainty as Review["uncertainty"]}:inspectedSource.startsWith("person:")&&inspectedTeamScore?{overall:inspectedTeamScore.overall,intent:(inspectedTeamScore as any).intentScore??inspectedTeamScore.intent,interaction:inspectedTeamScore.interaction,context:inspectedTeamScore.context,mutuality:inspectedTeamScore.mutuality,reason:inspectedTeamScore.reason,uncertainty:inspectedTeamScore.uncertainty}:undefined;
  const inspectedLabel=inspectedSource==="llm"?"LLM 评分":inspectedSource.startsWith("person:")?(inspectedTeamScore?.evaluatorName||"其他评审者"):"我的评分";
  const participantScores=(()=>{const result:Array<{id:string;label:string;kind:string;review:Review}>=[];if(review.overall!==undefined)result.push({id:"mine",label:"我的评分",kind:"人工",review});if(llmCandidateScore)result.push({id:"llm",label:"LLM 评分",kind:"模型",review:{overall:llmCandidateScore.overall_fit,intent:llmCandidateScore.intent_fit,interaction:llmCandidateScore.interaction_compatibility,context:llmCandidateScore.context_fit,mutuality:llmCandidateScore.mutuality,reason:llmCandidateScore.reason,uncertainty:llmCandidateScore.uncertainty as Review["uncertainty"]}});const seen=new Set<string>();for(const item of teamReviews.filter(r=>r.queryId===queryId&&r.candidateId===candidate?.id&&r.evaluatorId!==evaluator?.id)){if(seen.has(item.evaluatorId))continue;seen.add(item.evaluatorId);result.push({id:item.evaluatorId,label:item.evaluatorName,kind:"人工",review:{overall:item.overall,intent:(item as any).intentScore??item.intent,interaction:item.interaction,context:item.context,mutuality:item.mutuality,reason:item.reason||"",uncertainty:item.uncertainty||"medium"}})}return result})();

  useEffect(() => {
    fetch("/api/state").then(r=>{if(r.status===403){setAccess(false);throw new Error("access")};if(r.status===401){window.location.href="/signin-with-chatgpt?return_to=%2F";throw new Error("signin")};return r.ok?r.json():Promise.reject()}).then(data=>{
      setAccess(true);
      setEvaluator(data.evaluator); setTeamReviews(data.reviews || []); setLlmRuns(data.llmRuns || []);
      if(data.profiles?.length){
        const sharedProfiles=data.profiles.map((p:Profile,i:number)=>({...p,name:userLabel(i)}));
        setProfiles(sharedProfiles); setQueryId(sharedProfiles[0].id); setIntent(sharedProfiles[0].intent || "该用户没有提供 Current_Social_Intent");
      }
      const mine:Record<string,Review>={};
      for(const r of data.reviews || []) if(r.evaluatorId===data.evaluator.id) mine[`${r.queryId}:${r.candidateId}:${r.socialIntent}`]={overall:r.overall,intent:r.intentScore,interaction:r.interaction,context:r.context,mutuality:r.mutuality,reason:r.reason||"",uncertainty:r.uncertainty||"medium"};
      setReviews(mine);
    }).catch(e=>{if(!["access","signin"].includes(e?.message))notify("无法连接共享评审数据")}).finally(()=>setSyncing(false));
  }, []);

  const update = (patch: Partial<Review>) => {
    const merged={...review,...patch};
    setReviews(r => ({...r, [key]:merged}));
    fetch("/api/state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"review",review:{...merged,queryId,candidateId:candidate.id,socialIntent:intent}})})
      .then(r=>r.ok?r.json():Promise.reject()).then(result=>{
        if(!evaluator)return;
        const saved:TeamReview={...merged,evaluatorId:evaluator.id,evaluatorName:result.evaluatorName,queryId,candidateId:candidate.id,socialIntent:intent,updatedAt:result.updatedAt};
        setTeamReviews(xs=>[saved,...xs.filter(x=>!(x.evaluatorId===saved.evaluatorId&&x.queryId===queryId&&x.candidateId===candidate.id&&x.socialIntent===intent))]);
      }).catch(()=>notify("评分同步失败，请重试"));
  };
  const notify = (text:string) => { setToast(text); window.setTimeout(()=>setToast(""),1800); };
  const changeQuery = (id:string) => { setQueryId(id); setCandidateIndex(0); setInspectedSource("mine"); };

  async function importJson(files?: FileList | null) {
    if(!files?.length) return;
    try {
      const parsed = await Promise.all(Array.from(files).map(async f=>JSON.parse(await f.text())));
      const rawList = parsed.flatMap(data => Array.isArray(data?.profiles) ? data.profiles : collectProfiles(data));
      const list = rawList.map(extractProfile).map((p,i)=>({...p,name:userLabel(i)}));
      if(!list.length) throw new Error();
      setProfiles(list); setQueryId(list[0].id); setIntent(list[0].intent || "该用户没有提供 Current_Social_Intent"); setCandidateIndex(0);
      const response=await fetch("/api/state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"import",profiles:list})});
      if(!response.ok) throw new Error();
      notify(`已共享 ${list.length} 个 profiles${list.some(p=>p.schema==="self-layer")?" · Self Layer schema":""}`);
    } catch { notify("无法识别文件，请检查 JSON 格式"); }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault(); setPasswordError("");
    const response=await fetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});
    if(!response.ok){setPasswordError("密码不正确，请重试");return}
    setAccess(true); window.location.reload();
  }

  if (access === null) return <main className="access-page"><div className="access-card"><span className="mark">M</span><p>正在连接 MatchLab…</p></div></main>;
  if (access === false) return <main className="access-page"><form className="access-card" onSubmit={unlock}><span className="mark">M</span><div className="step-label">PRIVATE EVALUATION WORKSPACE</div><h1>进入 MatchLab</h1><p>请输入团队使用密码，验证后可查看共享 profiles 和评分。</p><label>使用密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus placeholder="Enter password"/></label>{passwordError&&<em>{passwordError}</em>}<button className="dark" type="submit">进入评审台 →</button></form></main>;

  if (!candidate) return <main className="empty"><h1>需要至少 2 个 profiles</h1><p>可以一次选择多份完整 Self Layer JSON</p><button onClick={()=>fileRef.current?.click()}>导入 JSON</button><input ref={fileRef} type="file" hidden multiple accept=".json" onChange={e=>importJson(e.target.files)}/></main>;

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="mark">M</span><span>MatchLab</span><span className="badge">EVALUATION MVP</span></div>
        <div className="header-actions">
          <span className="saved"><i/> {syncing?"正在连接共享数据":evaluator?`${evaluator.name} · 自动同步`:"未登录"}</span>
          <button className="ghost" onClick={()=>fileRef.current?.click()}>↥ 导入 profiles</button>
          <input ref={fileRef} type="file" hidden multiple accept=".json,application/json" onChange={e=>importJson(e.target.files)}/>
          <button className="dark" onClick={()=>setView(view==="review"?"results":"review")}>{view==="review"?"查看结果 →":"← 返回评审"}</button>
        </div>
      </header>

      {view === "results" ? <Results candidates={candidates} reviews={reviews} teamReviews={teamReviews} queryId={queryId} queryName={queryProfile.name} intent={intent} evaluator={evaluator} llmRuns={llmRuns} onOpenCandidate={id=>{const index=candidates.findIndex(c=>c.id===id);if(index>=0){setCandidateIndex(index);setInspectedSource("all");setView("review")}}} /> : <>
        <section className="scenario">
          <div className="step-label">01 · SET THE SCENARIO</div>
          <div className="scenario-grid">
            <label><span>Query user</span><select value={queryId} onChange={e=>{changeQuery(e.target.value);const p=profiles.find(x=>x.id===e.target.value);setIntent(p?.intent || "该用户没有提供 Current_Social_Intent")}}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select></label>
          </div>
        </section>

        <div className="workspace">
          <aside className="queue">
            <div className="step-label">02 · REVIEW CANDIDATES</div>
            <div className="progress-row"><span>{completed} of {candidates.length} complete</span><strong>{Math.round(completed/candidates.length*100)}%</strong></div>
            <div className="progress"><i style={{width:`${completed/candidates.length*100}%`}}/></div>
            <div className="candidate-list">{candidates.map((c,i)=>{
              const score=reviews[`${queryId}:${c.id}:${intent}`]?.overall;
              return <button key={c.id} className={i===candidateIndex?"active":""} onClick={()=>{setCandidateIndex(i);setInspectedSource("mine")}}><span className="avatar">{avatarNumber(c.name)}</span><span><b>{c.name}</b><small>{c.role}</small></span>{score===undefined?<em>—</em>:<em className="score">{score}</em>}</button>
            })}</div>
          </aside>

          <section className="profile-panel compare-panel">
            <div className="compare-title"><span>QUERY USER</span><i>判断两个人在当前 intent 下是否合适</i><span>CANDIDATE {candidateIndex+1}/{candidates.length}</span></div>
            <div className="compare-profiles">
              <PersonCard profile={queryProfile} side="query" relevanceIntent={intent} />
              <PersonCard profile={candidate} side="candidate" relevanceIntent={intent} />
            </div>
          </section>

          <aside className="rating-panel">
            <div className="step-label">03 · SCORE THE FIT</div>
            {inspectedSource==="all" ? <div className="all-reviews"><div className="review-source"><span>候选人详情</span><b>所有参与评分</b><em>只读</em></div><p className="helper">共 {participantScores.length} 个评分来源</p>{participantScores.length?participantScores.map(item=><details key={item.id} open><summary><span>{item.kind}</span><b>{item.label}</b><strong>{item.review.overall ?? "—"}/3</strong></summary><div className="participant-detail"><div className="readonly-dims">{[["Intent",item.review.intent],["Interaction",item.review.interaction],["Context",item.review.context],["Mutuality",item.review.mutuality]].map(([label,value])=><div key={String(label)}><span>{label}</span><b>{value ?? "—"}</b></div>)}</div><div className="readonly-reason"><span>评分理由</span><p>{item.review.reason||"未填写理由"}</p></div><div className="readonly-uncertainty"><span>不确定性</span><b>{item.review.uncertainty}</b></div></div></details>):<p className="no-scores">还没有人评价该候选人</p>}<button className="dark switch-mine" onClick={()=>setInspectedSource("mine")}>← 回到评审并编辑我的评分</button></div> : inspectedSource!=="mine" ? <div className="readonly-review"><div className="review-source"><span>正在查看</span><b>{inspectedLabel}</b><em>只读</em></div>{inspectedReview?<><div className="readonly-overall"><span>Overall Fit</span><strong>{inspectedReview.overall ?? "—"}<small>/ 3</small></strong></div><div className="readonly-dims">{[["Intent Fit",inspectedReview.intent],["Interaction",inspectedReview.interaction],["Context",inspectedReview.context],["Mutuality",inspectedReview.mutuality]].map(([label,value])=><div key={String(label)}><span>{label}</span><b>{value ?? "—"}</b></div>)}</div><div className="readonly-reason"><span>评分理由</span><p>{inspectedReview.reason||"未填写理由"}</p></div><div className="readonly-uncertainty"><span>不确定性</span><b>{inspectedReview.uncertainty}</b></div></>:<p className="no-scores">这个评分来源还没有评价该候选人</p>}<button className="dark switch-mine" onClick={()=>setInspectedSource("mine")}>← 回到评审并编辑我的评分</button></div> : <>
            <h2>Overall fit</h2><p className="helper">这位候选人对当前需求的整体适配度？</p>
            <div className="scale">{[0,1,2,3].map(n=><button key={n} className={review.overall===n?"selected":""} onClick={()=>update({overall:n})}><b>{n}</b><span>{["不合适","偏弱","不错","很匹配"][n]}</span></button>)}</div>
            <button className="dimensions-toggle" onClick={()=>setShowDims(!showDims)}><span>子维度评分 <small>可选</small></span><b>{showDims?"−":"+"}</b></button>
            {showDims && <div className="dimensions">{dims.map(([field,label,hint])=><div className="dimension" key={field}><label>{label}<small>{hint}</small></label><div>{[0,1,2,3].map(n=><button key={n} className={review[field]===n?"selected":""} onClick={()=>update({[field]:n})}>{n}</button>)}</div></div>)}</div>}
            <label className="reason"><span>为什么？ <small>建议填写</small></span><textarea placeholder="写下支持判断的关键信号或矛盾点…" value={review.reason} onChange={e=>update({reason:e.target.value})}/><em>{review.reason.length}/280</em></label>
            <div className="uncertainty"><span>判断不确定性</span><div>{(["low","medium","high"] as const).map((u,i)=><button key={u} className={review.uncertainty===u?"selected":""} onClick={()=>update({uncertainty:u})}>{["低","中","高"][i]}</button>)}</div></div>
            <button className="next" disabled={review.overall===undefined} onClick={()=>{if(candidateIndex<candidates.length-1)setCandidateIndex(candidateIndex+1);else{notify("本轮评审已完成");setView("results")}}}>{candidateIndex<candidates.length-1?"保存并看下一个 →":"完成评审 →"}</button>
            </>}
          </aside>
        </div>
      </>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function PersonCard({profile,side,relevanceIntent}:{profile:Profile;side:"query"|"candidate";relevanceIntent:string}) {
  const genderLabel = profile.gender==="female"?"女":profile.gender==="male"?"男":profile.gender || "未提供";
  const domainEntries=Object.entries(profile.domainSummaries || {});
  const domainOverview=profile.bio || domainEntries.slice(0,2).map(([,value])=>value).join(" ");
  const assertions=relevantAssertions(profile.assertions || [],relevanceIntent);
  return <article className={`person-card ${side}`}>
    <div className="person-label">{side==="query"?"需求发起者":"候选对象"}</div>
    <div className="profile-head"><span className="avatar large">{avatarNumber(profile.name)}</span><div><h1>{profile.name}</h1><p>{side==="query"?"Query User":"Candidate"}</p></div></div>
    <div className="basic-info"><div><span>性别</span><b>{genderLabel}</b></div><div><span>年龄</span><b>{profile.age?`${profile.age} 岁`:"未提供"}</b></div><div><span>职业</span><b>{profile.role&&profile.role!=="—"?profile.role:"未提供"}</b></div></div>
    <div className="profile-intent"><span>{side==="query"?"QUERY SOCIAL INTENT":"CANDIDATE SOCIAL INTENT"}</span><p>“{profile.intent || (side==="query"?"该用户没有提供 Current_Social_Intent":"该候选对象没有提供 Current_Social_Intent")}”</p></div>
    {!!assertions.length && <div className="assertions"><span>与当前 SOCIAL INTENT 相关的推论 <small>{assertions.length} 条</small></span>{assertions.map((a,i)=><details key={`${a.text}-${i}`}><summary><i>✓</i><span>{a.text}</span>{a.sources.length>0&&<sup title="查看原始记忆">{a.sources.length}</sup>}</summary>{a.sources.length>0&&<div className="evidence">{a.sources.map(source=><section key={source.path}><b>{source.path}</b>{source.memories.length?source.memories.map((memory,j)=><p key={j}>“{memory}”</p>):<p>此来源没有可展示的原始记忆内容</p>}</section>)}</div>}</details>)}</div>}
    {domainEntries.length ? <div className="domain-group"><div className="domain-overview"><span>整体画像摘要</span><p>“{domainOverview}”</p></div><details className="domain-summaries"><summary><span>DOMAIN SUMMARIES</span><b>查看 {domainEntries.length} 个领域细节</b><i>＋</i></summary><div>{domainEntries.map(([key,value])=><section key={key}><b>{domainLabels[key] || key.replaceAll("_"," ")}</b><p>{value}</p></section>)}</div></details></div> : <div className="about"><span>PROFILE SUMMARY</span><p>“{profile.bio}”</p></div>}
    {!domainEntries.length && <><div className="mini-fact"><span>互动方式</span><b>{profile.interaction}</b></div><div className="mini-fact"><span>生活与可参与性</span><b>{profile.availability}</b></div><div className="interests"><span>兴趣与共同语境</span><div>{profile.tags.slice(0,6).map(t=><em key={t}>{t}</em>)}</div></div></>}
  </article>
}

function Results({candidates,reviews,teamReviews,queryId,queryName,intent,evaluator,llmRuns,onOpenCandidate}:{candidates:Profile[];reviews:Record<string,Review>;teamReviews:TeamReview[];queryId:string;queryName:string;intent:string;evaluator:Evaluator|null;llmRuns:LLMRun[];onOpenCandidate:(id:string)=>void}) {
  const llmRun=llmRuns.find(run=>run.query_user_id===queryName);
  const evaluatorOptions=Array.from(new Map(teamReviews.filter(r=>r.queryId===queryId).map(r=>[r.evaluatorId,{id:r.evaluatorId,name:r.evaluatorName}])).values());
  const sources=[{id:"mine",name:"我的评分",kind:"human"},{id:"llm",name:"LLM 评分",kind:"llm"},...evaluatorOptions.filter(x=>x.id!==evaluator?.id).map(x=>({id:`person:${x.id}`,name:x.name,kind:"human"}))];
  const preferred=["mine",...(llmRun?["llm"]:[]),...sources.filter(s=>s.name.toLowerCase().includes("yancey")).map(s=>s.id)].slice(0,4);
  const [selected,setSelected]=useState<string[]>(preferred.length?preferred:["mine"]);
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):current.length<4?[...current,id]:current);
  const humanRows=(evaluatorId?:string)=>candidates.map(c=>{
    const review=evaluatorId?teamReviews.find(r=>r.evaluatorId===evaluatorId&&r.queryId===queryId&&r.candidateId===c.id):reviews[`${queryId}:${c.id}:${intent}`];
    return {candidate:c,score:review?.overall,reason:review?.reason||"未填写理由",review};
  }).filter(x=>x.score!==undefined).sort((a,b)=>(b.score||0)-(a.score||0));
  const panelData=(sourceId:string)=>sourceId==="llm"?(llmRun?.ranking.map(item=>({candidate:candidates.find(c=>c.name===item.candidate_id),score:item.overall_fit,reason:item.reason,llm:item}))||[]):humanRows(sourceId==="mine"?undefined:sourceId.replace("person:",""));
  const exportSelected=()=>{const payload={schemaVersion:"matchlab-parallel-evaluation-v1",exportedAt:new Date().toISOString(),queryUserId:queryId,currentSocialIntent:intent,selectedSources:selected.map(id=>({source:sources.find(s=>s.id===id)?.name,results:panelData(id)}))};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`matchlab-${queryName}-parallel-results.json`;a.click();URL.revokeObjectURL(url)};
  return <section className="results-page parallel-page">
    <div className="results-title"><div><div className="step-label">PARALLEL EVALUATION</div><h1>多评审结果对比</h1><p>选择最多 4 个评分来源并排查看 · 点击候选人进入 Profile</p></div><button className="dark export-top" onClick={exportSelected}>导出当前对比 JSON ↓</button></div>
    <div className="source-picker">{sources.map(source=><label key={source.id} className={selected.includes(source.id)?"checked":""}><input type="checkbox" checked={selected.includes(source.id)} disabled={!selected.includes(source.id)&&selected.length>=4} onChange={()=>toggle(source.id)}/><span>{source.name}</span><small>{selected.includes(source.id)?"已显示":selected.length>=4?"最多 4 个":"点击添加"}</small></label>)}</div>
    <div className="parallel-windows" style={{gridTemplateColumns:`repeat(${Math.max(1,selected.length)},minmax(280px,1fr))`}}>{selected.map(sourceId=>{const source=sources.find(s=>s.id===sourceId);const data=panelData(sourceId);return <article className="score-window" key={sourceId}><header><div><span>{source?.kind==="llm"?"MODEL JUDGE":"HUMAN JUDGE"}</span><h2>{source?.name}</h2></div><strong>{data.length} 条</strong></header><div className="score-window-list">{data.length?data.map((row:any,index)=><button key={row.candidate?.id||row.llm?.candidate_id||index} onClick={()=>row.candidate&&onOpenCandidate(row.candidate.id)}><b>#{index+1}</b><span className="avatar">{avatarNumber(row.candidate?.name||row.llm?.candidate_id||"")}</span><div><strong>{row.candidate?.name||row.llm?.candidate_id}</strong><small>{row.reason}</small></div><em>{row.score}/3</em></button>):<p className="no-scores">当前场景还没有评分</p>}</div></article>})}</div>
  </section>
}
