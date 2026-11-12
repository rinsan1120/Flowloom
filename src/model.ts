import { z } from 'zod';
import dagre from '@dagrejs/dagre';

export const MAX_BYTES = 5 * 1024 * 1024;
const text = z.string().max(10000);
const id = z.string().min(1).max(300).refine(v => !['__proto__', 'constructor', 'prototype'].includes(v), '予約済みIDです');
const details = { description: text.optional(), sourceDetails: z.record(z.string(), z.unknown()).optional() };
const screen = z.object({ id, name: text.min(1), kind: z.enum(['screen', 'dialog', 'unknown']), kindInferred: z.boolean().optional(), actions: z.array(text).max(200).optional(), ...details }).passthrough();
const transition = z.object({ id, from: id, to: id, action: text, condition: text.optional(), note: text.optional(), ...details }).passthrough();
const step = z.object({ id, name: text.min(1), condition: text.optional(), ...details }).passthrough();
const link = z.object({ id, from: id, to: id, condition: text.optional(), note: text.optional(), ...details }).passthrough();
const flow = z.object({ id, name: text.min(1), actor: text.optional(), steps: z.array(step).max(500), links: z.array(link).max(2000).optional(), ...details }).passthrough();
const point = z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000) });
const positions = z.record(id, point);
const schema = z.object({ schemaVersion: z.literal('1.0'), title: text.min(1), screens: z.array(screen).max(500), transitions: z.array(transition).max(2000), flows: z.array(flow).max(100), layout: z.object({ screens: positions, flows: z.record(id, positions) }), importWarnings: z.array(text).max(100).optional() }).passthrough();
export type Blueprint = z.infer<typeof schema>;
export type Point = z.infer<typeof point>;
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('オブジェクト形式が必要です'); return v as Obj; };
const str = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
const arr = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('配列形式が必要です'); return v; };
const unique = (items: {id: string}[], label: string) => { if (new Set(items.map(v => v.id)).size !== items.length) throw new Error(`${label}のIDが重複しています`); };
// Full encoded semantic keys avoid hash collisions. Occurrences preserve identical parallel edges.
const key = (parts: unknown[]) => encodeURIComponent(JSON.stringify(parts));
export function convertDomain(raw: Obj): unknown {
  const warnings = ['domain-blueprintから変換しました。画面種別は名称・IDからの推定（または不明）です。', '遷移・工程の不足IDは内容から生成しました。操作名・条件・工程名の変更や同名工程の順序変更では配置を引き継げない場合があります。Flowloom形式を以後の更新に使用してください。'];
  const omitted = Object.keys(raw).filter(k => !['title', 'screens', 'navigation', 'flows'].includes(k));
  if (omitted.length) warnings.push(`変換対象外（保存されません）: ${omitted.join('、')}`);
  const screens = Object.entries(object(raw.screens ?? {})).map(([screenId, v]) => {
    const s = object(v); const name = str(s.name, screenId);
    const kind = /dialog|modal|ダイアログ|モーダル/i.test(`${screenId} ${name}`) ? 'dialog' : 'unknown';
    return { id: screenId, name, kind, kindInferred: kind === 'dialog', actions: s.actions, description: s.description, sourceDetails: s };
  });
  const occurrences = new Map<string, number>();
  const transitions = arr(raw.navigation ?? []).map(v => {
    const t = object(v); const base = key([t.from, t.to, t.on, t.condition, t.call]); const count = (occurrences.get(base) ?? 0) + 1; occurrences.set(base, count);
    return { id: str(t.id, `nav:${base}:${count}`), from: t.from, to: t.to, action: str(t.on), condition: t.condition, note: t.call, sourceDetails: t };
  });
  const flows = Object.entries(object(raw.flows ?? {})).map(([flowId, v]) => {
    const f = object(v); const seen = new Map<string, number>();
    return { id: flowId, name: str(f.name, flowId), actor: f.actor, description: f.description,
      sourceDetails: Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'steps')),
      steps: arr(f.steps).map(v => { const s = object(v); const name = str(s.name); const base = key([name, s.entity]); const count = (seen.get(base) ?? 0) + 1; seen.set(base, count); return { id: str(s.id, `step:${base}:${count}`), name, description: s.description, condition: s.when, sourceDetails: s }; }) };
  });
  return { schemaVersion: '1.0', title: str(raw.title, '取り込んだ設計'), screens, transitions, flows, layout: { screens: {}, flows: {} }, importWarnings: warnings };
}
export function parseBlueprint(input: string): Blueprint {
  if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error('JSONは5MB以下にしてください');
  let raw: Obj;
  try { raw = object(JSON.parse(input)); } catch { throw new Error('JSONの構文またはルート形式が正しくありません'); }
  // Reject deeply nested inputs and prototype-related keys before any conversion.
  const visit = (v: unknown, depth = 0) => { if (depth > 40) throw new Error('JSONの階層が深すぎます'); if (v && typeof v === 'object') for (const [k, value] of Object.entries(v)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('予約済みキーを含むJSONは読み込めません'); visit(value, depth + 1); } };
  visit(raw);
  if (!('schemaVersion' in raw) && !('screens' in raw) && !('flows' in raw)) throw new Error('Flowloomまたはdomain-blueprint形式ではありません');
  const result = schema.safeParse('schemaVersion' in raw ? raw : convertDomain(raw));
  if (!result.success) throw new Error(`形式が正しくありません: ${result.error.issues.slice(0, 3).map(i => `${i.path.join('.')} ${i.message}`).join(' / ')}`);
  const doc = result.data;
  unique(doc.screens, '画面'); unique(doc.transitions, '遷移'); unique(doc.flows, 'フロー'); doc.flows.forEach(f => unique(f.steps, '工程'));
  if (doc.flows.reduce((n, f) => n + f.steps.length, 0) > 3000) throw new Error('工程の合計は3000件以下にしてください');
  const ids = new Set(doc.screens.map(s => s.id));
  if (doc.transitions.some(t => !ids.has(t.from) || !ids.has(t.to))) throw new Error('存在しない画面を参照する遷移があります');
  for (const f of doc.flows) {
    if (!f.links) continue;
    unique(f.links, '接続');
    const stepIds = new Set(f.steps.map(s => s.id));
    if (f.links.some(l => !stepIds.has(l.from) || !stepIds.has(l.to))) throw new Error('存在しない工程を参照する接続があります');
  }
  return withLayout(doc);
}
export function arrange(ids: string[], edges: {from: string; to: string}[]): Record<string, Point> {
  const graph = new dagre.graphlib.Graph({ multigraph: true }); graph.setGraph({ rankdir: 'LR', nodesep: 90, ranksep: 160 }); graph.setDefaultEdgeLabel(() => ({}));
  ids.forEach(id => graph.setNode(id, { width: 210, height: 100 })); edges.forEach((e, i) => { if (e.from !== e.to) graph.setEdge(e.from, e.to, {}, String(i)); }); dagre.layout(graph);
  return Object.fromEntries(ids.map(id => { const n = graph.node(id); return [id, { x: n.x - 105, y: n.y - 50 }]; }));
}
export type FlowConnection = { id: string; from: string; to: string; action: string; condition?: string; note?: string; description?: string; sourceDetails?: Record<string, unknown> };
export function flowConnections(f: Blueprint['flows'][number]): FlowConnection[] {
  // A flow with explicit links is a graph (branches, merges, loops);
  // without links the step order itself is the chain.
  if (f.links) return f.links.map(l => ({ id: l.id, from: l.from, to: l.to, action: l.condition ?? '', condition: l.condition, note: l.note, description: l.description, sourceDetails: l.sourceDetails }));
  return f.steps.slice(1).map((s, i) => ({ id: `order-${i}`, from: f.steps[i].id, to: s.id, action: `${i + 1} → ${i + 2}` }));
}
export const flowEdges = (f: Blueprint['flows'][number]) => flowConnections(f).map(({ from, to }) => ({ from, to }));
function complete(ids: string[], saved: Record<string, Point>, edges: {from: string; to: string}[]) {
  const missing = ids.filter(id => !Object.hasOwn(saved, id));
  if (!missing.length) return Object.fromEntries(ids.map(id => [id, saved[id]]));
  if (!Object.keys(saved).length) return arrange(ids, edges);
  const right = Math.max(0, ...Object.values(saved).map(p => p.x)) + 420;
  return Object.fromEntries(ids.map(id => [id, saved[id] ?? { x: right + Math.floor(missing.indexOf(id) / 5) * 350, y: (missing.indexOf(id) % 5) * 190 }]));
}
export function withLayout(doc: Blueprint, current?: Blueprint): Blueprint {
  const screens = complete(doc.screens.map(s => s.id), current?.layout.screens ?? doc.layout.screens, doc.transitions);
  const flows = Object.fromEntries(doc.flows.map(f => [f.id, complete(f.steps.map(s => s.id), current?.layout.flows[f.id] ?? doc.layout.flows[f.id] ?? {}, flowEdges(f))]));
  return { ...doc, layout: { screens, flows } };
}
export function diff(before: Blueprint, after: Blueprint) {
  const groups = (d: Blueprint) => [d.screens.map(s => s.id), d.transitions.map(t => t.id), d.flows.map(f => f.id), d.flows.flatMap(f => f.steps.map(s => JSON.stringify([f.id, s.id]))), d.flows.flatMap(f => (f.links ?? []).map(l => JSON.stringify([f.id, l.id])))];
  const a = groups(before), b = groups(after);
  return ['画面', '遷移', 'フロー', '工程', '接続'].map((label, i) => ({ label, added: b[i].filter(id => !a[i].includes(id)), removed: a[i].filter(id => !b[i].includes(id)) }));
}
