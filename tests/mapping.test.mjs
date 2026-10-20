import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '');

function createHarness() {
  let messageListener;
  const calls = [];
  const chrome = {
    sidePanel: { setPanelBehavior: async () => ({}) },
    runtime: { onMessage: { addListener: (fn) => { messageListener = fn; } } },
    storage: { local: { get: async () => ({}), set: async () => ({}) } },
    tabs: { sendMessage: () => { throw new Error('MAP_FIELDS must not message the page to fill'); } }
  };
  const storageManager = { getKeys: async () => ({ apiUrl: 'http://127.0.0.1:8790', aiModel: '' }) };
  class HermesClient {
    constructor(apiUrl) { this.apiUrl = apiUrl; this.modelo = ''; }
    async fill(fields) {
      calls.push({ method: 'fill', fields });
      return {
        filled: [{ id: 'frame-0--name', type: 'text', value: 'Angelo Rosa', source: 'perfil' }],
        unmatched: [
          { id: 'frame-0--work', type: 'radio', reason: 'escolher entre as opções', options: ['Remoto', 'Híbrido'] },
          { id: 'frame-0--open', type: 'textarea', reason: 'resposta subjetiva, requer aprovação' }
        ]
      };
    }
    async fillMatch(fields, contexto) {
      calls.push({ method: 'fillMatch', fields, contexto });
      return { filled: [{ id: 'frame-0--work', type: 'radio', value: 'Remoto', source: 'ia+opcao' }] };
    }
  }
  vm.runInNewContext(source, { chrome, storageManager, HermesClient, console });
  return { calls, send: (message) => new Promise((resolve) => {
    const returned = messageListener(message, {}, resolve);
    assert.equal(returned, true, 'async message handler should keep the channel open');
  }) };
}

test('MAP_FIELDS returns mappings and unresolved fields without applying values to the page', async () => {
  const { calls, send } = createHarness();
  const response = await send({
    type: 'MAP_FIELDS',
    payload: {
      contexto: 'Senior Product Designer',
      fields: [
        { id: 'frame-0--name', question: 'Nome completo', type: 'text', required: true, options: [] },
        { id: 'frame-0--work', question: 'Modalidade', type: 'radio', options: [{ label: 'Remoto' }, { label: 'Híbrido' }] },
        { id: 'frame-0--open', question: 'Conte sobre você', type: 'textarea', options: [] }
      ]
    }
  });

  assert.equal(response.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.results.map((item) => [item.fieldId, item.value]))), [
    ['frame-0--name', 'Angelo Rosa'],
    ['frame-0--work', 'Remoto']
  ]);
  assert.equal(response.unmatched.length, 1);
  assert.equal(response.unmatched[0].id, 'frame-0--open');
  assert.deepEqual(calls.map((call) => call.method), ['fill', 'fillMatch']);
  assert.equal(calls[0].fields[0].label, 'Nome completo');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].fields[0].options)), ['Remoto', 'Híbrido']);
  assert.equal(calls[1].contexto, 'Senior Product Designer');
});
