"use strict";

/* ===================== Utilidades ===================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const unique = (list) => [...new Set(list)];

const TAPE_CELLS = 50;    // la cinta se simula con 50 celdas y crece si hace falta
const MAX_STEPS = 5000;   // límite para detectar posibles bucles infinitos
const CELL_WIDTH = 50;
const STORAGE_KEY = "turinglab.programs";
const TAPES_KEY = "turinglab.tapes";
const STATE_COLORS = ["violet", "blue", "pink", "teal", "yellow", "orange"];
/** Movimientos del proyecto: D = derecha, I = izquierda, S = sin mover. */
const MOVES = { D: "→ derecha", I: "← izquierda", S: "• sin mover" };
const LEGACY_MOVES = { R: "D", L: "I", N: "S", D: "D", I: "I", S: "S" };

/** Datos vigentes de la máquina; los usan el render y la ejecución. */
const machine = { initial: "q0", finals: new Set(["q✓"]), blank: "^", sentinel: "#", sentinelOn: false };
const BLANK_FALLBACK = "^";
let BLANK = BLANK_FALLBACK; // se mantiene sincronizado con machine.blank (lo usan las variantes)

/** Color estable para cada estado. Los finales son verdes y el inicial violeta. */
function stateColor(state) {
  if (machine.finals.has(state)) return "accept";
  if (state === machine.initial) return "violet";
  let hash = 0;
  for (const char of state) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return STATE_COLORS[hash % STATE_COLORS.length];
}
/** Color por símbolo: 1 y 0 fijos; blanco y centinela especiales; las demás letras, uno de cuatro colores. */
function symbolClass(s) {
  if (s === machine.blank) return "sym-blank";
  if (machine.sentinelOn && s === machine.sentinel) return "sym-sentinel";
  if (s === "1") return "sym-one";
  if (s === "0") return "sym-zero";
  return `sym-other sym-c${(s.codePointAt(0) || 0) % 4}`;
}
/** "0, 1" o "01" → ["0", "1"]: cada carácter es un símbolo. */
const parseSymbols = (text) => unique([...String(text).replace(/[,;\s]+/g, "")]);
/** "q0, q1 q2" → ["q0", "q1", "q2"]: cada palabra es un estado (máx. 8 caracteres). */
const parseStates = (text) => unique(String(text).split(/[,;\s]+/).map((s) => s.trim().slice(0, 8)).filter(Boolean));
const cleanStateName = (v, fallback) => String(v).trim().replace(/\s+/g, "").slice(0, 8) || fallback;
const toRule = ([state, read, write, move, next]) => ({ state, read, write, move: LEGACY_MOVES[move] || "D", next });
const fromRule = (r) => [r.state, r.read, r.write, r.move, r.next];

/** Cadena aleatoria de `length` símbolos del alfabeto. Con preferPalindrome, la mitad de las veces es palíndromo. */
function randomBits(preferPalindrome = false, length = TAPE_CELLS, alphabet = ["0", "1"]) {
  const bits = (n) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  if (preferPalindrome && Math.random() < .5) {
    const half = bits(Math.floor(length / 2));
    return half + (length % 2 ? bits(1) : "") + [...half].reverse().join("");
  }
  return bits(length);
}

/* ===================== Ejemplos incluidos (cadenas de 50 símbolos) ===================== */
/* Se escriben con la notación clásica (R/L/N y "_") y se convierten a D/I/S y "^" al cargarlos. */
const EXAMPLES = {
  invert: {
    name: "Invertir bits", alphabet: "01",
    input: "10100010000110001000010000110010001000011111110000",
    description: "Recorre la cinta cambiando cada 1 por 0 y cada 0 por 1. Acepta al llegar al blanco.",
    rules: [["q0", "1", "0", "R", "q0"], ["q0", "0", "1", "R", "q0"], ["q0", "_", "_", "N", "q✓"]]
  },
  increment: {
    name: "Sumar 1 en binario", alphabet: "01",
    input: "11111001010110011111001100111110110010010011011111",
    description: "Va al final y retrocede convirtiendo los 1 en 0 hasta encontrar un 0 o un blanco.",
    rules: [
      ["q0", "0", "0", "R", "q0"], ["q0", "1", "1", "R", "q0"], ["q0", "_", "_", "L", "q1"],
      ["q1", "1", "0", "L", "q1"], ["q1", "0", "1", "N", "q✓"], ["q1", "_", "1", "N", "q✓"]
    ]
  },
  parity: {
    name: "Paridad de unos", alphabet: "01",
    input: "10011101111100000000101100111001111101100001001000",
    description: "q0 = par, q1 = impar. Acepta solo si la cantidad de unos es par.",
    rules: [
      ["q0", "0", "0", "R", "q0"], ["q0", "1", "1", "R", "q1"], ["q0", "_", "P", "N", "q✓"],
      ["q1", "0", "0", "R", "q1"], ["q1", "1", "1", "R", "q0"]
    ]
  },
  sentinel: {
    name: "Invertir con centinelas #", alphabet: "01", sentinel: "#",
    input: "01101001110010110100011101001011000111010010110100",
    description: "Parte del # izquierdo, invierte hasta el # derecho y regresa al # izquierdo para aceptar.",
    rules: [
      ["q0", "#", "#", "R", "q1"],
      ["q1", "0", "1", "R", "q1"], ["q1", "1", "0", "R", "q1"], ["q1", "#", "#", "L", "q2"],
      ["q2", "0", "0", "L", "q2"], ["q2", "1", "1", "L", "q2"], ["q2", "#", "#", "N", "q✓"]
    ]
  },
  anbn: {
    name: "Letras: ¿es aⁿbⁿ?", alphabet: "ab",
    input: "aaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbb",
    random: () => {
      if (Math.random() < .5) return "a".repeat(25) + "b".repeat(25);
      const k = 1 + Math.floor(Math.random() * 49);
      return Math.random() < .5 ? "a".repeat(k) + "b".repeat(50 - k) : randomBits(false, 50, ["a", "b"]);
    },
    description: "Acepta cadenas con n letras a seguidas de n letras b. Marca cada a con X y su b con Y.",
    rules: [
      ["q0", "a", "X", "R", "q1"], ["q0", "Y", "Y", "R", "q3"], ["q0", "_", "_", "N", "q✓"],
      ["q1", "a", "a", "R", "q1"], ["q1", "Y", "Y", "R", "q1"], ["q1", "b", "Y", "L", "q2"],
      ["q2", "a", "a", "L", "q2"], ["q2", "Y", "Y", "L", "q2"], ["q2", "X", "X", "R", "q0"],
      ["q3", "Y", "Y", "R", "q3"], ["q3", "_", "_", "N", "q✓"]
    ]
  },
  palindrome: {
    name: "¿Es palíndromo?", alphabet: "01", preferPalindrome: true,
    input: "00100010111100111110001111110001111100111101000100",
    description: "Borra el primer símbolo, viaja al final y comprueba que coincida. Repite hasta vaciar la cinta.",
    rules: [
      ["q0", "0", "_", "R", "a0"], ["q0", "1", "_", "R", "a1"], ["q0", "_", "_", "N", "q✓"],
      ["a0", "0", "0", "R", "a0"], ["a0", "1", "1", "R", "a0"], ["a0", "_", "_", "L", "b0"],
      ["a1", "0", "0", "R", "a1"], ["a1", "1", "1", "R", "a1"], ["a1", "_", "_", "L", "b1"],
      ["b0", "0", "_", "L", "v"], ["b0", "_", "_", "N", "q✓"],
      ["b1", "1", "_", "L", "v"], ["b1", "_", "_", "N", "q✓"],
      ["v", "0", "0", "L", "v"], ["v", "1", "1", "L", "v"], ["v", "_", "_", "R", "q0"]
    ]
  }
};

/** Convierte un ejemplo a una configuración completa M = (Q, Σ, Γ, δ, q0, blanco, F). */
function exampleProgram(key) {
  const ex = EXAMPLES[key];
  const blank = "^";
  const rules = ex.rules.map(([s, r, w, m, n]) => [s, r === "_" ? blank : r, w === "_" ? blank : w, LEGACY_MOVES[m], n]);
  const alphabet = [...ex.alphabet];
  const extra = unique(rules.flatMap((r) => [r[1], r[2]])).filter((c) => !alphabet.includes(c) && c !== blank && c !== ex.sentinel);
  return {
    id: `example:${key}`, example: key, name: ex.name, description: ex.description,
    states: unique(["q0", ...rules.flatMap((r) => [r[0], r[4]])]), initial: "q0", finals: ["q✓"],
    alphabet, extra, blank, sentinel: ex.sentinel || "", input: ex.input, start: 0, rules
  };
}

/* ===================== Configuraciones guardadas (localStorage) ===================== */
const storage = {
  load(key) {
    try { const list = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(list) ? list : []; }
    catch { return []; }
  },
  save(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch { return false; }
  }
};

/** Valida y completa una configuración leída de archivo o almacenamiento (incluye las de versiones anteriores). */
function normalizeProgram(raw) {
  if (!raw || !Array.isArray(raw.rules)) return null;
  const legacy = !raw.blank; // versiones anteriores usaban "_" como blanco y R/L/N
  const blank = String(raw.blank || "_").slice(0, 1);
  const rules = raw.rules.map((r) => (Array.isArray(r) ? r : fromRule(r)))
    .filter((r) => r.length === 5 && LEGACY_MOVES[r[3]])
    .map((r) => [cleanStateName(r[0], "q0"), String(r[1]).slice(0, 1) || blank, String(r[2]).slice(0, 1) || blank, LEGACY_MOVES[r[3]], cleanStateName(r[4], "q0")]);
  const sentinel = typeof raw.sentinel === "string" && raw.sentinel.length === 1 ? raw.sentinel : "";
  const input = String(raw.input || "").slice(0, TAPE_CELLS);
  const alphabet = Array.isArray(raw.alphabet) && raw.alphabet.length ? raw.alphabet.map((c) => String(c).slice(0, 1))
    : unique([...input, ...rules.map((r) => r[1])]).filter((c) => c !== blank && c !== sentinel);
  const initial = cleanStateName(raw.initial || "q0", "q0");
  const finals = Array.isArray(raw.finals) ? raw.finals.map((s) => cleanStateName(s, "")).filter(Boolean) : ["q✓"];
  const states = unique([...(Array.isArray(raw.states) ? raw.states.map((s) => cleanStateName(s, "")).filter(Boolean) : []),
    initial, ...finals, ...rules.flatMap((r) => [r[0], r[4]])]);
  const extra = unique([...(Array.isArray(raw.extra) ? raw.extra : []), ...rules.flatMap((r) => [r[1], r[2]])])
    .map((c) => String(c).slice(0, 1)).filter((c) => c && !alphabet.includes(c) && c !== blank && c !== sentinel);
  return {
    id: raw.id && !String(raw.id).startsWith("example:") ? raw.id : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(raw.name || "Configuración sin nombre").slice(0, 30),
    states, initial, finals, alphabet, extra, blank, sentinel, legacy,
    input, start: Math.max(0, Number.parseInt(raw.start, 10) || 0), rules
  };
}

/* ===================== Simulador ===================== */
function initSimulator() {
  const input = $("#input-string");
  if (!input) return;

  const el = {
    layout: $(".simulator-layout"), panel: $(".machine-panel"), startScreen: $("#start-screen"), machineArea: $("#machine-area"),
    search: $("#config-search"), searchInput: $("#search-input"), searchResults: $("#search-results"), backToRun: $("#back-to-run"),
    configName: $("#config-name-label"), configStatus: $("#config-status"), gate: $("#gate-banner"),
    track: $("#tape-track"), tapeSize: $("#tape-size"), tapeHint: $("#tape-hint"), segment: $("#segment-info"),
    step: $("#step-number"), headPos: $("#head-position"), state: $("#current-state"), read: $("#read-symbol"),
    ruleRead: $("#rule-read"), ruleWrite: $("#rule-write"), ruleMove: $("#rule-move"), transition: $("#transition-text"),
    terna: $("#terna-now"), log: $("#log-rows"), status: $("#machine-status"), dot: $("#status-dot"), logStatus: $("#log-status"),
    run: $("#run-btn"), stepBtn: $("#step-btn"), reset: $("#reset-btn"), result: $("#result-banner"),
    speed: $("#speed"), speedMs: $("#speed-ms"), speedLabel: $("#speed-label"),
    // formulario de configuración
    cfgName: $("#cfg-name"), cfgStates: $("#cfg-states"), cfgInitial: $("#cfg-initial"), cfgBlank: $("#cfg-blank"),
    cfgFinals: $("#cfg-finals"), cfgAlphabet: $("#cfg-alphabet"), cfgExtra: $("#cfg-extra"),
    sentinelOn: $("#sentinel-on"), sentinelSymbol: $("#sentinel-symbol"), inputCount: $("#input-count"), startCell: $("#start-cell"),
    stateList: $("#state-list"), ruleList: $("#rule-list"), ruleCount: $("#rule-count"), ruleTitle: $("#rule-title"),
    editor: $("#rule-editor-rows"), stateOptions: $("#state-options"), symbolOptions: $("#symbol-options"),
    message: $("#rule-message"), deleteProgram: $("#delete-program"), importFile: $("#import-file"),
    // modo manual
    mState: $("#m-state"), mRead: $("#m-read"), mGoal: $("#manual-goal"), mWrite: $("#m-write"), mMove: $("#m-move"),
    mNextMode: $("#m-next-mode"), mNextPick: $("#m-next-pick"), mNextSelect: $("#m-next-select"), mCustom: $("#m-next-custom"),
    mNote: $("#manual-note"), mApply: $("#m-apply"), mUndo: $("#m-undo"), mName: $("#m-name"), mSave: $("#m-save"),
    mCount: $("#m-count"), recorded: $("#recorded-tapes"), recordedList: $("#recorded-list")
  };
  const EMPTY_LOG = '<div class="empty-log">El historial aparecerá aquí paso a paso.</div>';
  const sim = {
    mode: "auto", configured: false, dirty: false, programId: null,
    rules: [], draft: [], manualRules: [], history: [],
    cells: [], original: [], head: 0, start: 0, steps: 0, state: "q0", timer: null, running: false, done: false
  };
  const manual = { write: "keep", move: "D", nextMode: "stay" };
  const isManual = () => sim.mode === "manual";
  const activeRules = () => (isManual() ? sim.manualRules : sim.rules);
  const findRule = (rules, state, symbol) => rules.find((r) => r.state === state && r.read === symbol);
  const setRunLabel = (text, icon) => { el.run.innerHTML = `${text} <span>${icon}</span>`; };
  const setStatus = (kind, text) => { el.status.textContent = text; el.dot.className = `status-dot ${kind}`; };
  const setMessage = (text, error = false) => { el.message.className = `rule-message${error ? " error" : ""}`; el.message.innerHTML = text; };
  const stop = () => { clearTimeout(sim.timer); sim.running = false; };
  const delay = () => Math.max(0, Number.parseInt(el.speedMs.value, 10) || 0);
  const canRun = () => sim.configured && !sim.dirty;

  /* ---------- Lectura del formulario de configuración ---------- */
  const formStates = () => parseStates(el.cfgStates.value);
  const formAlphabet = () => parseSymbols(el.cfgAlphabet.value);
  const formBlank = () => el.cfgBlank.value.slice(0, 1) || BLANK_FALLBACK;
  const formFinals = () => $$(".final-chip.on", el.cfgFinals).map((b) => b.dataset.state);
  /** Γ: alfabeto de la cinta = Σ ∪ símbolos extra ∪ blanco (∪ centinela). */
  const tapeAlphabet = () => unique([...formAlphabet(), ...parseSymbols(el.cfgExtra.value), formBlank(), ...(el.sentinelOn.checked ? [machine.sentinel] : [])]);

  /** Pasa los datos del formulario a `machine` (estado inicial, finales, blanco, centinela). */
  function applyMachine() {
    const states = formStates();
    machine.initial = el.cfgInitial.value || states[0] || "q0";
    machine.finals = new Set(formFinals());
    machine.blank = formBlank();
    BLANK = machine.blank;
    machine.sentinelOn = el.sentinelOn.checked;
    $$(".blank-symbol-text").forEach((n) => { n.textContent = machine.blank; });
    $$(".sentinel-symbol-text").forEach((n) => { n.textContent = machine.sentinel; });
  }

  /** Arma el objeto de configuración con lo que hay en el formulario. */
  function readForm(rules) {
    syncDraft();
    return {
      id: sim.programId, name: el.cfgName.value.trim(), states: formStates(), initial: el.cfgInitial.value,
      finals: formFinals(), alphabet: formAlphabet(), extra: parseSymbols(el.cfgExtra.value), blank: formBlank(),
      sentinel: el.sentinelOn.checked ? machine.sentinel : "", input: cleanInput(), start: sim.start,
      rules: (rules || sim.draft).map(fromRule)
    };
  }

  /** Revisa que la configuración sea coherente. Devuelve la lista de errores (vacía si está bien). */
  function validate(p, { requireRules = true } = {}) {
    const errors = [];
    const gamma = new Set([...p.alphabet, ...p.extra, p.blank, ...(p.sentinel ? [p.sentinel] : [])]);
    if (!p.name) errors.push("Escribe un nombre para la configuración.");
    if (!p.states.length) errors.push("Define al menos un estado en Q.");
    if (!p.states.includes(p.initial)) errors.push("El estado inicial debe pertenecer a Q.");
    if (!p.finals.length) errors.push("Marca al menos un estado final (F).");
    if (!p.alphabet.length) errors.push("Define el alfabeto de entrada Σ.");
    if (p.alphabet.includes(p.blank)) errors.push(`El blanco ${escapeHTML(p.blank)} no puede estar en Σ.`);
    if (p.sentinel && (p.alphabet.includes(p.sentinel) || p.sentinel === p.blank)) errors.push("El centinela debe ser distinto de Σ y del blanco.");
    if (requireRules && !p.rules.length) errors.push("Agrega al menos una transición.");
    const seen = new Set();
    p.rules.forEach(([s, r, w, , n], i) => {
      const row = `Transición ${i + 1}`;
      if (!p.states.includes(s)) errors.push(`${row}: el estado «${escapeHTML(s)}» no está en Q.`);
      if (!p.states.includes(n)) errors.push(`${row}: el estado «${escapeHTML(n)}» no está en Q.`);
      if (!gamma.has(r)) errors.push(`${row}: el símbolo leído «${escapeHTML(r)}» no está en Γ.`);
      if (!gamma.has(w)) errors.push(`${row}: el símbolo escrito «${escapeHTML(w)}» no está en Γ.`);
      if (seen.has(`${s}|${r}`)) errors.push(`${row}: ya existe otra transición para (${escapeHTML(s)}, ${escapeHTML(r)}).`);
      seen.add(`${s}|${r}`);
    });
    const bad = [...p.input].filter((c) => !p.alphabet.includes(c) && c !== p.blank);
    if (bad.length) errors.push(`La cadena tiene símbolos fuera de Σ: ${escapeHTML(unique(bad).join(", "))}.`);
    return errors;
  }

  /** Coloca una configuración en el formulario. */
  function writeForm(p) {
    el.cfgName.value = p.name;
    el.cfgStates.value = p.states.join(", ");
    el.cfgAlphabet.value = p.alphabet.join(", ");
    el.cfgExtra.value = p.extra.join(", ");
    el.cfgBlank.value = p.blank;
    if (p.sentinel) machine.sentinel = p.sentinel;
    el.sentinelSymbol.value = machine.sentinel;
    el.sentinelOn.checked = Boolean(p.sentinel);
    el.sentinelSymbol.disabled = !el.sentinelOn.checked;
    renderStateFields(p.initial, p.finals);
    applyMachine();
    input.value = p.input;
    sim.start = p.start;
    sim.draft = p.rules.map(toRule);
    renderEditor();
  }

  /** Recalcula el selector del estado inicial y los botones de estados finales a partir de Q. */
  function renderStateFields(initial = el.cfgInitial.value, finals = formFinals()) {
    const states = formStates();
    el.cfgInitial.innerHTML = states.map((s) => `<option${s === initial ? " selected" : ""}>${escapeHTML(s)}</option>`).join("");
    el.cfgFinals.innerHTML = states.length
      ? states.map((s) => `<button type="button" class="final-chip${finals.includes(s) ? " on" : ""}" data-state="${escapeHTML(s)}">${escapeHTML(s)}</button>`).join("")
      : '<span class="final-empty">Primero escribe los estados en Q.</span>';
  }

  /* ---------- Estado de la configuración (guardada / sin guardar) ---------- */
  function updateGate() {
    const auto = !isManual();
    const forced = el.startScreen.classList.contains("forced");
    const editing = el.startScreen.classList.contains("editing");
    const showStart = auto && (forced || (!sim.configured && !editing));
    el.startScreen.hidden = !showStart;
    el.machineArea.hidden = showStart;
    el.backToRun.hidden = !sim.configured;
    el.configName.textContent = el.cfgName.value.trim() || "Sin nombre";
    el.configStatus.textContent = sim.dirty ? "Cambios sin guardar" : sim.configured ? "Guardada" : "Sin guardar";
    el.configStatus.className = `badge ${sim.dirty || !sim.configured ? "warn" : "ok"}`;
    const blocked = auto && !canRun();
    el.run.disabled = blocked;
    el.stepBtn.disabled = blocked;
    el.gate.hidden = !blocked;
    el.gate.textContent = !sim.configured
      ? "Completa la configuración en el panel de la derecha y pulsa «Guardar configuración» para poder ejecutar."
      : "Hay cambios sin guardar en la configuración. Pulsa «Guardar configuración» para ejecutar con ellos.";
  }
  function markDirty() {
    if (isManual()) { applyMachine(); reset(); return; }
    if (sim.configured) sim.dirty = true;
    stop();
    applyMachine();
    updateGate();
  }

  /* ---------- Render ---------- */
  function cleanInput() {
    const alphabet = formAlphabet();
    const blank = formBlank();
    let clean = [...input.value].filter((c) => (alphabet.length ? alphabet.includes(c) || c === blank : /[\p{L}\p{N}]/u.test(c)));
    if (el.sentinelOn.checked) clean = clean.filter((c) => c !== machine.sentinel);
    clean = clean.slice(0, TAPE_CELLS).join("");
    if (clean !== input.value) input.value = clean;
    el.inputCount.textContent = `${clean.length}/${TAPE_CELLS} · Σ = {${alphabet.join(", ") || "sin definir"}}`;
    return clean;
  }
  /** Índices de celdas cuyo contenido cambió respecto de la cinta inicial. */
  const modifiedCells = () => sim.cells.map((s, i) => (s !== (sim.original[i] ?? machine.blank) ? i : -1)).filter((i) => i >= 0);

  function renderTape(writtenIndex = -1) {
    const pickable = sim.steps === 0 && !sim.running;
    const modified = new Set(modifiedCells());
    el.track.classList.toggle("pickable", pickable);
    el.tapeHint.hidden = !pickable;
    el.tapeSize.textContent = `${sim.cells.length} celdas`;
    el.track.innerHTML = sim.cells.map((s, i) =>
      `<span class="tape-cell ${symbolClass(s)}${i === sim.head ? " current" : ""}${i === writtenIndex ? " written" : ""}${modified.has(i) ? " modified" : ""}" data-index="${i}" title="Celda ${i}">${escapeHTML(s)}</span>`
    ).join("");
    el.track.style.transform = `translateX(${-(sim.head * CELL_WIDTH + CELL_WIDTH / 2)}px)`;
    if (modified.size) {
      const list = [...modified];
      const lo = Math.min(...list), hi = Math.max(...list);
      el.segment.innerHTML = `Segmento modificado: celdas <b>${lo}</b> a <b>${hi}</b> · ${modified.size} ${modified.size === 1 ? "celda cambiada" : "celdas cambiadas"} · <code>${escapeHTML(sim.cells.slice(lo, hi + 1).join(""))}</code>`;
    } else {
      el.segment.textContent = "Sin modificaciones en la cinta";
    }
    el.terna.innerHTML = ternaHTML();
  }

  /** Terna instantánea (estado, contenido, posición). El contenido va de la celda 0 hasta el último símbolo útil. */
  function ternaHTML() {
    let last = sim.cells.length - 1;
    while (last > sim.head && sim.cells[last] === machine.blank) last--;
    const content = sim.cells.slice(0, last + 1).map((s, i) => (i === sim.head ? `<mark>${escapeHTML(s)}</mark>` : escapeHTML(s))).join("");
    return `(${escapeHTML(sim.state)}, ${content}, ${sim.head})`;
  }

  function renderStates() {
    const states = unique([...formStates(), ...activeRules().flatMap((r) => [r.state, r.next]), sim.state]);
    el.stateList.innerHTML = states.map((s) =>
      `<span class="state-chip c-${stateColor(s)}${s === sim.state ? " active-chip" : ""}" title="${s === machine.initial ? "Estado inicial" : machine.finals.has(s) ? "Estado final" : "Estado"}">${escapeHTML(s)}${s === sim.state ? "<i></i>" : ""}</span>`
    ).join("");
    el.state.className = `state-pill c-${stateColor(sim.state)}`;
    el.state.textContent = sim.state;
  }

  function renderActiveRules() {
    const rules = activeRules();
    el.ruleTitle.textContent = isManual() ? "REGISTRO DEL MODO MANUAL" : "TRANSICIONES GUARDADAS";
    el.ruleCount.textContent = pad(rules.length);
    el.ruleList.innerHTML = rules.length ? rules.map((r) =>
      `<div><b class="tag c-${stateColor(r.state)}">${escapeHTML(r.state)}</b><span>${escapeHTML(r.read)} → ${escapeHTML(r.write)}, ${r.move}</span><b class="tag c-${stateColor(r.next)}">${escapeHTML(r.next)}</b></div>`
    ).join("") : `<p class="rule-empty">${isManual() ? "Cada paso manual registra una transición." : "Aún no hay transiciones guardadas."}</p>`;
    el.mCount.textContent = rules.length;
    renderStates();
  }

  function showPreview() {
    const symbol = sim.cells[sim.head];
    const rule = findRule(activeRules(), sim.state, symbol);
    el.read.textContent = symbol;
    el.ruleRead.textContent = symbol;
    el.ruleWrite.textContent = rule ? rule.write : "?";
    el.ruleMove.textContent = rule ? rule.move : "—";
  }

  /* ---------- Tambores: giran una letra por paso en la dirección del cabezal ---------- */
  const drums = $$(".machine-visual .drum").map((node, i) => ({ node, angle: 0, ratio: i === 0 ? 1 : 2 }));
  const direction = $("#drum-direction");
  const DIRECTION_TEXT = { D: "↻ gira a la derecha", I: "↺ gira a la izquierda", S: "• sin movimiento" };
  function turnDrums(move) {
    const sign = move === "D" ? 1 : move === "I" ? -1 : 0;
    const ms = isManual() ? 400 : delay();
    el.panel.style.setProperty("--turn", `${Math.min(450, Math.max(40, ms * .85))}ms`);
    el.panel.dataset.dir = move;
    direction.textContent = DIRECTION_TEXT[move];
    drums.forEach((drum) => {
      if (sign === 0) {
        drum.node.classList.remove("drum-wiggle");
        void drum.node.offsetWidth;
        drum.node.classList.add("drum-wiggle");
        return;
      }
      drum.angle += sign * drum.ratio * (360 / 26);
      drum.node.style.setProperty("--angle", `${drum.angle}deg`);
    });
  }

  /* ---------- Ciclo de la máquina ---------- */
  function logRow(step, from, symbol, rule) {
    if (el.log.querySelector(".empty-log")) el.log.innerHTML = "";
    const cells = rule
      ? `<b class="tag c-${stateColor(from)}">${escapeHTML(from)}</b><span class="${symbolClass(symbol)}">${escapeHTML(symbol)}</span><span class="${symbolClass(rule.write)}">${escapeHTML(rule.write)}</span><span class="move move-${rule.move}">${rule.move} ${MOVES[rule.move].slice(0, 1)}</span><b class="tag c-${stateColor(rule.next)}">${escapeHTML(rule.next)}</b>`
      : `<span class="log-start">inicio</span><span></span><span></span><span></span><span></span>`;
    el.log.insertAdjacentHTML("beforeend", `<div class="log-row"><span>${pad(step)}</span>${cells}<code class="terna">${ternaHTML()}</code></div>`);
  }

  function reset() {
    stop();
    applyMachine();
    const body = [...cleanInput()];
    const cells = el.sentinelOn.checked ? [machine.sentinel, ...body, machine.sentinel] : body;
    while (cells.length < TAPE_CELLS) cells.push(machine.blank);
    sim.start = Math.min(Math.max(0, sim.start), cells.length - 1);
    Object.assign(sim, { head: sim.start, steps: 0, state: machine.initial, done: false, stoppedByUser: false, cells, original: [...cells], history: [] });
    el.startCell.max = cells.length - 1;
    el.startCell.value = sim.start;
    el.step.textContent = "0";
    el.headPos.textContent = sim.head;
    el.transition.textContent = isManual() ? "Decide qué hace la máquina y pulsa «Aplicar paso»" : "Presiona ejecutar para comenzar";
    el.logStatus.textContent = "Esperando inicio";
    el.log.innerHTML = EMPTY_LOG;
    el.result.hidden = true;
    delete el.panel.dataset.dir;
    direction.textContent = "● en espera";
    setStatus("ready", isManual() ? "MODO MANUAL" : "LISTA PARA EJECUTAR");
    setRunLabel("Ejecutar máquina", "▶");
    renderTape();
    logRow(0, null, null, null);
    renderStates();
    showPreview();
    refreshManual();
    updateGate();
  }

  function setStart(index) {
    if (sim.steps > 0 || sim.running) return;
    sim.start = Math.min(Math.max(0, index), sim.cells.length - 1);
    sim.head = sim.start;
    el.startCell.value = sim.start;
    el.headPos.textContent = sim.head;
    el.log.innerHTML = "";
    logRow(0, null, null, null);
    renderTape();
    showPreview();
    refreshManual();
  }

  /** Explica por qué no hubo transición, para que el rechazo no parezca un error del simulador. */
  function rejectionHint(symbol) {
    const usesSymbol = activeRules().some((r) => r.read === symbol);
    if (machine.sentinelOn && symbol === machine.sentinel && !usesSymbol) {
      return `Esta configuración no tiene transiciones que lean el centinela ${machine.sentinel}. Desactiva los centinelas o agrega una transición que lo lea.`;
    }
    if (!usesSymbol) return `Ninguna transición lee el símbolo «${symbol}». Si la cinta usa ese símbolo, agrega transiciones para él.`;
    return `Hay transiciones que leen «${symbol}», pero ninguna para el estado ${sim.state}. Agrega δ(${sim.state}, ${symbol}) si la máquina debe continuar.`;
  }

  function finish(accepted, reason, symbol) {
    stop();
    sim.done = true;
    const text = accepted ? `Cadena aceptada: llegó al estado final ${sim.state}`
      : reason === "limit" ? `Detenida tras ${MAX_STEPS} pasos: posible bucle infinito`
      : reason === "user" ? `Detenida por el usuario en ${sim.state}, que no es estado final`
      : `Rechazada: no hay transición para (${sim.state}, ${symbol})`;
    const hint = accepted || reason !== "norule" ? "" : rejectionHint(symbol);
    setStatus(accepted ? "accept" : "reject", accepted ? "ACEPTADA" : reason === "user" ? "DETENIDA" : "RECHAZADA");
    el.logStatus.textContent = text;
    el.result.className = `result-banner ${accepted ? "accept" : "reject"}`;
    el.result.innerHTML = `<b>${accepted ? "✓" : "✕"}</b><span>${escapeHTML(text)}<small>${sim.steps} ${sim.steps === 1 ? "paso" : "pasos"} · terna final ${ternaHTML()}</small>${hint ? `<em class="result-hint">${escapeHTML(hint)}</em>` : ""}</span>`;
    el.result.hidden = false;
    setRunLabel("Ejecutar de nuevo", "↻");
    renderTape();
    renderStates();
    refreshManual();
  }

  /** Ejecuta una transición sobre la cinta. `animate` = false en 0 ms. Devuelve true si puede continuar. */
  function applyRule(rule, symbol, animate = true) {
    const from = sim.state;
    let written = sim.head;
    sim.cells[sim.head] = rule.write;
    sim.steps++;
    sim.state = rule.next;
    sim.head += rule.move === "D" ? 1 : rule.move === "I" ? -1 : 0;
    if (sim.head < 0) { sim.cells.unshift(machine.blank); sim.original.unshift(machine.blank); sim.head = 0; written++; }
    if (sim.head >= sim.cells.length) { sim.cells.push(machine.blank); sim.original.push(machine.blank); }
    logRow(sim.steps, from, symbol, rule);

    if (animate) {
      el.step.textContent = sim.steps;
      el.headPos.textContent = sim.head;
      el.read.textContent = symbol;
      el.ruleRead.textContent = symbol;
      el.ruleWrite.textContent = rule.write;
      el.ruleMove.textContent = rule.move;
      el.transition.textContent = `δ(${from}, ${symbol}) = (${rule.write}, ${rule.move}, ${rule.next})`;
      el.logStatus.textContent = "Transición aplicada";
      setStatus("running", isManual() ? "MODO MANUAL" : "EJECUTANDO");
      el.log.scrollTop = el.log.scrollHeight; // desplaza solo la tabla, no la página
      renderTape(written);
      renderStates();
      turnDrums(rule.move);
    }
    if (machine.finals.has(sim.state)) { if (!animate) syncView(); finish(true); return false; }
    return true;
  }
  /** Refresca toda la vista (tras una ráfaga de pasos a 0 ms). */
  function syncView() {
    el.transition.textContent = `Ejecución a 0 ms: ${sim.steps} pasos aplicados`;
    el.step.textContent = sim.steps;
    el.headPos.textContent = sim.head;
    el.log.scrollTop = el.log.scrollHeight;
    renderTape();
    renderStates();
    showPreview();
  }

  /** Paso automático usando las transiciones guardadas. */
  function step(animate = true) {
    if (sim.done) return false;
    if (machine.finals.has(sim.state)) { finish(true); return false; }
    const symbol = sim.cells[sim.head];
    const rule = findRule(sim.rules, sim.state, symbol);
    if (!rule) { if (!animate) syncView(); finish(false, "norule", symbol); return false; }
    if (sim.steps >= MAX_STEPS) { if (!animate) syncView(); finish(false, "limit"); return false; }
    return applyRule(rule, symbol, animate);
  }

  function run() {
    if (isManual() || !canRun()) return;
    if (sim.running) { stop(); setRunLabel("Reanudar", "▶"); setStatus("paused", "EN PAUSA"); renderTape(); return; }
    if (sim.done) reset();
    sim.running = true;
    renderTape();
    setRunLabel("Pausar", "Ⅱ");
    const loop = () => {
      if (!sim.running) return;
      if (delay() === 0) { // 0 ms: muchos pasos por cuadro, sin animación
        for (let i = 0; i < 40; i++) if (!step(false)) return;
        syncView();
        sim.timer = setTimeout(loop, 16);
      } else if (step()) sim.timer = setTimeout(loop, delay());
    };
    loop();
  }

  /* ---------- Modo 2: ejecución manual ---------- */
  function setSegment(group, value) {
    $$("button", group).forEach((b) => b.classList.toggle("active", b.dataset.value === value));
  }
  function nextFreeState() {
    const used = new Set([...formStates(), ...sim.manualRules.flatMap((r) => [r.state, r.next])]);
    let n = 1;
    while (used.has(`q${n}`)) n++;
    return `q${n}`;
  }
  /** Agrega un estado nuevo a Q (en el formulario) si aún no está. */
  function ensureState(name) {
    if (formStates().includes(name)) return;
    el.cfgStates.value = [...formStates(), name].join(", ");
    renderStateFields();
  }
  /** Actualiza el formulario de decisión con el estado, el símbolo y el alfabeto actuales. */
  function refreshManual() {
    if (!isManual()) return;
    const symbol = sim.cells[sim.head] ?? machine.blank;
    el.mState.textContent = sim.state;
    el.mState.className = `tag c-${stateColor(sim.state)}`;
    el.mRead.textContent = symbol;
    const finals = [...machine.finals];
    el.mGoal.innerHTML = finals.length
      ? `Objetivo: llegar a ${finals.map((f) => `<b class="tag c-accept">${escapeHTML(f)}</b>`).join(" o ")}. También puedes detener la máquina con «Detener (paro)».`
      : "No hay estados finales marcados en F. Puedes detener la máquina con «Detener (paro)».";

    // Opciones de escritura: continuar sin cambios o cambiar por un símbolo de Γ
    const gamma = tapeAlphabet();
    el.mWrite.innerHTML = `<button type="button" data-value="keep">Continuar sin cambios («${escapeHTML(symbol)}»)</button>`
      + gamma.filter((g) => g !== symbol).map((g) => `<button type="button" data-value="${escapeHTML(g)}" class="${g === machine.blank ? "seg-blank" : machine.sentinelOn && g === machine.sentinel ? "seg-sentinel" : ""}">Cambiar a «${escapeHTML(g)}»${g === machine.blank ? " (blanco)" : ""}</button>`).join("");
    if (manual.write !== "keep" && (!gamma.includes(manual.write) || manual.write === symbol)) manual.write = "keep";

    $('[data-value="stay"]', el.mNextMode).textContent = `Quedarse en ${sim.state}`;
    const options = unique([...formStates(), ...sim.manualRules.flatMap((r) => [r.state, r.next])]).filter((s) => s !== sim.state);
    const fresh = nextFreeState();
    const previous = el.mNextSelect.value;
    el.mNextSelect.innerHTML = options.map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}${machine.finals.has(s) ? " · estado final" : ""}</option>`).join("")
      + `<option value="${fresh}">+ Nuevo estado ${fresh}</option><option value="__custom">Otro nombre (x, y, z…)</option>`;
    if ([...el.mNextSelect.options].some((o) => o.value === previous)) el.mNextSelect.value = previous;

    // Si ya se registró una decisión para (estado, símbolo), se propone la misma
    const known = findRule(sim.manualRules, sim.state, symbol);
    if (known) {
      manual.write = known.write === symbol ? "keep" : known.write;
      manual.move = known.move;
      manual.nextMode = known.next === sim.state ? "stay" : "change";
      if (manual.nextMode === "change") el.mNextSelect.value = known.next;
      el.mNote.textContent = `Ya registraste qué hacer en (${sim.state}, ${symbol}). Se reutiliza; si cambias algo, la transición se reemplaza.`;
    } else {
      el.mNote.textContent = "";
    }
    setSegment(el.mWrite, manual.write);
    setSegment(el.mMove, manual.move);
    setSegment(el.mNextMode, manual.nextMode);
    el.mNextPick.hidden = manual.nextMode !== "change";
    el.mCustom.hidden = el.mNextSelect.value !== "__custom";
    el.mApply.disabled = sim.done;
    $("#m-stop").disabled = sim.done;
    el.mUndo.disabled = !sim.history.length && !sim.stoppedByUser;
  }

  function manualApply() {
    if (sim.done || !isManual()) return;
    if (sim.steps >= MAX_STEPS) { finish(false, "limit"); return; }
    const symbol = sim.cells[sim.head];
    const rule = {
      state: sim.state, read: symbol,
      write: manual.write === "keep" ? symbol : manual.write,
      move: manual.move,
      next: manual.nextMode === "stay" ? sim.state : el.mNextSelect.value
    };
    if (rule.next === "__custom") {
      const name = cleanStateName(el.mCustom.value, "");
      if (!name) { el.mNote.textContent = "Escribe el nombre del nuevo estado (por ejemplo x, y o z)."; el.mCustom.focus(); return; }
      rule.next = name;
      el.mCustom.value = "";
    }
    ensureState(rule.next);
    sim.history.push({
      cells: [...sim.cells], original: [...sim.original], head: sim.head, state: sim.state, steps: sim.steps,
      rules: sim.manualRules.map((r) => ({ ...r })), logCount: $$(".log-row", el.log).length
    });
    const index = sim.manualRules.findIndex((r) => r.state === rule.state && r.read === rule.read);
    if (index >= 0) sim.manualRules[index] = rule; else sim.manualRules.push(rule);
    renderActiveRules();
    applyRule(rule, symbol);
    manual.nextMode = "stay";
    showPreview();
    refreshManual();
  }
  function manualUndo() {
    if (sim.stoppedByUser) { // deshacer el paro: la máquina sigue donde estaba
      sim.stoppedByUser = false;
      sim.done = false;
      el.result.hidden = true;
      setStatus("ready", "MODO MANUAL");
      refreshManual();
      return;
    }
    const snap = sim.history.pop();
    if (!snap) return;
    Object.assign(sim, { cells: snap.cells, original: snap.original, head: snap.head, state: snap.state, steps: snap.steps, manualRules: snap.rules, done: false });
    $$(".log-row", el.log).slice(snap.logCount).forEach((row) => row.remove());
    el.result.hidden = true;
    el.step.textContent = sim.steps;
    el.headPos.textContent = sim.head;
    el.transition.textContent = "Paso deshecho";
    setStatus("ready", "MODO MANUAL");
    renderActiveRules();
    renderTape();
    showPreview();
    refreshManual();
  }

  /* ---------- Cintas grabadas (Modo 2) ---------- */
  let tapes = storage.load(TAPES_KEY);
  function renderTapes() {
    el.recorded.hidden = !tapes.length;
    el.recordedList.innerHTML = tapes.map((t, i) => `<li><code>${escapeHTML(t.content)}</code><small>${escapeHTML(t.date)}</small><button type="button" data-use-tape="${i}">Usar como entrada</button><button type="button" class="danger" data-del-tape="${i}" aria-label="Eliminar cinta">×</button></li>`).join("");
  }
  function recordTape() {
    let last = sim.cells.length - 1;
    while (last > 0 && sim.cells[last] === machine.blank) last--;
    const content = sim.cells.slice(0, last + 1).join("");
    const date = new Date().toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" });
    tapes.unshift({ content, date, blank: machine.blank });
    tapes = tapes.slice(0, 10);
    const ok = storage.save(TAPES_KEY, tapes);
    renderTapes();
    el.mNote.textContent = ok ? `Cinta grabada (${content.length} celdas). Puedes usarla como entrada con «Usar como entrada».` : "La cinta se grabó solo para esta sesión: el navegador no permitió guardarla.";
  }
  el.recordedList.addEventListener("click", (e) => {
    const use = e.target.closest("[data-use-tape]");
    const del = e.target.closest("[data-del-tape]");
    if (use) {
      const t = tapes[Number(use.dataset.useTape)];
      // los blancos internos se conservan; los centinelas se quitan porque se agregan solos
      input.value = [...t.content].filter((c) => !(el.sentinelOn.checked && c === machine.sentinel)).join("").replace(new RegExp(`^\\${machine.blank}+|\\${machine.blank}+$`, "g"), "");
      sim.start = 0;
      reset();
      el.mNote.textContent = "Cinta grabada cargada como entrada.";
    } else if (del) {
      tapes.splice(Number(del.dataset.delTape), 1);
      storage.save(TAPES_KEY, tapes);
      renderTapes();
    }
  });

  /* ---------- Cambio de modo ---------- */
  function setMode(mode) {
    sim.mode = mode;
    stop();
    el.layout.classList.toggle("is-manual", mode === "manual");
    $$("[data-run-mode]").forEach((b) => b.classList.toggle("active", b.dataset.runMode === mode));
    if (mode === "manual") {
      manual.write = "keep"; manual.move = "D"; manual.nextMode = "stay";
      el.startScreen.classList.remove("forced", "editing");
      if (!formStates().length) { el.cfgStates.value = "q0, q1, q✓"; renderStateFields("q0", ["q✓"]); }
      if (!formAlphabet().length) el.cfgAlphabet.value = "0, 1";
    }
    renderActiveRules();
    reset();
  }

  /* ---------- Configuraciones guardadas y ejemplos ---------- */
  let saved = storage.load(STORAGE_KEY).map(normalizeProgram).filter(Boolean);
  function persistSaved() { return storage.save(STORAGE_KEY, saved.map(({ legacy, ...p }) => p)); }
  function storeProgram(program) {
    saved = saved.filter((p) => p.id !== program.id && p.name !== program.name); // mismo nombre = se sobrescribe
    saved.unshift(program);
    return persistSaved();
  }
  function allConfigs() {
    return [...saved.map((p) => ({ key: `saved:${p.id}`, name: p.name, kind: "Guardada", detail: `${p.rules.length} transiciones · Σ = {${p.alphabet.join(", ")}}` })),
      ...Object.keys(EXAMPLES).map((k) => { const p = exampleProgram(k); return { key: `example:${k}`, name: p.name, kind: "Ejemplo", detail: p.description }; })];
  }
  function renderSearch() {
    const q = el.searchInput.value.trim().toLowerCase();
    const items = allConfigs().filter((c) => c.name.toLowerCase().includes(q));
    el.searchResults.innerHTML = items.length
      ? items.map((c) => `<li><button type="button" data-load="${escapeHTML(c.key)}"><b>${escapeHTML(c.name)}</b><em class="badge ${c.kind === "Guardada" ? "ok" : ""}">${c.kind}</em><small>${escapeHTML(c.detail)}</small></button></li>`).join("")
      : '<li class="search-empty">No hay configuraciones con ese nombre.</li>';
  }

  /** Carga una configuración (ejemplo o guardada). Las configuraciones guardadas quedan listas para ejecutar. */
  function loadProgram(key) {
    let program;
    if (key.startsWith("saved:")) program = saved.find((p) => `saved:${p.id}` === key);
    else if (key.startsWith("example:")) program = exampleProgram(key.slice(8));
    if (!program) return;
    writeForm(program);
    sim.rules = program.rules.map(toRule);
    sim.programId = key.startsWith("saved:") ? program.id : null;
    sim.exampleKey = program.example || null;
    sim.configured = true;
    sim.dirty = false;
    el.startScreen.classList.remove("forced", "editing");
    el.deleteProgram.hidden = !key.startsWith("saved:");
    setMessage(program.description ? escapeHTML(program.description) : `Configuración «${escapeHTML(program.name)}» cargada.`);
    renderActiveRules();
    reset();
  }

  function saveConfig() {
    const program = readForm();
    const errors = validate(program);
    if (errors.length) {
      setMessage(`<b>No se puede guardar todavía:</b><ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul>`, true);
      return;
    }
    const normalized = normalizeProgram({ ...program, id: sim.programId || undefined });
    const ok = storeProgram(normalized);
    sim.programId = normalized.id;
    sim.exampleKey = null;
    sim.rules = normalized.rules.map(toRule);
    sim.configured = true;
    sim.dirty = false;
    el.startScreen.classList.remove("forced", "editing");
    el.deleteProgram.hidden = false;
    setMessage(ok ? `Configuración «${escapeHTML(normalized.name)}» guardada. Ya puedes ejecutarla.` : `Configuración lista para ejecutar, pero el navegador no permitió guardarla. Usa «Exportar» para conservarla.`, !ok);
    renderActiveRules();
    reset();
  }

  /** Plantilla vacía para una configuración nueva. */
  function newConfig() {
    sim.configured = false;
    sim.dirty = false;
    sim.programId = null;
    sim.rules = [];
    writeForm({ name: "", states: ["q0", "q1", "q✓"], initial: "q0", finals: ["q✓"], alphabet: ["0", "1"], extra: [], blank: "^", sentinel: "", input: "", start: 0,
      rules: [["q0", "0", "0", "D", "q0"]] });
    el.startScreen.classList.remove("forced");
    el.startScreen.classList.add("editing");
    el.deleteProgram.hidden = true;
    setMessage("Completa los datos de la máquina y las transiciones, y pulsa «Guardar configuración».");
    renderActiveRules();
    reset();
    el.cfgName.focus();
    $("#config-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Editor de la función de transición ---------- */
  function renderEditor() {
    const option = (m, current) => `<option value="${m}"${m === current ? " selected" : ""}>${m}</option>`;
    el.editor.innerHTML = sim.draft.map((r, i) => `
      <div class="rule-editor-row" data-index="${i}">
        <input data-field="state" value="${escapeHTML(r.state)}" maxlength="8" list="state-options" autocomplete="off" aria-label="Estado actual">
        <input data-field="read" value="${escapeHTML(r.read)}" maxlength="1" list="symbol-options" autocomplete="off" aria-label="Símbolo leído">
        <input data-field="write" value="${escapeHTML(r.write)}" maxlength="1" list="symbol-options" autocomplete="off" aria-label="Símbolo escrito">
        <select data-field="move" aria-label="Movimiento">${["D", "I", "S"].map((m) => option(m, r.move)).join("")}</select>
        <input data-field="next" value="${escapeHTML(r.next)}" maxlength="8" list="state-options" autocomplete="off" aria-label="Siguiente estado">
        <button type="button" class="remove-rule" data-remove="${i}" aria-label="Eliminar transición">×</button>
      </div>`).join("");
  }
  function syncDraft() {
    sim.draft = $$(".rule-editor-row", el.editor).map((row) => {
      const v = (f) => row.querySelector(`[data-field="${f}"]`).value.trim();
      return { state: cleanStateName(v("state"), machine.initial), read: v("read").slice(0, 1) || machine.blank, write: v("write").slice(0, 1) || machine.blank, move: v("move"), next: cleanStateName(v("next"), machine.initial) };
    });
  }
  function refreshOptions() {
    el.stateOptions.innerHTML = formStates().map((s) => `<option value="${escapeHTML(s)}">${s === el.cfgInitial.value ? "inicial" : formFinals().includes(s) ? "final" : "estado"}</option>`).join("");
    el.symbolOptions.innerHTML = tapeAlphabet().map((s) => `<option value="${escapeHTML(s)}">${s === formBlank() ? "blanco" : "símbolo"}</option>`).join("");
  }

  /* ---------- Eventos ---------- */
  // Pantalla de inicio del Modo 1
  $("#start-new").addEventListener("click", newConfig);
  $("#start-saved").addEventListener("click", () => { el.search.hidden = false; renderSearch(); el.searchInput.focus(); });
  el.searchInput.addEventListener("input", renderSearch);
  el.searchResults.addEventListener("click", (e) => { const b = e.target.closest("[data-load]"); if (b) loadProgram(b.dataset.load); });
  $("#change-config").addEventListener("click", () => {
    stop();
    el.startScreen.classList.add("forced");
    el.startScreen.classList.remove("editing");
    el.search.hidden = true;
    updateGate();
    el.startScreen.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  el.backToRun.addEventListener("click", () => { el.startScreen.classList.remove("forced"); updateGate(); });

  // Formulario: cambios en la 7-tupla o en δ marcan la configuración como «sin guardar»
  el.cfgStates.addEventListener("input", () => { renderStateFields(); markDirty(); });
  [el.cfgName, el.cfgAlphabet, el.cfgExtra].forEach((f) => f.addEventListener("input", markDirty));
  el.cfgName.addEventListener("input", updateGate);
  el.cfgAlphabet.addEventListener("change", reset);
  el.cfgBlank.addEventListener("input", () => {
    const v = el.cfgBlank.value.slice(-1);
    if (!v || /\s/.test(v)) { el.cfgBlank.value = machine.blank; return; }
    const old = machine.blank;
    el.cfgBlank.value = v;
    // las transiciones que usaban el blanco anterior pasan al nuevo
    syncDraft();
    const swap = (r) => ({ ...r, read: r.read === old ? v : r.read, write: r.write === old ? v : r.write });
    sim.draft = sim.draft.map(swap); sim.manualRules = sim.manualRules.map(swap);
    renderEditor();
    markDirty();
    reset();
  });
  el.cfgInitial.addEventListener("change", () => { markDirty(); reset(); });
  el.cfgFinals.addEventListener("click", (e) => {
    const chip = e.target.closest(".final-chip");
    if (!chip) return;
    chip.classList.toggle("on");
    markDirty();
    renderStates();
    refreshManual();
  });
  el.editor.addEventListener("input", markDirty);
  el.editor.addEventListener("change", markDirty);
  el.editor.addEventListener("focusin", refreshOptions);
  el.editor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    syncDraft();
    sim.draft.splice(Number(button.dataset.remove), 1);
    renderEditor();
    markDirty();
  });
  $("#add-rule").addEventListener("click", () => {
    syncDraft();
    sim.draft.push({ state: machine.initial, read: machine.blank, write: machine.blank, move: "D", next: [...machine.finals][0] || machine.initial });
    renderEditor();
    markDirty();
    el.editor.lastElementChild?.querySelector("input")?.focus();
  });
  $("#save-config").addEventListener("click", saveConfig);

  // Centinelas
  el.sentinelOn.addEventListener("change", () => {
    el.sentinelSymbol.disabled = !el.sentinelOn.checked;
    sim.start = 0;
    markDirty();
    reset();
    const ready = activeRules().some((r) => r.read === machine.sentinel);
    if (el.sentinelOn.checked && !ready && !isManual()) setMessage(`Centinelas ${escapeHTML(machine.sentinel)} activados, pero las transiciones no leen ${escapeHTML(machine.sentinel)}: la máquina se detendrá al llegar a él.`, true);
  });
  el.sentinelSymbol.addEventListener("input", () => {
    const v = el.sentinelSymbol.value.slice(-1);
    if (!v || /\s/.test(v) || formAlphabet().includes(v) || v === machine.blank) {
      el.sentinelSymbol.value = machine.sentinel;
      setMessage("El centinela debe ser un solo símbolo distinto de Σ y del blanco.", true);
      return;
    }
    const old = machine.sentinel;
    syncDraft();
    const swap = (r) => ({ ...r, read: r.read === old ? v : r.read, write: r.write === old ? v : r.write });
    sim.draft = sim.draft.map(swap); sim.manualRules = sim.manualRules.map(swap);
    machine.sentinel = v;
    el.sentinelSymbol.value = v;
    renderEditor();
    markDirty();
    reset();
  });

  // Cinta, celda inicial y velocidad
  input.addEventListener("input", reset);
  $("#random-input").addEventListener("click", () => {
    const ex = sim.exampleKey && EXAMPLES[sim.exampleKey];
    const alphabet = formAlphabet().length ? formAlphabet() : ["0", "1"];
    // Modo 2: el alfabeto incluye el blanco, como pide el proyecto
    input.value = isManual() ? randomBits(false, TAPE_CELLS, [...alphabet, machine.blank])
      : ex?.random ? ex.random() : randomBits(Boolean(ex?.preferPalindrome), TAPE_CELLS, alphabet);
    reset();
    setMessage(`Cinta llenada al azar con ${input.value.length} símbolos de {${escapeHTML((isManual() ? [...alphabet, machine.blank] : alphabet).join(", "))}}.`);
  });
  $("#m-random").addEventListener("click", () => $("#random-input").click());
  el.track.addEventListener("click", (event) => { const cell = event.target.closest(".tape-cell"); if (cell) setStart(Number(cell.dataset.index)); });
  $("#start-prev").addEventListener("click", () => setStart(sim.start - 1));
  $("#start-next").addEventListener("click", () => setStart(sim.start + 1));
  el.startCell.addEventListener("change", () => setStart(Number.parseInt(el.startCell.value, 10) || 0));
  const setDelay = (ms) => {
    const value = Math.min(5000, Math.max(0, Number.parseInt(ms, 10) || 0));
    el.speedMs.value = value;
    el.speed.value = Math.min(2000, value);
    el.speedLabel.textContent = value === 0 ? "0 ms (instantáneo)" : `${value} ms`;
  };
  el.speed.addEventListener("input", () => setDelay(el.speed.value));
  el.speedMs.addEventListener("input", () => setDelay(el.speedMs.value));

  // Controles de ejecución
  el.run.addEventListener("click", run);
  el.stepBtn.addEventListener("click", () => { if (sim.running || isManual() || !canRun()) return; if (sim.done) reset(); step(); });
  el.reset.addEventListener("click", reset);
  $$("[data-run-mode]").forEach((b) => b.addEventListener("click", () => { if (sim.mode !== b.dataset.runMode) setMode(b.dataset.runMode); }));

  // Modo 2
  el.mWrite.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { manual.write = b.dataset.value; setSegment(el.mWrite, manual.write); } });
  el.mMove.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { manual.move = b.dataset.value; setSegment(el.mMove, manual.move); } });
  el.mNextMode.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    manual.nextMode = b.dataset.value;
    setSegment(el.mNextMode, manual.nextMode);
    el.mNextPick.hidden = manual.nextMode !== "change";
  });
  el.mNextSelect.addEventListener("change", () => { el.mCustom.hidden = el.mNextSelect.value !== "__custom"; if (!el.mCustom.hidden) el.mCustom.focus(); });
  el.mApply.addEventListener("click", manualApply);
  el.mUndo.addEventListener("click", manualUndo);
  $("#m-stop").addEventListener("click", () => {
    if (sim.done) return;
    sim.stoppedByUser = true;
    finish(machine.finals.has(sim.state), "user", sim.cells[sim.head]);
  });
  $("#m-reset").addEventListener("click", reset);
  $("#m-record").addEventListener("click", recordTape);
  $("#m-clear").addEventListener("click", () => { sim.manualRules = []; renderActiveRules(); reset(); });
  el.mSave.addEventListener("click", () => {
    const name = el.mName.value.trim();
    if (!sim.manualRules.length) { el.mNote.textContent = "Aplica al menos un paso antes de guardar."; return; }
    if (!name) { el.mNote.textContent = "Escribe un nombre para la configuración."; el.mName.focus(); return; }
    // La cinta y la celda inicial guardadas son las del inicio de la sesión manual
    const program = { ...readForm(sim.manualRules), name, id: undefined };
    if (!program.finals.length) program.finals = [sim.state];
    const errors = validate(program).filter((e) => !e.startsWith("Escribe un nombre"));
    if (errors.length) { el.mNote.innerHTML = `No se puede guardar: ${errors.join(" ")}`; return; }
    const normalized = normalizeProgram(program);
    const ok = storeProgram(normalized);
    setMode("auto");
    loadProgram(`saved:${normalized.id}`);
    setMessage(ok ? `«${escapeHTML(name)}» guardada desde el Modo 2. Pulsa «Ejecutar máquina» para correrla en el Modo 1.`
      : `«${escapeHTML(name)}» cargada, pero el navegador no permitió guardarla. Usa «Exportar» para conservarla.`, !ok);
    el.mName.value = "";
  });

  // Exportar / importar / eliminar
  $("#export-program").addEventListener("click", () => {
    const program = readForm(isManual() ? sim.manualRules : undefined);
    const name = program.name || "configuracion";
    const blob = new Blob([JSON.stringify({ ...program, id: undefined }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name.replace(/[^\w\-áéíóúñ ]/gi, "").trim().replace(/\s+/g, "-") || "configuracion"}.turing.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  $("#import-program").addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", async () => {
    const file = el.importFile.files[0];
    el.importFile.value = "";
    if (!file) return;
    try {
      const program = normalizeProgram(JSON.parse(await file.text()));
      if (!program || !program.rules.length) throw new Error("formato");
      storeProgram(program);
      if (isManual()) setMode("auto");
      loadProgram(`saved:${program.id}`);
      setMessage(`«${escapeHTML(program.name)}» importada y guardada.`);
    } catch {
      setMessage("No se pudo leer el archivo: debe ser una configuración exportada desde Turing Lab.", true);
    }
  });
  el.deleteProgram.addEventListener("click", () => {
    if (!sim.programId) return;
    saved = saved.filter((p) => p.id !== sim.programId);
    persistSaved();
    sim.programId = null;
    sim.configured = false;
    el.deleteProgram.hidden = true;
    el.startScreen.classList.add("forced");
    el.search.hidden = false;
    renderSearch();
    setMessage("Configuración eliminada.");
    updateGate();
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, select, textarea, button") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (el.layout.hidden) return;
    const key = event.key.toLowerCase();
    if (isManual()) {
      if (event.key === "Enter") manualApply();
      else if (["d", "i", "s"].includes(key)) { manual.move = key.toUpperCase(); setSegment(el.mMove, manual.move); }
      return;
    }
    if (key === "r") reset();
    else if (event.key === " ") { event.preventDefault(); run(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); el.stepBtn.click(); }
  });

  // Estado inicial: sin configuración; se pregunta cómo empezar
  setDelay(400);
  writeForm({ name: "", states: [], initial: "", finals: [], alphabet: [], extra: [], blank: "^", sentinel: "", input: "", start: 0, rules: [] });
  renderTapes();
  renderActiveRules();
  reset();
}

/* ===================== Cambio de modo ===================== */
function initModes() {
  const buttons = $$(".mode-button");
  if (!buttons.length) return;
  const panels = { classic: $(".simulator-layout"), variants: $("#variants-panel") };
  const log = $(".execution-log");
  buttons.forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    buttons.forEach((b) => b.classList.toggle("active", b === button));
    Object.entries(panels).forEach(([name, panel]) => { if (panel) panel.hidden = name !== mode; });
    if (log) log.hidden = mode !== "classic";
  }));
}

/* ===================== Variantes ===================== */
const VARIANTS = {
  multi: {
    kicker: "VARIANTE 01", title: "Máquina de varias cintas", advantage: "Organiza mejor la memoria", example: "Copiar invirtiendo",
    description: "Usa dos o más cintas con cabezales independientes. Es más cómoda para separar datos de trabajo, aunque puede simularse con una sola cinta.",
    help: "La segunda cinta recibe la inversión de cada símbolo.",
    animation: '<div class="mini-tape"><i>A</i><i>B</i><i class="pulse">C</i></div><div class="mini-tape second"><i>1</i><i class="pulse">2</i><i>3</i></div><b>cabezales</b>'
  },
  nondeterministic: {
    kicker: "VARIANTE 02", title: "Máquina no determinista", advantage: "Resuelve búsquedas complejas", example: "Buscar un 0",
    description: "Una misma situación puede tener varias transiciones posibles. La máquina explora los caminos hasta encontrar una solución aceptante.",
    help: "Cada símbolo abre un camino; basta uno aceptante para aceptar.",
    animation: '<div class="path-node">q0</div><div class="path-line one"></div><div class="path-line two"></div><div class="path-node end-one">q1</div><div class="path-node end-two">q✓</div>'
  },
  multidimensional: {
    kicker: "VARIANTE 03", title: "Máquina multidimensional", advantage: "Representa mapas y estructuras", example: "Recorrer una cuadrícula",
    description: "La cinta se convierte en una cuadrícula. El cabezal puede moverse arriba, abajo, izquierda o derecha.",
    help: "Cada símbolo de entrada indica un movimiento sobre la cuadrícula.",
    animation: '<div class="grid-anim">↖　↑　↗<br>←　<span>●</span>　→<br>↙　↓　↘</div>'
  },
  universal: {
    kicker: "VARIANTE 04", title: "Máquina universal", advantage: "Una máquina para muchas", example: "Interpretar un programa",
    description: "Guarda la descripción de otra máquina en su cinta y puede ejecutar sus reglas. Es la idea detrás de los computadores programables.",
    help: "La cinta 2 contiene el programa; la cinta 1, los datos que transforma.",
    animation: '<div class="universal-anim"><b>π</b><span>→</span><i>q0 → q1</i><span>→</span><em>✓</em></div>'
  }
};

function initVariants() {
  const cards = $$(".variant-card");
  if (!cards.length) return;
  const runBtn = $("#variant-run");
  const inputEl = $("#variant-input");
  const out = $("#variant-output");
  const stepEl = $("#variant-step");
  const stateEl = $("#variant-state");
  const animation = $("#variant-animation");
  let selected = "multi", timer = null, frames = [], index = 0, status = "idle";

  const value = () => inputEl.value.replace(/[^01]/g, "").slice(0, 20) || "1";
  const invert = (s) => [...s].map((c) => (c === "1" ? "0" : "1")).join("");
  const setRun = (text, icon) => { runBtn.innerHTML = `${text} <span>${icon}</span>`; };

  function renderTapes(first = "", second = "", heads = [null, null]) {
    const render = (id, text, head) => {
      $(`#${id}`).innerHTML = [...(text || BLANK)].map((s, i) => `<span class="${symbolClass(s)}${i === head ? " variant-current" : ""}">${escapeHTML(s)}</span>`).join("");
    };
    render("variant-tape-one", first, heads[0]);
    render("variant-tape-two", second, heads[1]);
  }
  function resetView() {
    clearTimeout(timer);
    status = "idle";
    setRun("Ejecutar variante", "▶");
    out.textContent = "Configura una entrada y ejecuta la variante.";
    stepEl.textContent = "PASO 0";
    stateEl.textContent = "LISTA";
    renderTapes(value());
  }
  function select(key) {
    selected = key;
    const data = VARIANTS[key];
    cards.forEach((card) => card.classList.toggle("selected", card.dataset.variant === key));
    $("#variant-kicker").textContent = data.kicker;
    $("#variant-title").textContent = data.title;
    $("#variant-description").textContent = data.description;
    $("#variant-advantage").textContent = data.advantage;
    $("#variant-example").textContent = data.example;
    $("#variant-simulation-title").textContent = data.example;
    $("#variant-simulation-help").textContent = data.help;
    animation.className = `variant-animation animation-${key}`;
    animation.innerHTML = data.animation;
    resetView();
  }
  function buildFrames() {
    const v = value();
    const inv = invert(v);
    if (selected === "multi") {
      frames = [...v].map((_, i) => ({ first: v, second: inv.slice(0, i + 1), heads: [i, i], state: `Ambos cabezales en la posición ${i + 1}` }));
      frames.push({ first: v, second: inv, heads: [null, null], state: "Cintas sincronizadas", done: `Multicinta completada: la cinta 2 contiene ${inv}.` });
    } else if (selected === "nondeterministic") {
      frames = [...v].map((s, i) => ({ first: v, second: s === "0" ? "q✓" : "q1", heads: [i, null], state: `Camino ${i + 1}: q0 lee ${s} → ${s === "0" ? "q✓" : "q1"}` }));
      const ok = v.includes("0");
      frames.push({ first: v, second: ok ? "q✓" : "q1", heads: [null, null], state: ok ? "Camino aceptante encontrado" : "Ningún camino acepta", done: ok ? `Aceptada: el camino ${v.indexOf("0") + 1} llega a q✓.` : "Rechazada: todos los caminos terminan en q1." });
    } else if (selected === "multidimensional") {
      let x = 0, y = 0;
      frames = [...v].map((s, i) => {
        const dir = s === "1" ? (i % 2 ? "↑" : "→") : (i % 2 ? "↓" : "←");
        if (dir === "→") x++; else if (dir === "←") x--; else if (dir === "↑") y++; else y--;
        return { first: v, second: dir, heads: [i, 0], state: `Celda ${i + 1}: mueve ${dir} → (${x}, ${y})` };
      });
      frames.push({ first: v, second: "✓", heads: [null, null], state: "Destino alcanzado", done: `Recorrido terminado en la coordenada (${x}, ${y}).` });
    } else {
      frames = [
        { first: v, second: "q0:1→0", heads: [null, 0], state: "Lee la descripción de la máquina" },
        ...[...v].map((s, i) => ({ first: invert(v.slice(0, i)) + v.slice(i), second: s === "1" ? "q0:1→0" : "q0:0→1", heads: [i, 0], state: `Interpreta la regla para ${s}` })),
        { first: inv, second: "q✓", heads: [null, null], state: "Ejecuta y acepta", done: `La máquina universal ejecutó el programa «invertir»: ${inv}.` }
      ];
    }
  }
  function advance() {
    const frame = frames[index];
    renderTapes(frame.first, frame.second, frame.heads);
    stepEl.textContent = `PASO ${index + 1} / ${frames.length}`;
    stateEl.textContent = frame.state;
    if (index < frames.length - 1) {
      index++;
      timer = setTimeout(advance, 650);
    } else {
      status = "done";
      setRun("Repetir variante", "↻");
      out.textContent = frame.done || frame.state;
    }
  }
  runBtn.addEventListener("click", () => {
    if (status === "running") { clearTimeout(timer); status = "paused"; setRun("Continuar variante", "▶"); return; }
    if (status !== "paused") { buildFrames(); index = 0; }
    status = "running";
    setRun("Pausar variante", "Ⅱ");
    advance();
  });
  $("#variant-reset").addEventListener("click", () => { inputEl.value = "1101"; resetView(); });
  inputEl.addEventListener("input", () => { inputEl.value = inputEl.value.replace(/[^01]/g, ""); resetView(); });
  cards.forEach((card) => card.addEventListener("click", () => select(card.dataset.variant)));
  select("multi");
}

/* ===================== Menú de la documentación ===================== */
function initDocsMenu() {
  const links = $$(".docs-menu a");
  if (!links.length || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) links.forEach((link) => link.classList.toggle("selected", link.hash === `#${entry.target.id}`));
    });
  }, { rootMargin: "-25% 0px -65% 0px" });
  links.forEach((link) => { const section = document.getElementById(link.hash.slice(1)); if (section) observer.observe(section); });
}

/* ===================== Tambores de la Bombe (decoración SVG) ===================== */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DRUM_COLORS = {
  red: "#b5402f", green: "#3f8a55", yellow: "#d6a62a", blue: "#2f62c0",
  white: "#e4e0d4", grey: "#8f9593", brown: "#7c4a2d", violet: "#7c5cff", pink: "#ff4f9a", teal: "#18c4a5"
};

/** Dibuja un tambor: anillo de color, cara con letras A–Z, buje con radios y tornillos, e indicador fijo. */
function drumSVG(color) {
  const fill = DRUM_COLORS[color] || color;
  const step = 360 / 26;
  const letters = [...ALPHABET].map((l, i) => `<text transform="rotate(${(i * step).toFixed(2)}) translate(0 -31.5)">${l}</text>`).join("");
  const ticks = [...ALPHABET].map((_, i) => `<line transform="rotate(${(i * step + step / 2).toFixed(2)})" y1="-39" y2="-36"/>`).join("");
  const spokes = [0, 120, 240].map((a) => `<rect transform="rotate(${a})" x="-1.8" y="-22.5" width="3.6" height="22.5" rx="1.2"/>`).join("");
  const screws = [60, 180, 300].map((a) => `<circle transform="rotate(${a}) translate(0 -16.5)" r="2.1"/>`).join("");
  return `<svg class="drum-svg" viewBox="-50 -50 100 100" aria-hidden="true">
    <circle r="49.5" fill="#121212"/>
    <circle r="47" fill="${fill}"/>
    <circle r="45.2" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1" stroke-dasharray="1.6 2.4"/>
    <circle r="41.5" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>
    <g class="drum-face">
      <circle r="40.5" fill="#231d19"/>
      <g class="drum-ticks">${ticks}</g>
      <g class="drum-letters">${letters}</g>
      <circle r="24" fill="#cfd3d0" stroke="#767b78" stroke-width="2"/>
      <circle r="19" fill="none" stroke="#a9adaa" stroke-width=".8"/>
      <g class="drum-spokes">${spokes}</g>
      <g class="drum-screws">${screws}</g>
      <circle r="7.5" fill="#3a3a3a"/><circle r="3" fill="#e2e2e2"/>
    </g>
    <ellipse cx="-12" cy="-24" rx="24" ry="10" transform="rotate(-28)" fill="#fff" opacity=".1"/>
    <path class="drum-pointer" d="M-4.5 -50 L4.5 -50 L0 -41Z"/>
  </svg>`;
}

/** Rellena todos los [data-drum] con su SVG y una posición inicial aleatoria. */
function initDrums(root = document) {
  $$("[data-drum]", root).forEach((el) => {
    if (el.firstElementChild) return;
    el.innerHTML = drumSVG(el.dataset.drum);
    el.style.setProperty("--from", `${Math.floor(Math.random() * 26) * (360 / 26)}deg`);
    el.style.setProperty("--dur", `${el.dataset.speed || 8}s`);
  });
}

/** Banco de 3 × 12 tambores, colores parecidos a la Bombe reconstruida. */
function initBombe() {
  const bank = $("#drum-bank");
  if (!bank) return;
  const rows = [
    { colors: ["grey", "white", "green", "yellow", "white", "brown", "grey", "green", "yellow", "brown", "yellow", "brown"], speed: 6 },
    { colors: ["blue", "grey", "blue", "blue", "blue", "blue", "grey", "blue", "blue", "blue", "blue", "blue"], speed: 20 },
    { colors: ["grey", "white", "white", "white", "grey", "white", "white", "grey", "white", "white", "white", "grey"], speed: 52 }
  ];
  let html = "";
  for (let col = 0; col < 12; col++) {
    rows.forEach((row) => { html += `<div class="drum" data-drum="${row.colors[col]}" data-speed="${row.speed + (col % 3) * .4}"></div>`; });
  }
  bank.innerHTML = html;
  initDrums(bank);

  const cabinet = $("#bombe-cabinet");
  const counter = $("#bombe-counter");
  const randomLetter = () => ALPHABET[Math.floor(Math.random() * 26)];
  let ticks = 0;
  setInterval(() => {
    if (cabinet.classList.contains("bombe-stop")) return;
    counter.textContent = `${randomLetter()} ${randomLetter()} ${randomLetter()}`;
    if (++ticks % 9 === 0) { // cada cierto tiempo «encuentra» una posición y se detiene
      cabinet.classList.add("bombe-stop");
      setTimeout(() => cabinet.classList.remove("bombe-stop"), 1800);
    }
  }, 700);
}

/** Tira de tambores pequeños en el pie de página. */
function initDrumStrip() {
  const palette = ["violet", "blue", "pink", "teal", "yellow", "red", "green", "white"];
  $$("[data-drum-strip]").forEach((strip) => {
    strip.innerHTML = Array.from({ length: 24 }, (_, i) => `<div class="drum" data-drum="${palette[i % palette.length]}" data-speed="${10 + (i % 5) * 4}"></div>`).join("");
  });
}

initDrumStrip();
initDrums();
initBombe();
initSimulator();
initModes();
initVariants();
initDocsMenu();
