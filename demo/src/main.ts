import { demoStore } from '../../src/domain/accounts';
import type { TurnMetrics } from '../../src/latency/turn-tracker';
import { systemPrompt } from '../../src/prompts/system-prompt';
import { ScriptedModel, energyBrain } from '../../src/session/scripted-model';
import { VoiceSession, type AgentEvent } from '../../src/session/session';
import { energyTools } from '../../src/tools/energy-tools';
import { ToolRegistry } from '../../src/tools/registry';
import { createTour } from './tour';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const BUDGET_MS = 800;
const SUGGESTIONS = [
  "What's my balance?",
  'Am I in credit?',
  'My power has gone off',
  'Is there a power cut in M14 5RT?',
  'My electricity meter reading is 12345',
  'My gas meter reading is 0 4 5 1 2',
  'Electricity reading 11000',
  'I can smell gas',
  'Can I talk to a person?',
  'Erm, the thing with my account',
];

const transcript = $<HTMLOListElement>('transcript');
const proto = $<HTMLOListElement>('proto');
const input = $<HTMLInputElement>('utterance');

let session: VoiceSession | undefined;
let audioChunks = 0;
let speakingBubble: HTMLLIElement | undefined;
const toolCalls = new Map<string, number>();

// ---- tools panel ----------------------------------------------------------------

const registry = new ToolRegistry(energyTools(demoStore(), () => {}));
$('tools').innerHTML = registry
  .specs()
  .map(
    (t) =>
      `<li data-tool="${t.name}"><div><code>${t.name}</code><span class="desc">${esc(t.description)}</span></div><span class="calls">0 calls</span></li>`,
  )
  .join('');

function hitTool(name: string) {
  toolCalls.set(name, (toolCalls.get(name) ?? 0) + 1);
  const li = document.querySelector<HTMLLIElement>(`[data-tool="${name}"]`);
  if (!li) return;
  li.querySelector('.calls')!.textContent =
    `${toolCalls.get(name)} call${toolCalls.get(name) === 1 ? '' : 's'}`;
  li.classList.add('hit');
  setTimeout(() => li.classList.remove('hit'), 1200);
}

// ---- transcript -----------------------------------------------------------------

const IVR_ICON =
  '<svg viewBox="0 0 28 20" aria-hidden="true"><rect x="0" y="7" width="3" height="6" rx="1.5"/><rect x="6" y="3" width="3" height="14" rx="1.5"/><rect x="12" y="0" width="3" height="20" rx="1.5"/><rect x="18" y="4" width="3" height="12" rx="1.5"/><rect x="24" y="7" width="3" height="6" rx="1.5"/></svg>';

function add(html: string, cls: string): HTMLLIElement {
  transcript.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = html;
  transcript.append(li);
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

function callerInitials() {
  const sel = $<HTMLSelectElement>('caller');
  return sel.selectedIndex === 2
    ? '??'
    : sel.options[sel.selectedIndex]!.text.slice(0, 2).toUpperCase();
}

function speak(text: string) {
  if (!$<HTMLInputElement>('speak').checked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  speechSynthesis.speak(u);
}

// ---- latency waterfall ----------------------------------------------------------

function addTurn(m: TurnMetrics) {
  const list = $('waterfall');
  list.querySelector('.wf-empty')?.remove();
  const toolMs = m.tools.reduce((a, t) => a + t.ms, 0);
  const scale = Math.max(BUDGET_MS * 1.25, (m.ttfaMs ?? 0) + toolMs);
  const pct = (v: number) => `${((v / scale) * 100).toFixed(1)}%`;
  const ttfa = m.ttfaMs ?? 0;
  const li = document.createElement('li');
  li.className = 'wf-row';
  li.innerHTML = `
    <div class="wf-top"><b>Turn ${m.turn}</b><span>${m.ttfaMs !== undefined ? `${Math.round(ttfa)} ms to first audio` : 'no audio'}${m.bargeIns ? ` · ${m.bargeIns} barge-in` : ''}</span></div>
    <div class="wf-track">
      <i class="ttfa ${ttfa > BUDGET_MS ? 'over' : ''}" style="left:0;width:${pct(ttfa)}"></i>
      ${m.tools.map((t, i) => `<i class="tl" style="left:${pct(ttfa + m.tools.slice(0, i).reduce((a, x) => a + x.ms, 0))};width:max(4px,${pct(t.ms)})" title="${t.name} ${t.ms}ms"></i>`).join('')}
      <span class="budget" style="left:${pct(BUDGET_MS)}" title="800 ms budget"></span>
    </div>
    <div class="wf-legend"><span><i style="background:var(--blue)"></i>first audio</span>${m.tools.map((t) => `<span><i style="background:#8b5cf6"></i>${t.name} ${t.ms} ms</span>`).join('')}</div>`;
  list.prepend(li);
}

// ---- protocol stream ------------------------------------------------------------

function protoName(e: unknown): string {
  const o = e as { event?: Record<string, unknown>; kind?: string };
  if (o.event) return Object.keys(o.event)[0]!;
  return o.kind ?? 'event';
}

function addProto(direction: 'in' | 'out', event: unknown) {
  proto.querySelector('.tray-empty')?.remove();
  const name = protoName(event);
  const body = JSON.stringify(event, null, 2);
  const peek = JSON.stringify(
    (event as { event?: Record<string, unknown> }).event?.[name] ?? event,
  ).slice(0, 140);
  const li = document.createElement('li');
  li.className = `p ${direction}`;
  li.innerHTML = `<details><summary><span class="dir">${direction === 'in' ? '→' : '←'}</span><span class="name">${esc(name)}</span><span class="peek">${esc(peek)}</span></summary><pre class="code">${esc(body)}</pre></details>`;
  proto.append(li);
  if (proto.children.length > 400) proto.firstElementChild?.remove();
  proto.scrollTop = proto.scrollHeight;
}

$('show-in').addEventListener('change', (e) =>
  proto.classList.toggle('hide-in', !(e.target as HTMLInputElement).checked),
);
$('show-out').addEventListener('change', (e) =>
  proto.classList.toggle('hide-out', !(e.target as HTMLInputElement).checked),
);
$('clear').addEventListener('click', () => {
  proto.innerHTML = '';
});

// ---- session events -------------------------------------------------------------

function onEvent(e: AgentEvent) {
  switch (e.type) {
    case 'started':
      $('session-no').textContent = `Session ${e.sessionNumber}`;
      break;
    case 'user_transcript':
      add(
        `<span class="who">${esc(callerInitials())}</span><div><div class="bubble">${esc(e.text)}</div></div>`,
        'msg me',
      );
      break;
    case 'assistant_text':
      if (e.speculative) {
        speakingBubble = add(
          `<span class="who">${IVR_ICON}</span><div><div class="bubble spec">${esc(e.text)}</div><span class="meta">speculative</span></div>`,
          'msg sys speaking',
        );
      } else {
        if (speakingBubble) {
          speakingBubble.querySelector('.bubble')!.classList.remove('spec');
          speakingBubble.querySelector('.meta')!.textContent = 'spoken';
          speakingBubble.classList.remove('speaking');
          speakingBubble = undefined;
        }
        speak(e.text);
      }
      break;
    case 'audio':
      audioChunks++;
      $('audio-count').textContent = `${audioChunks} audio chunks`;
      break;
    case 'tool_call':
      hitTool(e.name);
      add(`<span class="tool-chip">⚙ <b>${esc(e.name)}</b> ${esc(e.input)}</span>`, 'msg tool');
      break;
    case 'tool_result': {
      add(
        `<span class="tool-chip ${e.ok ? '' : 'err'}">↳ <b>${esc(e.name)}</b> ${e.ms} ms · ${esc(JSON.stringify(e.output))}</span>`,
        'msg tool',
      );
      const out = e.output as { transferring?: boolean };
      if (out?.transferring) {
        $('handoff').hidden = false;
        $('handoff-title').textContent =
          e.name === 'transfer_to_emergency'
            ? 'Transferring to the gas emergency line'
            : 'Transferring to an agent';
        $('handoff-detail').textContent =
          'In production the telephony layer bridges the call here.';
      }
      break;
    }
    case 'interrupted':
      if (speakingBubble) {
        speakingBubble.querySelector('.meta')!.textContent = 'cut off by caller';
        speakingBubble.classList.remove('speaking');
        speakingBubble = undefined;
      }
      speechSynthesis?.cancel();
      add('Caller barged in, playback flushed', 'msg event');
      break;
    case 'turn_complete':
      addTurn(e.metrics);
      break;
    case 'renewing':
      add(`Renewing connection (${esc(e.reason)}), replaying history`, 'msg event renew');
      break;
    case 'protocol':
      addProto(e.direction, e.event);
      break;
    case 'error':
      add(`Error: ${esc(e.error.message)}`, 'msg note');
      break;
  }
}

// ---- controls -------------------------------------------------------------------

function setChips(on: boolean) {
  const chips = $('chips');
  chips.innerHTML = on
    ? SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join('')
    : '';
}
$('chips').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b) send(b.textContent ?? '');
});

function send(text: string) {
  if (!session || !text.trim()) return;
  session.sendText(text.trim());
  input.value = '';
}

$('say').addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});

function setLive(live: boolean) {
  $('status-wrap').classList.toggle('live', live);
  $('status').textContent = live ? 'Connected' : 'Session ended';
  $<HTMLButtonElement>('start').hidden = live;
  $<HTMLButtonElement>('stop').hidden = !live;
  $<HTMLButtonElement>('renew').disabled = !live;
  $<HTMLSelectElement>('caller').disabled = live;
  input.disabled = !live;
  $<HTMLButtonElement>('send').disabled = !live;
  $<HTMLButtonElement>('mic').disabled = !live;
  input.placeholder = live
    ? 'Say something, or interrupt while it speaks'
    : 'Start a session first';
  setChips(live);
  if (live) input.focus({ preventScroll: true });
}

async function start() {
  transcript.innerHTML = '';
  $('handoff').hidden = true;
  audioChunks = 0;
  const latency = () => ({
    asrMs: 220,
    firstAudioMs: 300 + Math.round(Math.random() * 350),
    chunkMs: 45,
  });
  session = new VoiceSession({
    transport: new ScriptedModel(energyBrain, latency()),
    tools: new ToolRegistry(
      energyTools(demoStore(), () => {}).map((t) => ({
        ...t,
        // Simulate a network hop so tool bars are visible.
        run: async (i: never, ctx: Parameters<typeof t.run>[1]) => {
          await new Promise((r) => setTimeout(r, 60 + Math.random() * 180));
          return t.run(i, ctx);
        },
      })),
    ),
    systemPrompt: systemPrompt('Brightwell Energy'),
    callerPhone: $<HTMLSelectElement>('caller').value,
    traceProtocol: true,
    onEvent,
  });
  await session.start();
  setLive(true);
}

async function stop() {
  await session?.close();
  session = undefined;
  speechSynthesis?.cancel();
  setLive(false);
}

$('start').addEventListener('click', () => void start());
$('stop').addEventListener('click', () => void stop());
$('renew').addEventListener(
  'click',
  () => void session?.forceRenew('manual renewal from the playground'),
);
$('caller').addEventListener('change', () => {
  $('avatar').textContent = callerInitials();
});

type Recognition = {
  lang: string;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  start(): void;
};
const SR = (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
  .webkitSpeechRecognition;
if (SR) {
  const mic = $<HTMLButtonElement>('mic');
  mic.hidden = false;
  mic.addEventListener('click', () => {
    const rec = new SR();
    rec.lang = 'en-GB';
    rec.onresult = (e) => send(e.results[0]![0]!.transcript);
    rec.start();
  });
}

// ---- tour -------------------------------------------------------------------------

const tour = createTour('voice-agent', [
  {
    target: '#agent',
    title: 'A live agent session',
    body: 'This runs the real <code>VoiceSession</code>: it opens the Nova Sonic event stream, sends the system prompt, handles tool calls and tracks latency. Only the model itself is scripted.',
  },
  {
    target: '.controls',
    title: 'Start a session',
    body: 'Pick a caller and press the green button. Arben and Lena are known customers with different postcodes; the unknown number shows how the agent avoids guessing.',
  },
  {
    target: '#chips',
    title: 'Talk to it',
    body: 'Use a suggestion or type your own. To <b>barge in</b>, send something while the agent is still speaking: the stream signals an interruption and playback is flushed.',
  },
  {
    target: '#latency-block',
    title: 'Latency per turn',
    body: "Time from the end of the caller's turn to the first audio chunk, plus each tool round trip, against an 800 ms budget.",
  },
  {
    target: '#tools-block',
    title: 'Tools the model can call',
    body: 'Balance, meter readings, power cut checks and transfers. They light up when called. Bad input or a slow backend becomes a structured error, never a dead session.',
  },
  {
    target: '#renew',
    title: 'Session renewal',
    body: 'Nova Sonic connections are capped at 8 minutes. The session renews before that and replays recent turns as text history. Force it here to see the events.',
  },
  {
    target: '#protocol-block',
    title: 'The raw protocol',
    body: 'Every event on the bidirectional stream: <code>sessionStart</code>, <code>promptStart</code> with tool schemas, <code>contentStart</code>, <code>toolUse</code>, <code>toolResult</code>. Click one to see its JSON.',
  },
]);
$('tour-btn').addEventListener('click', () => tour.open());
tour.autoStart();
