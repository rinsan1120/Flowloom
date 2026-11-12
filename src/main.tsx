import { StrictMode, useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, getBezierPath, getSmoothStepPath, getNodesBounds, getViewportForBounds, useReactFlow, applyNodeChanges, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import './style.css';
import { arrange, diff, flowConnections, MAX_BYTES, parseBlueprint, routeBetween, withLayout, type Blueprint } from './model';
import { sample } from './sample';

type DiagramNode = Node<{name: string; subtitle: string; kind: string; ports: { id: string; side: Position; type: 'source' | 'target'; percent: number }[]}, 'card'>;
function Card({ data, selected }: NodeProps<DiagramNode>) {
  return <div className={`diagram-card ${data.kind} ${selected ? 'active' : ''}`}>
    {data.ports.map(p => <Handle key={p.id} id={p.id} type={p.type} position={p.side} isConnectable={false} style={p.side === Position.Top || p.side === Position.Bottom ? { left: `${p.percent}%` } : { top: `${p.percent}%` }}/>)}
    <span className="node-caption">{data.subtitle}</span><strong title={data.name}>{data.name}</strong>
  </div>;
}
function RoutedEdge(props: EdgeProps) {
  const lane = Number(props.data?.lane ?? 0);
  const [path, x, y] = props.source === props.target
    ? getSmoothStepPath({ ...props, offset: 65 + lane * 35, borderRadius: 20 })
    : props.data?.back
      // Return edges take a squared detour under the nodes instead of a
      // diagonal swoop; longer spans sit further out via backRank.
      ? getSmoothStepPath({ ...props, offset: 40 + Number(props.data?.backRank ?? 0) * 26, borderRadius: 16 })
      : getBezierPath({ ...props, curvature: .22 + lane * .13 });
  const dim = props.data?.dimmed ? 0.13 : 1;
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} label={props.label} labelX={x} labelY={y} labelStyle={{ fill: '#294c49', fontSize: 11, opacity: dim }} labelBgStyle={{ fill: props.selected ? '#c0eee4' : '#fffefa', opacity: dim }} labelBgPadding={[7, 5]} labelBgBorderRadius={5} style={{ stroke: props.selected ? '#08766b' : '#839995', strokeWidth: props.selected ? 3 : 1.7, opacity: dim, transition: 'opacity .25s' }} interactionWidth={22}/>;
}
const nodeTypes = { card: Card }; const edgeTypes = { routed: RoutedEdge };
const AI_PROMPT = `あなたはアプリの設計を「Flowloom JSON」という形式に整理するアシスタントです。
私が説明するアプリについて、画面遷移図と業務フロー図を次の形式のJSONで出力してください。

# 形式（schemaVersion "1.0"）
{
  "schemaVersion": "1.0",
  "title": "アプリ名",
  "screens": [
    { "id": "home", "name": "ホーム", "kind": "screen", "description": "画面の説明（1文）", "actions": ["主要な操作"] }
  ],
  "transitions": [
    { "id": "go-list", "from": "home", "to": "list", "action": "一覧ボタンを押す", "condition": "任意：遷移の条件", "note": "任意：補足" }
  ],
  "flows": [
    {
      "id": "main-flow", "name": "基本フロー",
      "steps": [ { "id": "s1", "name": "工程名", "description": "工程の説明（1文）" } ],
      "links": [ { "id": "l1", "from": "s1", "to": "s2", "condition": "分岐条件" } ]
    }
  ],
  "layout": { "screens": {}, "flows": {} }
}

# ルール
- id は半角英数字とハイフンで付け、同じ種類の中で重複させない。
- kind は screen（通常画面）/ dialog（ダイアログ・モーダル）/ unknown（種別不明）のいずれか。
- transitions の from / to は screens の id を指す。存在しない id は使わない。
- flows の steps は工程の並び。分岐・合流・ループがある場合は links で工程同士を結ぶ（links を省略すると steps の順に直列でつながる）。
- layout は空のままにする（配置は後で人が整える）。
- 出力はJSONのみ。前置き・解説などの文章は付けない。

# 図にするアプリについて
（ここに対象アプリの概要、画面の一覧、各画面でできる操作、画面同士のつながり、業務の流れを書く。既存のアプリの説明資料や画面一覧があれば、それを貼ってもよい）`;
function AiPromptHelp() {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(AI_PROMPT); }
    catch { const ta = document.createElement('textarea'); ta.value = AI_PROMPT; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
  };
  return <><button type="button" className="text-button ai-prompt-open" onClick={() => ref.current?.showModal()}>AIにJSONを作らせるプロンプト</button><dialog ref={ref} className="ai-prompt-dialog" aria-labelledby={titleId} onClick={e => { if (e.target === ref.current) ref.current?.close(); }}><span className="eyebrow">AI PROMPT</span><h2 id={titleId}>AIにJSONを作らせるプロンプト</h2><p>ChatGPTやClaudeなどのAIにこのプロンプトを貼り、「図にするアプリについて」の部分に、対象アプリの画面構成や操作の流れを書く（既存のアプリなら、その説明や画面一覧を貼る）と、Flowloomで開けるJSONに整理させることができます。</p><pre>{AI_PROMPT}</pre><div className="dialog-actions"><button onClick={() => ref.current?.close()}>閉じる</button><button className="primary" onClick={() => void copy()}>{copied ? 'コピーしました' : 'プロンプトをコピー'}</button></div></dialog></>;
}
const kindLabel = (s: Blueprint['screens'][number]) => `${s.kind === 'dialog' ? 'ダイアログ' : s.kind === 'screen' ? '通常画面' : '種別不明'}${s.kindInferred ? '（推定）' : ''}`;
type Selection = { type: 'node' | 'edge'; id: string } | null;
function App() {
  const [doc, setDoc] = useState<Blueprint | null>(null);
  const [mode, setMode] = useState<'screens' | 'flows'>('screens'); const [flowId, setFlowId] = useState('');
  const [selected, setSelected] = useState<Selection>(null); const [fromId, setFromId] = useState<string | null>(null); const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ doc: Blueprint; name: string } | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [nodes, setNodes] = useState<DiagramNode[]>([]); const [edges, setEdges] = useState<Edge[]>([]);
  const fileRef = useRef<HTMLInputElement>(null); const dialogRef = useRef<HTMLDialogElement>(null); const rf = useReactFlow();
  const activeFlow = doc?.flows.find(f => f.id === flowId) ?? doc?.flows[0];
  const activeId = activeFlow?.id ?? '';
  const visible = mode === 'screens' ? doc?.screens ?? [] : activeFlow?.steps ?? [];
  const connections = mode === 'screens' ? doc?.transitions ?? [] : activeFlow ? flowConnections(activeFlow) : [];
  useEffect(() => { const prevent = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  useEffect(() => { if (pending) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [pending]);
  useEffect(() => {
    const positions = mode === 'screens' ? doc?.layout.screens ?? {} : doc?.layout.flows[activeId] ?? {};
    const ports = new Map<string, DiagramNode['data']['ports']>(); visible.forEach(s => ports.set(s.id, []));
    const lanes = new Map<string, number>();
    const center = (id: string) => { const p = positions[id]; return p ? { x: p.x + 105, y: p.y + 50 } : null; };
    // Sides follow the actual layout, not ID order: an edge whose target
    // sits clearly left of its source is a return edge and dives under.
    const kinds = connections.map(t => {
      if (t.from === t.to) return 'self' as const;
      const s = center(t.from), g = center(t.to);
      if (!s || !g) return 'forward' as const;
      const dx = g.x - s.x, dy = g.y - s.y;
      if (dx > 40) return 'forward' as const;
      if (dx < -40) return 'back' as const;
      return dy >= 0 ? 'down' as const : 'up' as const;
    });
    // Longest returns get the outermost under-channel so they nest.
    const backRank = new Map<string, number>();
    connections.map((t, i) => ({ t, i })).filter(({ i }) => kinds[i] === 'back')
      .sort((a, b) => Math.abs((center(b.t.to)?.x ?? 0) - (center(b.t.from)?.x ?? 0)) - Math.abs((center(a.t.to)?.x ?? 0) - (center(a.t.from)?.x ?? 0)))
      .forEach(({ t }, rank) => backRank.set(t.id, rank));
    // Round-trip highlight: with a box selected, everything off the
    // shortest route From -> box -> From is dimmed.
    const fromNodeId = visible.some(s => s.id === fromId) ? fromId! : visible[0]?.id;
    let dimNodes: Set<string> | null = null; let dimEdges: Set<string> | null = null;
    if (selected?.type === 'node' && fromNodeId && selected.id !== fromNodeId) {
      const go = routeBetween(connections, fromNodeId, selected.id);
      const back = routeBetween(connections, selected.id, fromNodeId);
      if (go || back) {
        const litN = new Set<string>([fromNodeId, selected.id]); const litE = new Set<string>();
        for (const r of [go, back]) { r?.nodeIds.forEach(id => litN.add(id)); r?.edgeIds.forEach(id => litE.add(id)); }
        dimNodes = new Set(visible.map(s => s.id).filter(id => !litN.has(id)));
        dimEdges = new Set(connections.map(t => t.id).filter(id => !litE.has(id)));
      }
    }
    const nextEdges = connections.map((t, i) => {
      const pair = JSON.stringify([t.from, t.to].sort()); const lane = lanes.get(pair) ?? 0; lanes.set(pair, lane + 1);
      const kind = kinds[i];
      const sourceSide = kind === 'self' || kind === 'up' ? Position.Top : kind === 'forward' ? Position.Right : Position.Bottom;
      const targetSide = kind === 'self' ? Position.Top : kind === 'forward' ? Position.Left : kind === 'down' ? Position.Top : Position.Bottom;
      ports.get(t.from)?.push({ id: `s-${t.id}`, side: sourceSide, type: 'source', percent: 50 }); ports.get(t.to)?.push({ id: `t-${t.id}`, side: targetSide, type: 'target', percent: 50 });
      return { id: t.id, source: t.from, target: t.to, sourceHandle: `s-${t.id}`, targetHandle: `t-${t.id}`, type: 'routed', data: { lane, back: kind === 'back', backRank: backRank.get(t.id) ?? 0, dimmed: dimEdges?.has(t.id) ?? false }, selected: selected?.type === 'edge' && selected.id === t.id, markerEnd: { type: MarkerType.ArrowClosed, color: '#839995' }, label: mode === 'flows' ? t.condition || undefined : undefined, ariaLabel: mode === 'flows' && !t.action ? '接続' : `遷移: ${t.action}` };
    });
    ports.forEach(list => Object.values(Position).forEach(side => { const group = list.filter(p => p.side === side); group.forEach((p, i) => p.percent = (i + 1) * 100 / (group.length + 1)); }));
    setNodes(visible.map((s, i) => ({ id: s.id, type: 'card', position: positions[s.id] ?? {x:0,y:0}, selected: selected?.type === 'node' && selected.id === s.id, style: { opacity: dimNodes?.has(s.id) ? 0.16 : 1 }, data: { name: s.name, subtitle: mode === 'screens' ? kindLabel(s as Blueprint['screens'][number]) : `工程 ${String(i + 1).padStart(2, '0')}`, kind: mode === 'screens' ? String(s.kind) : 'step', ports: ports.get(s.id) ?? [] }, ariaLabel: s.name })));
    setEdges(nextEdges);
  }, [doc, mode, activeId, selected, fromId]); // Diagram is derived from immutable structure and separate coordinates.
  useEffect(() => { const timer = window.setTimeout(() => void rf.fitView({ padding: .25, duration: 200 }), 100); return () => clearTimeout(timer); }, [mode, activeId, doc?.title, doc?.screens.length]);
  const apply = (next: Blueprint, name: string, isSample = false) => { setDoc(next); setFlowId(next.flows[0]?.id ?? ''); setSelected(null); setFromId(null); setDirty(isSample || Boolean(next.importWarnings?.length)); setMessage(`${name}を読み込みました`); setError(''); };
  async function readFile(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError('');
    try { if (file.size > MAX_BYTES) throw new Error('JSONは5MB以下にしてください'); const next = parseBlueprint(await file.text()); if (doc) setPending({ doc: next, name: file.name }); else apply(next, file.name); }
    catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  const move = (id: string, position: {x:number;y:number}) => { setDoc(old => { if (!old) return old; const layout = mode === 'screens' ? { ...old.layout, screens: { ...old.layout.screens, [id]: position } } : { ...old.layout, flows: { ...old.layout.flows, [activeId]: { ...old.layout.flows[activeId], [id]: position } } }; return { ...old, layout }; }); setDirty(true); };
  const align = () => { if (!doc) return; const positions = arrange(visible.map(s => s.id), connections); setDoc({ ...doc, layout: mode === 'screens' ? { ...doc.layout, screens: positions } : { ...doc.layout, flows: { ...doc.layout.flows, [activeId]: positions } } }); setDirty(true); setMessage('表示中の図を自動整列しました'); window.setTimeout(() => void rf.fitView({ padding: .25, duration: 200 }), 50); };
  const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80);
  const save = () => { if (!doc) return; const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${safeName(doc.title)}.flowloom.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setDirty(false); setMessage('JSONをダウンロードしました'); };
  const exportImage = async (format: 'png' | 'svg') => {
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!doc || !viewportEl || !visible.length || busy) return;
    setBusy(true); setError('');
    try {
      const bounds = getNodesBounds(rf.getNodes());
      const width = Math.max(320, Math.ceil(bounds.width) + 96);
      const height = Math.max(240, Math.ceil(bounds.height) + 96);
      const viewport = getViewportForBounds(bounds, width, height, 0.1, 2, 0.02);
      const options = { backgroundColor: '#f2f5ee', width, height, style: { width: `${width}px`, height: `${height}px`, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` } };
      const url = format === 'png' ? await toPng(viewportEl, { ...options, pixelRatio: 2 }) : await toSvg(viewportEl, options);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(doc.title)}-${mode === 'screens' ? '画面遷移' : '業務フロー'}.${format}`;
      a.click();
      setMessage(`${format.toUpperCase()}画像をダウンロードしました`);
    } catch { setError('画像の書き出しに失敗しました'); }
    finally { setBusy(false); }
  };
  const item = selected?.type === 'node' ? visible.find(s => s.id === selected.id) : connections.find(t => t.id === selected?.id);
  const nameOf = (id: string) => visible.find(s => s.id === id)?.name ?? id;
  const fromNodeId = visible.some(s => s.id === fromId) ? fromId! : visible[0]?.id;
  const selNodeId = selected?.type === 'node' ? selected.id : null;
  const goRoute = selNodeId && fromNodeId && selNodeId !== fromNodeId ? routeBetween(connections, fromNodeId, selNodeId) : null;
  const backRoute = selNodeId && fromNodeId && selNodeId !== fromNodeId ? routeBetween(connections, selNodeId, fromNodeId) : null;
  const inbound = selNodeId ? connections.filter(t => t.to === selNodeId) : [];
  const outbound = selNodeId ? connections.filter(t => t.from === selNodeId) : [];
  return <div className="app" onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDrag(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length !== 1) { setError('JSONファイルを1つ選んでください'); return; } void readFile(e.dataTransfer.files[0]); }}>
    <header><div className="brand"><span className="brand-icon">F</span><div><strong>Flowloom</strong><span>図をひらく、流れが見える</span></div></div><div className="document-title">{doc?.title ?? '新しいワークスペース'}<span className={`save-state ${dirty ? 'unsaved' : ''}`}>{doc ? dirty ? '● 未保存の変更' : '保存済みのJSON' : 'v0.1'}</span></div><div className="file-actions"><button onClick={() => fileRef.current?.click()} disabled={busy || !!pending}>{busy ? '読み込み中…' : doc ? 'JSON読込・更新' : 'JSONを開く'}</button><button className="primary" onClick={save} disabled={!doc || busy}>↓ JSONを保存</button></div><input ref={fileRef} type="file" accept=".json,application/json" aria-label="JSONファイル" hidden onChange={e => void readFile(e.target.files?.[0])}/></header>
    <nav className="toolbar" aria-label="図の操作"><div className="tabs"><button aria-pressed={mode === 'screens'} onClick={() => { setMode('screens'); setSelected(null); }}>画面遷移</button><button aria-pressed={mode === 'flows'} onClick={() => { setMode('flows'); setSelected(null); }}>業務フロー</button></div>{mode === 'flows' && doc && <select aria-label="表示する業務フロー" value={activeId} onChange={e => { setFlowId(e.target.value); setSelected(null); }}>{doc.flows.length ? doc.flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">フローなし</option>}</select>}<span className="counts">{mode === 'screens' ? `${doc?.screens.length ?? 0} 画面 / ${doc?.transitions.length ?? 0} 遷移` : `${doc?.flows.length ?? 0} フロー / ${visible.length} 工程`}</span><div className="canvas-actions"><button disabled={!visible.length} onClick={() => void rf.fitView({ padding: .25, duration: 200 })}>全体表示</button><button disabled={!visible.length} onClick={align}>自動整列</button><button disabled={!visible.length || busy} onClick={() => void exportImage('png')}>PNG保存</button><button disabled={!visible.length || busy} onClick={() => void exportImage('svg')}>SVG保存</button></div></nav>
    <div className="feedback" aria-live="polite">{error ? <span role="alert" className="error">{error}</span> : message || 'JSONはブラウザ内で処理されます。外部への送信はありません。'}</div>
    <main><section className="canvas" aria-label="図のキャンバス">{doc ? <><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changes => setNodes(n => applyNodeChanges(changes, n))} onNodeDragStop={(_, node) => move(node.id, node.position)} onNodeClick={(_, n) => setSelected({ type: 'node', id: n.id })} onEdgeClick={(_, e) => setSelected({ type: 'edge', id: e.id })} onPaneClick={() => setSelected(null)} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={.08} maxZoom={2.5} fitView proOptions={{ hideAttribution: false }}><Background gap={22} size={1} color="#cbd8d2"/><Controls showInteractive={false} aria-label="拡大・縮小・全体表示"/><MiniMap pannable zoomable nodeColor={n => n.data.kind === 'dialog' ? '#dbcba5' : '#8eb7ab'}/></ReactFlow>{!visible.length && <div className="empty-graph">{mode === 'flows' ? '業務フローは登録されていません' : '画面は登録されていません'}</div>}<div className="canvas-note">ドラッグで配置 · 背景ドラッグで移動 · ホイールで拡大縮小</div></> : <div className="welcome"><span className="eyebrow">YOUR FLOWS, IN FOCUS</span><div className="welcome-symbol">▢ <span>⟶</span> ▧</div><h1>つながりを、見渡そう。</h1><p>設計のJSONを開いて、画面や業務の流れを整理。<br/>ボックスを動かし、自分にとって分かりやすい配置へ。</p><button className="primary" onClick={() => fileRef.current?.click()}>JSONファイルを選ぶ</button><span className="drop-hint">または、この画面へドラッグ＆ドロップ（最大5MB）</span><button className="text-button" onClick={() => apply(sample(), 'サンプル', true)}>サンプル「小さな図書室」を試す →</button><small>Flowloom JSON / domain-blueprint model.json 対応</small><AiPromptHelp/></div>}</section>
    <aside aria-label="詳細パネル"><div className="panel-heading"><span className="eyebrow">INSPECTOR</span><h2>{selected ? selected.type === 'node' ? mode === 'screens' ? '画面の詳細' : '工程の詳細' : '接続の詳細' : '図のガイド'}</h2></div>{item ? <div className="detail"><h3>{'name' in item ? String(item.name) : 'action' in item ? item.action || '接続' : '工程間の順序'}</h3><dl>{Object.entries(item).filter(([k]) => !['sourceDetails', 'name', 'kindInferred'].includes(k)).map(([k, v]) => <div key={k}><dt>{{id:'ID',kind:'種類',description:'説明',actions:'主要操作',from:'遷移元',to:'遷移先',action:'操作',condition:'条件・実行条件',note:'補足'}[k] ?? k}</dt><dd>{k === 'kind' ? kindLabel(item as Blueprint['screens'][number]) : (k === 'from' || k === 'to') ? nameOf(String(v)) : typeof v === 'object' ? Array.isArray(v) ? v.map((a, i) => <div key={i}>{String(a)}</div>) : JSON.stringify(v, null, 2) : String(v ?? '—')}</dd></div>)}</dl>{'sourceDetails' in item && item.sourceDetails && <details><summary>取り込み元の補足情報</summary><pre>{JSON.stringify(item.sourceDetails, null, 2)}</pre></details>}{selNodeId && <div className="neighbors"><h3>ルート</h3><p className="route-from">From:{fromNodeId ? nameOf(fromNodeId) : '—'}{selNodeId === fromNodeId ? <span>（このボックスがFromです）</span> : <button onClick={() => setFromId(selNodeId)}>このボックスをFromにする</button>}</p>{selNodeId !== fromNodeId && !goRoute && !backRoute && <p className="warning-text">Fromとの間にルートがありません</p>}{selNodeId !== fromNodeId && goRoute && !backRoute && <p className="warning-text">Fromへ戻るルートがありません</p>}{selNodeId !== fromNodeId && !goRoute && backRoute && <p className="warning-text">Fromからここへ来るルートがありません</p>}<h3>ここへの遷移（{inbound.length}）</h3>{inbound.length ? inbound.map(t => <button key={t.id} onClick={() => { setSelected({ type: 'node', id: t.from }); void rf.fitView({ nodes: [{ id: t.from }], maxZoom: 1, padding: 1 }); }}>{nameOf(t.from)}<small>{t.action || '接続'}</small></button>) : <p>ありません</p>}<h3>ここからの遷移（{outbound.length}）</h3>{outbound.length ? outbound.map(t => <button key={t.id} onClick={() => { setSelected({ type: 'node', id: t.to }); void rf.fitView({ nodes: [{ id: t.to }], maxZoom: 1, padding: 1 }); }}>{nameOf(t.to)}<small>{t.action || '接続'}</small></button>) : <p>ありません</p>}</div>}</div> : <div className="guide"><p>ボックスや矢印を選ぶと、<br/>説明や条件をここに表示します。</p><AiPromptHelp/><div className="legend"><span className="legend-box"/>通常画面</div><div className="legend"><span className="legend-box dialog"/>ダイアログ</div><div className="legend"><span className="legend-box unknown"/>種別不明</div><hr/><h3>配置を整える</h3><p>ボックスは自由に動かせます。<br/>「自動整列」は表示中の図だけに適用します。</p><h3>作業を残す</h3><p>「JSONを保存」で配置ごと保存。<br/>次回も同じ位置から再開できます。</p></div>}
    {mode === 'flows' && activeFlow && <details className="flow-info"><summary>フロー情報：{activeFlow.name}</summary><p>{activeFlow.actor && `担当：${activeFlow.actor}`}</p><p>{activeFlow.description}</p>{activeFlow.sourceDetails && <pre>{JSON.stringify(activeFlow.sourceDetails, null, 2)}</pre>}</details>}
    {doc && <details className="elements"><summary>図の要素一覧（{visible.length + connections.length}）</summary><p>重なった矢印もここから選択できます。</p>{visible.map(s => <button key={`n-${s.id}`} aria-pressed={selected?.type === 'node' && selected.id === s.id} onClick={() => { setSelected({type:'node',id:s.id}); void rf.fitView({nodes:[{id:s.id}],maxZoom:1,padding:1}); }}>{s.name}</button>)}{connections.map(t => <button key={`e-${t.id}`} aria-pressed={selected?.type === 'edge' && selected.id === t.id} onClick={() => { setSelected({type:'edge',id:t.id}); void rf.fitView({nodes:[{id:t.from},{id:t.to}],maxZoom:1,padding:.5}); }}>{nameOf(t.from)} → {nameOf(t.to)}<small>{t.action}</small></button>)}</details>}
    {!!doc?.importWarnings?.length && <details className="warnings" open><summary>取り込み時の注意</summary>{doc.importWarnings.map((w, i) => <p key={i}>{w}</p>)}</details>}</aside></main>
    <footer><span>FLOWLOOM <span className="muted">/ ブラウザだけで動く、設計の作業台</span></span><span>データは端末内で処理 · 自動保存なし</span></footer>
    {drag && <div className="drop-overlay">JSONファイルをドロップして読み込み</div>}
    <dialog ref={dialogRef} onCancel={e => { e.preventDefault(); setPending(null); }} aria-labelledby="update-title">{pending && <><span className="eyebrow">UPDATE BLUEPRINT</span><h2 id="update-title">読み込む内容を確認</h2><p>{pending.name}</p><p>同じIDの配置を維持し、新しい要素を空いている右側に配置します。削除された要素は取り除きます。設計内容は読み込むJSONに置き換わります。</p>{dirty && <p className="warning-text">未保存の変更があります。必要ならキャンセルして先に保存してください。</p>}<table><thead><tr><th>対象</th><th>追加</th><th>削除</th></tr></thead><tbody>{doc && diff(doc, pending.doc).map(d => <tr key={d.label}><th>{d.label}</th><td>{d.added.length}</td><td>{d.removed.length}</td></tr>)}</tbody></table><details><summary>追加・削除されたID</summary>{doc && diff(doc, pending.doc).map(d => <div key={d.label}><strong>{d.label}</strong><p>追加: {d.added.join('、') || 'なし'}</p><p>削除: {d.removed.join('、') || 'なし'}</p></div>)}</details>{pending.doc.importWarnings?.map((w, i) => <p className="warning-text" key={i}>{w}</p>)}<div className="dialog-actions"><button autoFocus onClick={() => setPending(null)}>キャンセル</button><button className="primary" onClick={() => { const next = withLayout(pending.doc, doc ?? undefined); apply(next, pending.name); setDirty(true); setPending(null); }}>配置を維持して適用</button></div></>}</dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ReactFlowProvider><App/></ReactFlowProvider></StrictMode>);
