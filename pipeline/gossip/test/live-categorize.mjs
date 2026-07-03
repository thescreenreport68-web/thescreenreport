// Live check of the LLM categorizer: in-scope gossip kept, out-of-scope dropped, fields extracted.
import { categorizeGossip } from "../categorize.mjs";
const cands = [
  { outlet: "People", url: "https://people.com/x", title: "Ava Stone and Liam Carter spotted on cozy dinner date", summary: "The two Hollywood actors were seen together at a restaurant, fueling romance rumors." },
  { outlet: "Politico", url: "https://politico.com/y", title: "Senator proposes new infrastructure bill", summary: "A politics story." },
  { outlet: "Page Six", url: "https://pagesix.com/z", title: "Pop singer Mara Vey sparks romance rumors with her producer", summary: "Western pop musician gossip." },
];
const topics = await categorizeGossip(cands);
console.log(`in-scope topics: ${topics.length} (expected 2 — the 2 celebs, not the politician)`);
for (const t of topics) console.log(` - ${t.primaryEntity} [${t.subjectType}] :: "${t.claim}"  (src ${t.sources[0].outlet}/${t.sources[0].tier})`);
