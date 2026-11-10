import { describe, expect, it } from 'vitest';
import { arrange, convertDomain, diff, parseBlueprint, withLayout } from './model';
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
});
