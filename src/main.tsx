import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, getBezierPath, getSmoothStepPath, useReactFlow, applyNodeChanges, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { arrange, diff, flowEdges, MAX_BYTES, parseBlueprint, withLayout, type Blueprint } from './model';
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
    : getBezierPath({ ...props, curvature: .22 + lane * .13 });
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} label={props.label} labelX={x} labelY={y} labelStyle={{ fill: '#294c49', fontSize: 11 }} labelBgStyle={{ fill: props.selected ? '#c0eee4' : '#fffefa' }} labelBgPadding={[7, 5]} labelBgBorderRadius={5} style={{ stroke: props.selected ? '#08766b' : '#839995', strokeWidth: props.selected ? 3 : 1.7 }} interactionWidth={22}/>;
}
const nodeTypes = { card: Card }; const edgeTypes = { routed: RoutedEdge };
const kindLabel = (s: Blueprint['screens'][number]) => `${s.kind === 'dialog' ? 'ダイアログ' : s.kind === 'screen' ? '通常画面' : '種別不明'}${s.kindInferred ? '（推定）' : ''}`;
type Selection = { type: 'node' | 'edge'; id: string } | null;
function App() {
  const [doc, setDoc] = useState<Blueprint | null>(null);
  const [mode, setMode] = useState<'screens' | 'flows'>('screens'); const [flowId, setFlowId] = useState('');
  const [selected, setSelected] = useState<Selection>(null); const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ doc: Blueprint; name: string } | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [nodes, setNodes] = useState<DiagramNode[]>([]); const [edges, setEdges] = useState<Edge[]>([]);
  const fileRef = useRef<HTMLInputElement>(null); const dialogRef = useRef<HTMLDialogElement>(null); const rf = useReactFlow();
  const activeFlow = doc?.flows.find(f => f.id === flowId) ?? doc?.flows[0];
  const activeId = activeFlow?.id ?? '';
  const visible = mode === 'screens' ? doc?.screens ?? [] : activeFlow?.steps ?? [];
  const connections = mode === 'screens' ? doc?.transitions ?? [] : activeFlow ? flowEdges(activeFlow).map((e, i) => ({ ...e, id: `order-${i}`, action: `${i + 1} → ${i + 2}` })) : [];
  useEffect(() => { const prevent = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  useEffect(() => { if (pending) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [pending]);
  useEffect(() => {
    const positions = mode === 'screens' ? doc?.layout.screens ?? {} : doc?.layout.flows[activeId] ?? {};
    const ports = new Map<string, DiagramNode['data']['ports']>(); visible.forEach(s => ports.set(s.id, []));
    const lanes = new Map<string, number>();
    const nextEdges = connections.map(t => {
      const pair = JSON.stringify([t.from, t.to].sort()); const lane = lanes.get(pair) ?? 0; lanes.set(pair, lane + 1);
      const self = t.from === t.to; const reverse = t.from > t.to;
      const sourceSide = self ? Position.Top : reverse ? Position.Bottom : Position.Right;
      const targetSide = self ? Position.Top : reverse ? Position.Bottom : Position.Left;
      ports.get(t.from)?.push({ id: `s-${t.id}`, side: sourceSide, type: 'source', percent: 50 }); ports.get(t.to)?.push({ id: `t-${t.id}`, side: targetSide, type: 'target', percent: 50 });
      return { id: t.id, source: t.from, target: t.to, sourceHandle: `s-${t.id}`, targetHandle: `t-${t.id}`, type: 'routed', data: { lane }, selected: selected?.type === 'edge' && selected.id === t.id, markerEnd: { type: MarkerType.ArrowClosed, color: '#839995' }, ariaLabel: `遷移: ${t.action}` };
    });
    ports.forEach(list => Object.values(Position).forEach(side => { const group = list.filter(p => p.side === side); group.forEach((p, i) => p.percent = (i + 1) * 100 / (group.length + 1)); }));
    setNodes(visible.map((s, i) => ({ id: s.id, type: 'card', position: positions[s.id] ?? {x:0,y:0}, selected: selected?.type === 'node' && selected.id === s.id, data: { name: s.name, subtitle: mode === 'screens' ? kindLabel(s as Blueprint['screens'][number]) : `工程 ${String(i + 1).padStart(2, '0')}`, kind: mode === 'screens' ? String(s.kind) : 'step', ports: ports.get(s.id) ?? [] }, ariaLabel: s.name })));
    setEdges(nextEdges);
  }, [doc, mode, activeId, selected]); // Diagram is derived from immutable structure and separate coordinates.
  useEffect(() => { const timer = window.setTimeout(() => void rf.fitView({ padding: .25, duration: 200 }), 100); return () => clearTimeout(timer); }, [mode, activeId, doc?.title, doc?.screens.length]);
  const apply = (next: Blueprint, name: string, isSample = false) => { setDoc(next); setFlowId(next.flows[0]?.id ?? ''); setSelected(null); setDirty(isSample || Boolean(next.importWarnings?.length)); setMessage(`${name}を読み込みました`); setError(''); };
  async function readFile(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError('');
    try { if (file.size > MAX_BYTES) throw new Error('JSONは5MB以下にしてください'); const next = parseBlueprint(await file.text()); if (doc) setPending({ doc: next, name: file.name }); else apply(next, file.name); }
    catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  const move = (id: string, position: {x:number;y:number}) => { setDoc(old => { if (!old) return old; const layout = mode === 'screens' ? { ...old.layout, screens: { ...old.layout.screens, [id]: position } } : { ...old.layout, flows: { ...old.layout.flows, [activeId]: { ...old.layout.flows[activeId], [id]: position } } }; return { ...old, layout }; }); setDirty(true); };
  const align = () => { if (!doc) return; const positions = arrange(visible.map(s => s.id), connections); setDoc({ ...doc, layout: mode === 'screens' ? { ...doc.layout, screens: positions } : { ...doc.layout, flows: { ...doc.layout.flows, [activeId]: positions } } }); setDirty(true); setMessage('表示中の図を自動整列しました'); window.setTimeout(() => void rf.fitView({ padding: .25, duration: 200 }), 50); };
  const save = () => { if (!doc) return; const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${doc.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)}.flowloom.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setDirty(false); setMessage('JSONをダウンロードしました'); };
  const item = selected?.type === 'node' ? visible.find(s => s.id === selected.id) : connections.find(t => t.id === selected?.id);
  const nameOf = (id: string) => visible.find(s => s.id === id)?.name ?? id;
  return <div className="app" onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDrag(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length !== 1) { setError('JSONファイルを1つ選んでください'); return; } void readFile(e.dataTransfer.files[0]); }}>
    <header><div className="brand"><span className="brand-icon">F</span><div><strong>Flowloom</strong><span>図をひらく、流れが見える</span></div></div><div className="document-title">{doc?.title ?? '新しいワークスペース'}<span className={`save-state ${dirty ? 'unsaved' : ''}`}>{doc ? dirty ? '● 未保存の変更' : '保存済みのJSON' : 'v0.1'}</span></div><div className="file-actions"><button onClick={() => fileRef.current?.click()} disabled={busy || !!pending}>{busy ? '読み込み中…' : doc ? 'JSON読込・更新' : 'JSONを開く'}</button><button className="primary" onClick={save} disabled={!doc || busy}>↓ JSONを保存</button></div><input ref={fileRef} type="file" accept=".json,application/json" aria-label="JSONファイル" hidden onChange={e => void readFile(e.target.files?.[0])}/></header>
    <nav className="toolbar" aria-label="図の操作"><div className="tabs"><button aria-pressed={mode === 'screens'} onClick={() => { setMode('screens'); setSelected(null); }}>画面遷移</button><button aria-pressed={mode === 'flows'} onClick={() => { setMode('flows'); setSelected(null); }}>業務フロー</button></div>{mode === 'flows' && doc && <select aria-label="表示する業務フロー" value={activeId} onChange={e => { setFlowId(e.target.value); setSelected(null); }}>{doc.flows.length ? doc.flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">フローなし</option>}</select>}<span className="counts">{mode === 'screens' ? `${doc?.screens.length ?? 0} 画面 / ${doc?.transitions.length ?? 0} 遷移` : `${doc?.flows.length ?? 0} フロー / ${visible.length} 工程`}</span><div className="canvas-actions"><button disabled={!visible.length} onClick={() => void rf.fitView({ padding: .25, duration: 200 })}>全体表示</button><button disabled={!visible.length} onClick={align}>自動整列</button></div></nav>
    <div className="feedback" aria-live="polite">{error ? <span role="alert" className="error">{error}</span> : message || 'JSONはブラウザ内で処理されます。外部への送信はありません。'}</div>
    <main><section className="canvas" aria-label="図のキャンバス">{doc ? <><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changes => setNodes(n => applyNodeChanges(changes, n))} onNodeDragStop={(_, node) => move(node.id, node.position)} onNodeClick={(_, n) => setSelected({ type: 'node', id: n.id })} onEdgeClick={(_, e) => setSelected({ type: 'edge', id: e.id })} onSelectionChange={({nodes, edges}) => { const n = nodes[0], e = edges[0]; if (n) setSelected(s => s?.type === 'node' && s.id === n.id ? s : { type: 'node', id: n.id }); else if (e) setSelected(s => s?.type === 'edge' && s.id === e.id ? s : { type: 'edge', id: e.id }); }} onPaneClick={() => setSelected(null)} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={.08} maxZoom={2.5} fitView proOptions={{ hideAttribution: false }}><Background gap={22} size={1} color="#cbd8d2"/><Controls showInteractive={false} aria-label="拡大・縮小・全体表示"/><MiniMap pannable zoomable nodeColor={n => n.data.kind === 'dialog' ? '#dbcba5' : '#8eb7ab'}/></ReactFlow>{!visible.length && <div className="empty-graph">{mode === 'flows' ? '業務フローは登録されていません' : '画面は登録されていません'}</div>}<div className="canvas-note">ドラッグで配置 · 背景ドラッグで移動 · ホイールで拡大縮小</div></> : <div className="welcome"><span className="eyebrow">YOUR FLOWS, IN FOCUS</span><div className="welcome-symbol">▢ <span>⟶</span> ▧</div><h1>つながりを、見渡そう。</h1><p>設計のJSONを開いて、画面や業務の流れを整理。<br/>ボックスを動かし、自分にとって分かりやすい配置へ。</p><button className="primary" onClick={() => fileRef.current?.click()}>JSONファイルを選ぶ</button><span className="drop-hint">または、この画面へドラッグ＆ドロップ（最大5MB）</span><button className="text-button" onClick={() => apply(sample(), 'サンプル', true)}>サンプル「小さな図書室」を試す →</button><small>Flowloom JSON / domain-blueprint model.json 対応</small></div>}</section>
    <aside aria-label="詳細パネル"><div className="panel-heading"><span className="eyebrow">INSPECTOR</span><h2>{selected ? selected.type === 'node' ? mode === 'screens' ? '画面の詳細' : '工程の詳細' : '接続の詳細' : '図のガイド'}</h2></div>{item ? <div className="detail"><h3>{'name' in item ? String(item.name) : 'action' in item ? item.action : '工程間の順序'}</h3><dl>{Object.entries(item).filter(([k]) => !['sourceDetails', 'name', 'kindInferred'].includes(k)).map(([k, v]) => <div key={k}><dt>{{id:'ID',kind:'種類',description:'説明',actions:'主要操作',from:'遷移元',to:'遷移先',action:'操作',condition:'条件・実行条件',note:'補足'}[k] ?? k}</dt><dd>{k === 'kind' ? kindLabel(item as Blueprint['screens'][number]) : (k === 'from' || k === 'to') ? nameOf(String(v)) : typeof v === 'object' ? Array.isArray(v) ? v.map((a, i) => <div key={i}>{String(a)}</div>) : JSON.stringify(v, null, 2) : String(v ?? '—')}</dd></div>)}</dl>{'sourceDetails' in item && item.sourceDetails && <details><summary>取り込み元の補足情報</summary><pre>{JSON.stringify(item.sourceDetails, null, 2)}</pre></details>}</div> : <div className="guide"><p>ボックスや矢印を選ぶと、<br/>説明や条件をここに表示します。</p><div className="legend"><span className="legend-box"/>通常画面</div><div className="legend"><span className="legend-box dialog"/>ダイアログ</div><div className="legend"><span className="legend-box unknown"/>種別不明</div><hr/><h3>配置を整える</h3><p>ボックスは自由に動かせます。<br/>「自動整列」は表示中の図だけに適用します。</p><h3>作業を残す</h3><p>「JSONを保存」で配置ごと保存。<br/>次回も同じ位置から再開できます。</p></div>}
    {mode === 'flows' && activeFlow && <details className="flow-info"><summary>フロー情報：{activeFlow.name}</summary><p>{activeFlow.actor && `担当：${activeFlow.actor}`}</p><p>{activeFlow.description}</p>{activeFlow.sourceDetails && <pre>{JSON.stringify(activeFlow.sourceDetails, null, 2)}</pre>}</details>}
    {doc && <details className="elements"><summary>図の要素一覧（{visible.length + connections.length}）</summary><p>重なった矢印もここから選択できます。</p>{visible.map(s => <button key={`n-${s.id}`} aria-pressed={selected?.type === 'node' && selected.id === s.id} onClick={() => { setSelected({type:'node',id:s.id}); void rf.fitView({nodes:[{id:s.id}],maxZoom:1,padding:1}); }}>{s.name}</button>)}{connections.map(t => <button key={`e-${t.id}`} aria-pressed={selected?.type === 'edge' && selected.id === t.id} onClick={() => { setSelected({type:'edge',id:t.id}); void rf.fitView({nodes:[{id:t.from},{id:t.to}],maxZoom:1,padding:.5}); }}>{nameOf(t.from)} → {nameOf(t.to)}<small>{t.action}</small></button>)}</details>}
    {!!doc?.importWarnings?.length && <details className="warnings" open><summary>取り込み時の注意</summary>{doc.importWarnings.map((w, i) => <p key={i}>{w}</p>)}</details>}</aside></main>
    <footer><span>FLOWLOOM <span className="muted">/ ブラウザだけで動く、設計の作業台</span></span><span>データは端末内で処理 · 自動保存なし</span></footer>
    {drag && <div className="drop-overlay">JSONファイルをドロップして読み込み</div>}
    <dialog ref={dialogRef} onCancel={e => { e.preventDefault(); setPending(null); }} aria-labelledby="update-title">{pending && <><span className="eyebrow">UPDATE BLUEPRINT</span><h2 id="update-title">読み込む内容を確認</h2><p>{pending.name}</p><p>同じIDの配置を維持し、新しい要素を空いている右側に配置します。削除された要素は取り除きます。設計内容は読み込むJSONに置き換わります。</p>{dirty && <p className="warning-text">未保存の変更があります。必要ならキャンセルして先に保存してください。</p>}<table><thead><tr><th>対象</th><th>追加</th><th>削除</th></tr></thead><tbody>{doc && diff(doc, pending.doc).map(d => <tr key={d.label}><th>{d.label}</th><td>{d.added.length}</td><td>{d.removed.length}</td></tr>)}</tbody></table><details><summary>追加・削除されたID</summary>{doc && diff(doc, pending.doc).map(d => <div key={d.label}><strong>{d.label}</strong><p>追加: {d.added.join('、') || 'なし'}</p><p>削除: {d.removed.join('、') || 'なし'}</p></div>)}</details>{pending.doc.importWarnings?.map((w, i) => <p className="warning-text" key={i}>{w}</p>)}<div className="dialog-actions"><button autoFocus onClick={() => setPending(null)}>キャンセル</button><button className="primary" onClick={() => { const next = withLayout(pending.doc, doc ?? undefined); apply(next, pending.name); setDirty(true); setPending(null); }}>配置を維持して適用</button></div></>}</dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ReactFlowProvider><App/></ReactFlowProvider></StrictMode>);
