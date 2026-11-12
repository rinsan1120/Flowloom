import { parseBlueprint } from './model';
// Fictional data only. Never replace this fixture with a real project export.
export const sample = () => parseBlueprint(JSON.stringify({ schemaVersion: '1.0', title: '小さな図書室',
  screens: [
    { id: 'home', name: '本を探す', kind: 'screen', description: '図書室の本を一覧から探します。', actions: ['本の詳細を開く', '貸出記録を見る'] },
    { id: 'book', name: '本の詳細', kind: 'screen', description: 'あらすじと貸出状況を確認します。', actions: ['貸出を申し込む', '一覧へ戻る'] },
    { id: 'confirm', name: '貸出の確認', kind: 'dialog', description: '本の名前と返却期限を確認するダイアログです。', actions: ['確定', 'キャンセル'] },
    { id: 'history', name: '貸出記録', kind: 'unknown', description: '画面種別が未確定の例です。' }
  ], transitions: [
    { id: 'open', from: 'home', to: 'book', action: '詳細を見る' },
    { id: 'back', from: 'book', to: 'home', action: '一覧へ戻る' },
    { id: 'refresh', from: 'home', to: 'home', action: '再検索', condition: '検索語が入力されている' },
    { id: 'borrow', from: 'book', to: 'confirm', action: '貸出を申し込む', condition: '貸出可能な本' },
    { id: 'reserve', from: 'book', to: 'confirm', action: '予約する', condition: '貸出中の本', note: '同じ接続先への別の操作です。' },
    { id: 'cancel', from: 'confirm', to: 'book', action: 'キャンセル' },
    { id: 'records', from: 'home', to: 'history', action: '記録を見る' }
  ], flows: [
    { id: 'lending', name: '本を借りる', actor: '利用者', steps: [ { id: 'find', name: '本を探す', description: '読みたい本を選びます。' }, { id: 'check', name: '貸出状況を確認', condition: '本が選択されている' }, { id: 'lend', name: '貸出を確定', description: '返却期限を記録します。', condition: '貸出可能である' } ],
      links: [ { id: 'start', from: 'find', to: 'check' }, { id: 'approve', from: 'check', to: 'lend', condition: '貸出可能である' }, { id: 'retry', from: 'check', to: 'find', condition: '貸出中は別の本を探す' } ] },
    { id: 'return', name: '本を返す', steps: [ { id: 'receive', name: '本を受け取る' }, { id: 'close', name: '返却を記録' } ] }
  ], layout: { screens: {}, flows: {} } }));
