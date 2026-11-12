import { describe, expect, it } from 'vitest';
import { arrange, convertDomain, diff, flowConnections, flowEdges, parseBlueprint, routeBetween, routeCone, withLayout } from './model';
import { sample } from './sample';

describe('Flowloom JSON', () => {
  it('reads its native sample and builds distinct layouts', () => {
    const doc = sample();
    expect(doc.screens).toHaveLength(4);
    expect(doc.transitions).toHaveLength(7);
    expect(doc.flows).toHaveLength(2);
    expect(Object.keys(doc.layout.screens)).toHaveLength(4);
    expect(Object.keys(doc.layout.flows.lending)).toHaveLength(3);
    expect(Object.keys(doc.layout.flows.return)).toHaveLength(2);
  });

  it('imports screens, parallel transitions and flows from domain-blueprint', () => {
    const legacy = {
      screens: {
        Home: { name: 'ホーム', actions: ['登録'] },
        ConfirmDialog: { name: '確認ダイアログ' }
      },
      navigation: [
        { from: 'Home', to: 'ConfirmDialog', on: '登録する' },
        { from: 'Home', to: 'ConfirmDialog', on: '再登録する' }
      ],
      flows: {
        registration: { name: '登録業務', actor: '利用者', steps: [{ name: '入力' }, { name: '確定' }] }
      },
      entities: { ignored: { name: '変換対象外' } }
    };
    const converted = convertDomain(legacy);
    const doc = parseBlueprint(JSON.stringify(converted));
    expect(doc.screens.find(s => s.id === 'Home')?.kind).toBe('unknown');
    expect(doc.screens.find(s => s.id === 'ConfirmDialog')?.kind).toBe('dialog');
    expect(doc.transitions).toHaveLength(2);
    expect(new Set(doc.transitions.map(t => t.id)).size).toBe(2);
    expect(doc.flows[0].steps).toHaveLength(2);
    expect(doc.importWarnings?.join(' ')).toContain('entities');
  });

  it('retains positions for unchanged IDs and places new nodes without overwriting layout', () => {
    const current = sample();
    const existingPosition = { x: 551, y: -90 };
    current.layout.screens.home = existingPosition;
    const incoming = sample();
    incoming.screens.push({ id: 'new', name: '新画面', kind: 'screen' });
    const updated = withLayout(incoming, current);
    expect(updated.layout.screens.home).toEqual(existingPosition);
    expect(updated.layout.screens.new).toBeDefined();
    expect(updated.layout.screens.new.x).toBeGreaterThan(existingPosition.x);
    expect(diff(current, updated).find(d => d.label === '画面')?.added).toEqual(['new']);
  });

  it('rejects duplicate transition IDs and missing screen references', () => {
    const duplicated = sample();
    duplicated.transitions.push({ ...duplicated.transitions[0] });
    expect(() => parseBlueprint(JSON.stringify(duplicated))).toThrow(/重複/);
    const invalid = sample();
    invalid.transitions[0].to = 'missing-screen';
    expect(() => parseBlueprint(JSON.stringify(invalid))).toThrow(/存在しない画面/);
  });

  it('rejects prototype keys, invalid JSON and excessive nesting', () => {
    expect(() => parseBlueprint('{bad')).toThrow();
    expect(() => parseBlueprint('{"__proto__":{}}')).toThrow(/予約済み/);
    const deep = { nested: {} } as { nested: unknown };
    let cursor = deep.nested as Record<string, unknown>;
    for (let i = 0; i < 50; i++) { cursor.nested = {}; cursor = cursor.nested as Record<string, unknown>; }
    expect(() => parseBlueprint(JSON.stringify(deep))).toThrow(/階層/);
  });

  it('calculates finite coordinates for self and parallel edges', () => {
    const points = arrange(['a', 'b'], [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }, { from: 'a', to: 'b' }]);
    expect(Object.keys(points)).toEqual(['a', 'b']);
    expect(Number.isFinite(points.a.x)).toBe(true);
    expect(Number.isFinite(points.b.y)).toBe(true);
  });

  it('treats a flow with links as a graph and keeps the chain for flows without links', () => {
    const branched = parseBlueprint(JSON.stringify({ schemaVersion: '1.0', title: '分岐', screens: [], transitions: [], layout: { screens: {}, flows: {} },
      flows: [{ id: 'f', name: '判定', steps: [{ id: 'a', name: '開始' }, { id: 'b', name: '承認' }, { id: 'c', name: '差し戻し' }],
        links: [{ id: 'go', from: 'a', to: 'b', condition: '問題なし' }, { id: 'back', from: 'b', to: 'c' }, { id: 'redo', from: 'c', to: 'a', condition: '再提出' }] }] }));
    expect(flowEdges(branched.flows[0])).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]);
    expect(flowConnections(branched.flows[0]).map(c => c.condition)).toEqual(['問題なし', undefined, '再提出']);
    expect(Object.keys(branched.layout.flows.f)).toHaveLength(3);
    const chained = sample();
    expect(flowEdges(chained.flows[1])).toEqual([{ from: 'receive', to: 'close' }]);
    expect(flowConnections(chained.flows[0]).map(c => c.id)).toEqual(['start', 'approve', 'retry']);
  });

  it('rejects flow links with duplicate IDs or missing step references', () => {
    const base = { schemaVersion: '1.0', title: 'x', screens: [] as unknown[], transitions: [] as unknown[], layout: { screens: {}, flows: {} },
      flows: [{ id: 'f', name: 'f', steps: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], links: [{ id: 'l', from: 'a', to: 'b' }] }] };
    const dup = structuredClone(base); dup.flows[0].links.push({ id: 'l', from: 'b', to: 'a' });
    expect(() => parseBlueprint(JSON.stringify(dup))).toThrow(/重複/);
    const missing = structuredClone(base); missing.flows[0].links[0].to = 'ghost';
    expect(() => parseBlueprint(JSON.stringify(missing))).toThrow(/存在しない工程/);
  });

  it('counts flow link additions and removals in the update diff', () => {
    const before = sample();
    const after = sample();
    after.flows[0].links = (after.flows[0].links ?? []).filter(l => l.id !== 'retry');
    after.flows[0].links?.push({ id: 'direct', from: 'find', to: 'lend' });
    const links = diff(before, after).find(d => d.label === '接続');
    expect(links?.removed).toEqual([JSON.stringify(['lending', 'retry'])]);
    expect(links?.added).toEqual([JSON.stringify(['lending', 'direct'])]);
  });
});

describe('routeBetween', () => {
  const edges = [
    { id: 'e1', from: 'a', to: 'b' },
    { id: 'e2', from: 'b', to: 'c' },
    { id: 'e3', from: 'a', to: 'c' },
    { id: 'e4', from: 'c', to: 'a' },
  ];
  it('prefers the direct edge over the long way around', () => {
    expect(routeBetween(edges, 'a', 'c')).toEqual({ nodeIds: ['a', 'c'], edgeIds: ['e3'] });
  });
  it('chains multiple hops in order', () => {
    expect(routeBetween(edges, 'b', 'a')).toEqual({ nodeIds: ['b', 'c', 'a'], edgeIds: ['e2', 'e4'] });
  });
  it('returns null when unreachable and a trivial route for the same node', () => {
    expect(routeBetween(edges, 'c', 'x')).toBeNull();
    expect(routeBetween(edges, 'a', 'a')).toEqual({ nodeIds: ['a'], edgeIds: [] });
  });
});

describe('routeCone', () => {
  const edges = [
    { id: 'g1', from: 'a', to: 'b' },
    { id: 'g2', from: 'a', to: 'c' },
    { id: 'g3', from: 'c', to: 'b' },
    { id: 'g4', from: 'a', to: 'd' },
    { id: 'g5', from: 'd', to: 'e' },
    { id: 'g6', from: 'b', to: 'c' },
  ];
  it('includes detours and cycles on some route, excludes dead ends', () => {
    const cone = routeCone(edges, 'a', 'b');
    expect(new Set(cone?.nodeIds)).toEqual(new Set(['a', 'b', 'c']));
    expect(new Set(cone?.edgeIds)).toEqual(new Set(['g1', 'g2', 'g3', 'g6']));
  });
  it('follows the branch that actually reaches the target', () => {
    const cone = routeCone(edges, 'a', 'e');
    expect(new Set(cone?.nodeIds)).toEqual(new Set(['a', 'd', 'e']));
    expect(new Set(cone?.edgeIds)).toEqual(new Set(['g4', 'g5']));
  });
  it('returns null when no route exists', () => {
    expect(routeCone(edges, 'b', 'd')).toBeNull();
  });
  it('does not count routes that pass through the start a second time', () => {
    const loop = [
      { id: 'h1', from: 's', to: 'm' },
      { id: 'h2', from: 'm', to: 's' },
      { id: 'h3', from: 's', to: 't' },
      { id: 'h4', from: 's', to: 'r' },
      { id: 'h5', from: 'r', to: 't' },
    ];
    const cone = routeCone(loop, 's', 't');
    expect(new Set(cone?.nodeIds)).toEqual(new Set(['s', 'r', 't']));
    expect(new Set(cone?.edgeIds)).toEqual(new Set(['h3', 'h4', 'h5']));
  });
});
