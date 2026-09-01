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
  const [toast, setToast] = useState("");
  const [evaluator, setEvaluator] = useState<Evaluator|null>(null);
  const [teamReviews, setTeamReviews] = useState<TeamReview[]>([]);
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

  useEffect(() => {
    fetch("/api/state").then(r=>{if(r.status===403){setAccess(false);throw new Error("access")};if(r.status===401){window.location.href="/signin-with-chatgpt?return_to=%2F";throw new Error("signin")};return r.ok?r.json():Promise.reject()}).then(data=>{
      setAccess(true);
      setEvaluator(data.evaluator); setTeamReviews(data.reviews || []);
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
  const changeQuery = (id:string) => { setQueryId(id); setCandidateIndex(0); };

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

      {view === "results" ? <Results candidates={candidates} reviews={reviews} teamReviews={teamReviews} queryId={queryId} intent={intent} evaluator={evaluator} /> : <>
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
              return <button key={c.id} className={i===candidateIndex?"active":""} onClick={()=>setCandidateIndex(i)}><span className="avatar">{avatarNumber(c.name)}</span><span><b>{c.name}</b><small>{c.role}</small></span>{score===undefined?<em>—</em>:<em className="score">{score}</em>}</button>
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
            <h2>Overall fit</h2><p className="helper">这位候选人对当前需求的整体适配度？</p>
            <div className="scale">{[0,1,2,3].map(n=><button key={n} className={review.overall===n?"selected":""} onClick={()=>update({overall:n})}><b>{n}</b><span>{["不合适","偏弱","不错","很匹配"][n]}</span></button>)}</div>
            <button className="dimensions-toggle" onClick={()=>setShowDims(!showDims)}><span>子维度评分 <small>可选</small></span><b>{showDims?"−":"+"}</b></button>
            {showDims && <div className="dimensions">{dims.map(([field,label,hint])=><div className="dimension" key={field}><label>{label}<small>{hint}</small></label><div>{[0,1,2,3].map(n=><button key={n} className={review[field]===n?"selected":""} onClick={()=>update({[field]:n})}>{n}</button>)}</div></div>)}</div>}
            <label className="reason"><span>为什么？ <small>建议填写</small></span><textarea placeholder="写下支持判断的关键信号或矛盾点…" value={review.reason} onChange={e=>update({reason:e.target.value})}/><em>{review.reason.length}/280</em></label>
            <div className="uncertainty"><span>判断不确定性</span><div>{(["low","medium","high"] as const).map((u,i)=><button key={u} className={review.uncertainty===u?"selected":""} onClick={()=>update({uncertainty:u})}>{["低","中","高"][i]}</button>)}</div></div>
            <button className="next" disabled={review.overall===undefined} onClick={()=>{if(candidateIndex<candidates.length-1)setCandidateIndex(candidateIndex+1);else{notify("本轮评审已完成");setView("results")}}}>{candidateIndex<candidates.length-1?"保存并看下一个 →":"完成评审 →"}</button>
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

function Results({candidates,reviews,teamReviews,queryId,intent,evaluator}:{candidates:Profile[];reviews:Record<string,Review>;teamReviews:TeamReview[];queryId:string;intent:string;evaluator:Evaluator|null}) {
  const rows=candidates.map(c=>({c,r:reviews[`${queryId}:${c.id}:${intent}`]})).filter(x=>x.r?.overall!==undefined).sort((a,b)=>(b.r.overall||0)-(a.r.overall||0));
  const average=rows.length?rows.reduce((sum,row)=>sum+(row.r.overall||0),0)/rows.length:0;
  const evaluatorCount = new Set(teamReviews.map(r=>r.evaluatorId)).size;
  return <section className="results-page"><div className="results-title"><div><div className="step-label">MY EVALUATION SUMMARY</div><h1>我的人工匹配评分</h1><p>当前场景已完成 {rows.length}/{candidates.length} 位候选人</p></div><div className="winner">平均 Overall Fit<strong>{average.toFixed(1)} / 3</strong></div></div>
    <div className="results-grid"><article className="ranking"><div className="table-head"><b>我的人工排序</b><span>OVERALL FIT</span></div>{rows.map((x,i)=><div className="result-row manual" key={x.c.id}><strong>{i+1}</strong><span className="avatar">{avatarNumber(x.c.name)}</span><div><b>{x.c.name}</b><small>{x.r.reason||"未填写理由"}</small></div><span className="dots">{[0,1,2,3].map(n=><i key={n} className={(x.r.overall||0)>=n&&n>0?"on":""}/>)}</span><strong className="num">{x.r.overall}</strong></div>)}</article><article className="readout"><span>MY EXPORT</span><h3>导出我的人工判断</h3><p>JSON 只包含你在当前 Query 和 Social Intent 下提交的评分、理由和不确定性。</p><ul><li>Overall Fit 0–3</li><li>四个可选子维度</li><li>评分理由与不确定性</li></ul><button onClick={()=>{const payload={schemaVersion:"matchlab-human-evaluation-v2",exportedAt:new Date().toISOString(),evaluator:evaluator?{id:evaluator.id,name:evaluator.name,email:evaluator.email}:null,queryUserId:queryId,currentSocialIntent:intent,evaluations:rows.map(({c,r},rank)=>({rank:rank+1,candidateId:c.id,candidateName:c.name,overallFit:r.overall,intentFit:r.intent??null,interactionCompatibility:r.interaction??null,contextFit:r.context??null,mutuality:r.mutuality??null,reason:r.reason,uncertainty:r.uncertainty}))};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`matchlab-${queryId}-my-evaluation.json`;a.click();URL.revokeObjectURL(url)}}>导出我的评分 JSON ↓</button></article></div>
    <article className="team-log"><div className="table-head"><b>团队评分记录</b><span>{evaluatorCount} 位评审者</span></div>{teamReviews.filter(r=>r.queryId===queryId&&r.socialIntent===intent).slice(0,30).map((r,i)=>{const c=candidates.find(x=>x.id===r.candidateId);return <div className="team-row" key={`${r.evaluatorId}-${r.candidateId}-${i}`}><span className="reviewer">{r.evaluatorName.slice(0,1)}</span><div><b>{r.evaluatorName}</b><small>评价 {c?.name||r.candidateId}</small></div><strong>{r.overall ?? "—"}/3</strong><p>{r.reason||"未填写理由"}</p><time>{new Date(r.updatedAt).toLocaleString("zh-CN")}</time></div>})}</article>
  </section>
}
