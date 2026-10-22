(function(){
"use strict";

/* ======================= CONFIG ======================= */
const CONFIG = {
  name: "Otto",
  address: "senhor",
  themeColor: "vermelho",
  persona: "mordomo corporativo, levemente descontraído",
  wakeWords: ["ei otto","bom dia otto","boa tarde otto","boa noite otto"],
  voiceGender: "masculina",
  model: "claude-sonnet-5"
};

const AREA = {
  metas:       { label: "Metas",       color: "#fbbf24" },
  trabalho:    { label: "Carreira",    color: "#ff5547" },
  projetos:    { label: "Projetos",    color: "#8b7cff" },
  financas:    { label: "Finanças",    color: "#f7931a" },
  aprendizado: { label: "Aprendizado", color: "#2dd4ff" },
  saude:       { label: "Saúde",       color: "#10b981" },
  relacoes:    { label: "Relações",    color: "#ec4899" },
  meta:        { label: "Núcleo",      color: "#8a90a6" }
};

const DEFAULT_NOTES = [
  { id:"voce", area:"meta", title:"Bruno",
    body:"Bruno Severo de Oliveira, 21 anos. Apaixonado por arte (qualquer forma) e programação." },
  { id:"metas-longo", area:"metas", title:"Formação",
    body:"Meta de longo prazo (1-3 anos): se formar nesses conhecimentos (arte e programação) e ajudar qualquer pessoa que precisar de ajuda relacionada." },
  { id:"carreira", area:"trabalho", title:"Estágio",
    body:"Buscando vaga de estágio na área do curso. No momento está desempregado, mas mantém projetos próprios de e-commerce e afiliados em paralelo." },
  { id:"proj-achadinho", area:"projetos", title:"Top Achadinho BR",
    body:"Site de promoções brasileiro, convertido de Next.js para HTML/CSS/JS puro, com API Flask servindo os produtos." },
  { id:"proj-scraper", area:"projetos", title:"Scraper",
    body:"Ferramenta de web scraping com Selenium, BeautifulSoup e Flask, mirando Mercado Livre e Shopee, com identidade visual de 'recibo de garimpo'." },
  { id:"proj-gestorx", area:"projetos", title:"GestorX",
    body:"Sistema de gestão (GestorXpress) em Next.js/TypeScript, com fluxo de criação de conta em duas etapas (Administrador e Funcionário)." },
  { id:"proj-scanner", area:"projetos", title:"Scanner",
    body:"Ferramenta web de escaneamento de arquivos, backend em Python puro e frontend HTML/CSS/JS, estética de scanner/blueprint." },
  { id:"financas", area:"financas", title:"Planejamento",
    body:"Ainda sem metas financeiras definidas em valores — foco em consolidar projetos e renda antes de definir números." },
  { id:"aprendizado", area:"aprendizado", title:"Estudos",
    body:"Estudando programação front-end e back-end, além de inglês, espanhol, francês e italiano." },
  { id:"saude", area:"saude", title:"Rotina",
    body:"Treino, sono e alimentação dentro da média, sem condições específicas registradas." }
];

const DEFAULT_REL = [
  ["metas-longo","voce"],
  ["metas-longo","carreira"],
  ["metas-longo","aprendizado"],
  ["metas-longo","proj-achadinho"],
  ["metas-longo","proj-scraper"],
  ["metas-longo","proj-gestorx"],
  ["metas-longo","proj-scanner"],
  ["carreira","financas"],
  ["proj-achadinho","proj-scraper"],
  ["proj-gestorx","proj-scanner"],
  ["voce","saude"],
  ["aprendizado","proj-gestorx"]
];

/* ======================= MÓDULOS NOVOS: CONFIG ======================= */
const ANTENNA_BASE = "http://127.0.0.1:4242";

const MODEL_MAP = {
  economico: "claude-haiku-4-5",
  equilibrado: "claude-sonnet-5",
  maximo: "claude-opus-4-8"
};

const DEFAULT_CALENDARS = [
  { id:"cal-1", name:"Pessoal · Vermelho", color:"#ff3b30", ics:"" },
  { id:"cal-2", name:"Trabalho · Violeta", color:"#a855f7", ics:"" }
];

const DEFAULT_EMAIL_ACCOUNTS = [
  { id:"email-1", nickname:"Pessoal", color:"#ff3b30", host:"imap.gmail.com", email:"", appPassword:"" }
];

const NEWS_SUBJECTS = ["tecnologia","economia"];
const NEWS_PER_SUBJECT = 5;
const NEWS_LOCALE = { hl:"pt-BR", gl:"BR", ceid:"BR:pt-419" };
const NEWS_REFRESH_MS = 30 * 60 * 1000;
const AGENDA_REFRESH_MS = 10 * 60 * 1000;
const EMAIL_REFRESH_MS = 15 * 60 * 1000;
const EMAILS_PER_ACCOUNT = 20;

const DIGEST_CONFIG = {
  city: "Naviraí, MS",
  weather: true,
  size: "curto",   // curto ~30s / medio ~1min
  speak: true
};

const IMAP_ALLOWLIST = ["imap.gmail.com"];

/* ======================= STATE ======================= */
let NOTES = [];
let REL = DEFAULT_REL.slice();
let recognition = null;
let busy = false;               // true enquanto pensa OU fala
let activated = false;          // já passou da wake word?
let listeningEnabled = false;
let sessionHistory = [];
let synapses = [];
let animFrame = null;
let voicesReady = false;
let chosenVoice = null;

function loadNotes(){
  try{
    const raw = localStorage.getItem("otto_notes");
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length) return parsed;
    }
  }catch(e){}
  return DEFAULT_NOTES.slice();
}
function saveNotes(){
  try{ localStorage.setItem("otto_notes", JSON.stringify(NOTES)); }catch(e){}
}
NOTES = loadNotes();

/* ---------- Persistência dos módulos novos ---------- */
function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return fallback;
}
function saveJSON(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
}

let CALENDARS = loadJSON("otto_calendars", DEFAULT_CALENDARS.slice());
let EMAIL_ACCOUNTS = loadJSON("otto_emails", DEFAULT_EMAIL_ACCOUNTS.slice());
let EMAIL_TRIAGE_CACHE = loadJSON("otto_email_triage", {});   // messageId -> {balde, resumo}
let NEWS_CACHE = loadJSON("otto_news_cache", {});             // assunto -> {ts, items:[]}
let LAST_DIGEST_DATE = localStorage.getItem("otto_last_digest") || "";
let ECONOMY_MODE = (localStorage.getItem("otto_economy") !== "false"); // padrão: ligado

let AGENDA_EVENTS = [];      // cache em memória dos eventos já mesclados
let EMAIL_ITEMS = [];        // cache em memória dos e-mails já triados
let agendaCountdownTimer = null;

// carrega o modelo salvo (ou usa o padrão vindo da Parte 1)
(function loadModel(){
  const saved = localStorage.getItem("otto_model");
  if(saved && Object.values(MODEL_MAP).includes(saved)){
    CONFIG.model = saved;
  } else {
    CONFIG.model = MODEL_MAP.economico; // padrão escolhido: econômico
  }
})();

/* ======================= DOM ======================= */
const $ = id => document.getElementById(id);
const bootScreen = $("boot-screen");
const activationScreen = $("activation-screen");
const appEl = $("app");
const orbWrap = $("orb-wrap");
const statusLine = $("status-line");
const userLine = $("user-line");
const assistantLine = $("assistant-line");
const textInput = $("text-input");
const micBtn = $("mic-btn");
const stopBtn = $("stop-btn");
const apikeyInput = $("apikey");
const savekeyBtn = $("savekey");
const graphContainer = $("graph-container");
const legendEl = $("legend");
const brainCount = $("brain-count");
const errorToast = $("error-toast");

/* ---------- DOM: módulos novos ---------- */
const settingsBtn = $("settings-btn");
const settingsOverlay = $("settings-overlay");
const hudBadge = $("hud-badge");
const tabBadge = $("tab-badge");
const agendaBody = $("agenda-body");
const emailsBody = $("emails-body");
const emailsSub = $("emails-sub");
const newsBody = $("news-body");
const digestBody = $("digest-body");
const calendarsList = $("calendars-list");
const emailsList = $("emails-list");

/* ======================= BOOT SEQUENCE ======================= */
window.addEventListener("load", () => {
  try{
    const savedKey = localStorage.getItem("anthropic_key");
    if(savedKey) apikeyInput.value = savedKey;
  }catch(e){}

  setTimeout(() => {
    bootScreen.classList.add("fade");
    setTimeout(() => {
      bootScreen.style.display = "none";
      activationScreen.classList.add("show");
    }, 800);
  }, 2200);
});

// bug corrigido: o botão SALVAR existia na tela mas nunca tinha sido conectado a nenhuma ação
$("savekey").addEventListener("click", () => {
  const key = apikeyInput.value.trim();
  if(!key){
    showError("Cole uma API key antes de salvar.");
    return;
  }
  try{
    localStorage.setItem("anthropic_key", key);
    const original = savekeyBtn.textContent;
    savekeyBtn.textContent = "SALVO ✓";
    savekeyBtn.disabled = true;
    setTimeout(() => { savekeyBtn.textContent = original; savekeyBtn.disabled = false; }, 1500);
  }catch(e){
    showError("Não consegui salvar a chave neste navegador.");
  }
});

// também salva se a pessoa colar e teclar Enter no campo, sem precisar clicar em SALVAR
apikeyInput.addEventListener("keydown", (e) => {
  if(e.key === "Enter"){
    e.preventDefault();
    $("savekey").click();
  }
});

$("activate-btn").addEventListener("click", () => {
  activationScreen.classList.remove("show");
  activationScreen.style.display = "none";
  appEl.classList.add("show");
  initVoices();
  setupRecognition();
  renderGraph();
  renderLegend();
  listeningEnabled = true;
  const greeting = `Sistemas online. Estou ouvindo, ${CONFIG.address}.`;
  speak(greeting, () => {
    startRecognition();
  });
  assistantLine.textContent = greeting;

  // ---- módulos novos ----
  setupTabs();
  setupSettings();
  renderCalendarsSettings();
  renderEmailsSettings();
  refreshAgenda();
  refreshEmails();
  refreshNews();
  setInterval(refreshAgenda, AGENDA_REFRESH_MS);
  setInterval(refreshEmails, EMAIL_REFRESH_MS);
  setInterval(refreshNews, NEWS_REFRESH_MS);
  startAgendaCountdownTicker();
  maybeAutoDigest();
});

/* ======================= ERROS ======================= */
function showError(msg){
  errorToast.textContent = msg;
  errorToast.classList.add("show");
  setTimeout(() => errorToast.classList.remove("show"), 5000);
  speak(msg);
}

/* ======================= TTS ======================= */
function initVoices(){
  function pick(){
    const voices = speechSynthesis.getVoices();
    if(!voices.length) return;
    let ptVoices = voices.filter(v => /pt-BR|pt_BR|Portuguese/i.test(v.lang) || /Brazil/i.test(v.name));
    if(!ptVoices.length) ptVoices = voices.filter(v => /^pt/i.test(v.lang));
    let candidate = null;
    if(CONFIG.voiceGender === "masculina"){
      candidate = ptVoices.find(v => /male|masculin|Ricardo|Daniel|Felipe|Diego|Luiz/i.test(v.name)) || ptVoices[0];
    } else {
      candidate = ptVoices.find(v => /female|feminin|Luciana|Maria|Camila|Vitoria|Vitória/i.test(v.name)) || ptVoices[0];
    }
    chosenVoice = candidate || voices[0] || null;
    voicesReady = true;
  }
  pick();
  speechSynthesis.onvoiceschanged = pick;
}

function speak(text, onEnd){
  if(!text){ if(onEnd) onEnd(); return; }
  try{
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "pt-BR";
    if(chosenVoice) utter.voice = chosenVoice;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    busy = true;
    orbWrap.classList.remove("listening","thinking");
    orbWrap.classList.add("speaking");
    statusLine.textContent = "FALANDO";
    utter.onend = () => {
      busy = false;
      orbWrap.classList.remove("speaking");
      statusLine.textContent = activated ? "OUVINDO" : "OCIOSO";
      if(onEnd) onEnd();
    };
    utter.onerror = () => {
      busy = false;
      orbWrap.classList.remove("speaking");
      if(onEnd) onEnd();
    };
    speechSynthesis.speak(utter);
  }catch(e){
    busy = false;
    if(onEnd) onEnd();
  }
}

function interruptSpeech(){
  try{ speechSynthesis.cancel(); }catch(e){}
  busy = false;
  orbWrap.classList.remove("speaking");
  statusLine.textContent = activated ? "OUVINDO" : "OCIOSO";
}
stopBtn.addEventListener("click", interruptSpeech);

/* ======================= STT ======================= */
function normalize(s){
  return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
}

function setupRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    showError("Reconhecimento de voz não é suportado neste navegador.");
    return;
  }
  recognition = new SR();
  recognition.lang = "pt-BR";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    if(busy) return;
    const idx = event.results.length - 1;
    const transcript = event.results[idx][0].transcript;
    handleSpeechInput(transcript);
  };

  recognition.onerror = (event) => {
    if(event.error === "not-allowed" || event.error === "permission-denied"){
      showError("Permissão de microfone negada. Ative o microfone nas configurações do navegador.");
      listeningEnabled = false;
    }
    // outros erros (no-speech, network) são ignorados e o onend cuida do restart
  };

  recognition.onend = () => {
    if(listeningEnabled && !busy){
      try{ recognition.start(); }catch(e){ /* already started, ignora */ }
    }
  };
}

function startRecognition(){
  if(!recognition) return;
  try{ recognition.start(); }catch(e){ /* already started */ }
  micBtn.classList.add("active");
  orbWrap.classList.add("listening");
  statusLine.textContent = "OUVINDO";
}

micBtn.addEventListener("click", () => {
  listeningEnabled = !listeningEnabled;
  if(listeningEnabled){
    startRecognition();
  }else{
    micBtn.classList.remove("active");
    orbWrap.classList.remove("listening");
    statusLine.textContent = "OCIOSO";
    try{ recognition && recognition.stop(); }catch(e){}
  }
});

orbWrap.addEventListener("click", () => {
  if(!listeningEnabled){
    listeningEnabled = true;
    startRecognition();
  }
});

function handleSpeechInput(rawText){
  const norm = normalize(rawText);
  if(!activated){
    const hit = CONFIG.wakeWords.find(w => norm.includes(w));
    if(hit){
      activated = true;
      const rest = norm.replace(hit,"").trim();
      const originalRest = stripLeadWord(rawText, hit);
      if(rest.length > 2){
        processCommand(originalRest || rawText);
      }else{
        speak(`Pois não, ${CONFIG.address}.`, () => {});
      }
      setTimeout(() => { activated = false; }, 15000);
    }
    return;
  }
  processCommand(rawText);
  activated = false;
}

function stripLeadWord(original, wakeWord){
  // tenta remover a wake word do texto original preservando o resto
  const normOriginal = normalize(original);
  const i = normOriginal.indexOf(wakeWord);
  if(i === -1) return original;
  return original.slice(i + wakeWord.length).trim();
}

/* ======================= INPUT TEXTO ======================= */
textInput.addEventListener("keydown", (e) => {
  if(e.key === "Enter" && textInput.value.trim()){
    const val = textInput.value.trim();
    textInput.value = "";
    processCommand(val);
  }
});

/* ======================= CÉREBRO (API) ======================= */
function buildSystemPromptBase(){
  let notesBlock = "";
  Object.keys(AREA).forEach(areaKey => {
    const notesInArea = NOTES.filter(n => n.area === areaKey);
    if(notesInArea.length){
      notesBlock += `\n${AREA[areaKey].label.toUpperCase()}:\n`;
      notesInArea.forEach(n => {
        notesBlock += `- ${n.title}: ${n.body}\n`;
      });
    }
  });

  return `Você é ${CONFIG.name}, um assistente de voz pessoal com personalidade de ${CONFIG.persona}. `
  + `Você trata o usuário por "${CONFIG.address}". `
  + `Responda SEMPRE em português do Brasil, em respostas curtas e faladas (2 a 4 frases), sem emojis e sem markdown, como se estivesse conversando por voz. `
  + `Aqui está o SECOND BRAIN completo do usuário, com informações reais da vida dele — use isso para personalizar TODAS as respostas, com naturalidade, sem citar que está "consultando notas":\n${notesBlock}\n`
  + `PROTOCOLO DE MEMÓRIA VIVA: se o usuário revelar algo novo e duradouro sobre a vida dele (uma meta, um projeto, uma mudança de trabalho, algo sobre saúde, aprendizado, finanças ou relações), TERMINE sua resposta com uma linha adicional no formato EXATO [[SAVE:area|titulo|texto]], onde area é uma destas: metas, trabalho, projetos, financas, aprendizado, saude, relacoes, meta. Se já existir uma nota com esse título, ela deve ser atualizada; senão, uma nova nasce. Inclua essa linha SOMENTE quando houver algo realmente novo para guardar.`;
}

// ENVELOPE: acrescenta agenda de hoje + contagem de e-mails de ação, e as capacidades novas,
// sem alterar a lógica original do Second Brain acima.
function buildSystemPrompt(){
  let base = buildSystemPromptBase();

  const todayEvents = getTodayEventsCompact();
  const actionCount = EMAIL_ITEMS.filter(e => e.balde === "acao").length;

  base += `\n\nCAPACIDADES NOVAS: você também tem acesso à agenda do usuário (múltiplos Google Calendars mesclados), à caixa de e-mails triada em AÇÃO/INFO/RUÍDO, a um radar de notícias dos assuntos ${NEWS_SUBJECTS.join(" e ")}, e a um Morning Digest falado. Se o usuário perguntar "o que você sabe fazer", cite naturalmente: agenda, e-mails, notícias e o bom dia com o digest, além de tudo mais que já fazia.`;

  base += todayEvents
    ? `\nAgenda de hoje: ${todayEvents}`
    : `\nAgenda de hoje: nenhum evento encontrado (ou antena/agendas não configuradas).`;

  base += `\nE-mails pedindo ação: ${actionCount}`;

  return base;
}

async function processCommandAPI(text){
  if(!text || !text.trim()) return;
  userLine.textContent = text;
  const apiKey = apikeyInput.value.trim();
  if(!apiKey){
    showError(`Preciso de uma API key, ${CONFIG.address}. Cole sua chave no campo do topo.`);
    return;
  }
  orbWrap.classList.remove("listening");
  orbWrap.classList.add("thinking");
  statusLine.textContent = "PENSANDO";
  busy = true;

  sessionHistory.push({ role: "user", content: text });

  try{
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: 400,
        system: buildSystemPrompt(),
        messages: sessionHistory
      })
    });

    if(!response.ok){
      busy = false;
      orbWrap.classList.remove("thinking");
      statusLine.textContent = activated ? "OUVINDO" : "OCIOSO";
      showError(`A conexão com a API falhou, ${CONFIG.address}. Verifique se a chave está correta.`);
      return;
    }

    const data = await response.json();
    let replyText = (data && data.content && data.content[0] && data.content[0].text) || "";
    if(!replyText){
      busy = false;
      orbWrap.classList.remove("thinking");
      statusLine.textContent = activated ? "OUVINDO" : "OCIOSO";
      showError("Não recebi uma resposta válida da API.");
      return;
    }

    sessionHistory.push({ role: "assistant", content: replyText });

    // detecta e processa [[SAVE:...]]
    const saveRegex = /\[\[SAVE:([a-z_]+)\|([^|]+)\|([\s\S]+?)\]\]/;
    const match = replyText.match(saveRegex);
    if(match){
      const area = match[1].trim();
      const title = match[2].trim();
      const body = match[3].trim();
      upsertNote(area, title, body);
      replyText = replyText.replace(saveRegex, "").trim();
    }

    orbWrap.classList.remove("thinking");
    assistantLine.textContent = replyText;
    speak(replyText, () => {});
  }catch(e){
    busy = false;
    orbWrap.classList.remove("thinking");
    statusLine.textContent = activated ? "OUVINDO" : "OCIOSO";
    showError(`Não consegui conectar à rede, ${CONFIG.address}.`);
  }
}

/* ======================= ENVELOPE: ROTEADOR DE COMANDOS ======================= */
// processCommand agora tenta resolver LOCALMENTE (agenda/e-mails/notícias/digest)
// antes de cair no fluxo original da API (processCommandAPI), preservando tudo da Parte 1.
async function processCommand(text){
  if(!text || !text.trim()) return;
  const handled = await tryLocalCommand(text.trim());
  if(handled) return;
  processCommandAPI(text);
}

async function tryLocalCommand(text){
  const n = normalize(text);

  if(/(minha agenda|o que eu tenho hoje|agenda de hoje)/.test(n)){
    userLine.textContent = text;
    switchTab("agenda");
    speakAgendaToday();
    return true;
  }
  if(/(proximo compromisso|proxima reuniao|proximo evento)/.test(n)){
    userLine.textContent = text;
    switchTab("agenda");
    speakNextEvent();
    return true;
  }
  if(/agenda da semana/.test(n)){
    userLine.textContent = text;
    switchTab("agenda");
    speakAgendaWeek();
    return true;
  }
  if(/atualizar e-?mails?/.test(n)){
    userLine.textContent = text;
    switchTab("emails");
    speak(`Atualizando seus e-mails, ${CONFIG.address}.`, ()=>{});
    await refreshEmails(true);
    return true;
  }
  if(/tem e-?mail importante/.test(n)){
    userLine.textContent = text;
    switchTab("emails");
    speakActionEmails(true);
    return true;
  }
  if(/(meus e-?mails|minha caixa de entrada)/.test(n)){
    userLine.textContent = text;
    switchTab("emails");
    speakActionEmails(false);
    return true;
  }
  if(/atualizar noticias/.test(n)){
    userLine.textContent = text;
    switchTab("news");
    speak(`Buscando notícias frescas, ${CONFIG.address}.`, ()=>{});
    await refreshNews(true);
    return true;
  }
  const newsSubjectMatch = n.match(/noticias de (.+)/);
  if(newsSubjectMatch){
    userLine.textContent = text;
    switchTab("news");
    speakNewsSubject(newsSubjectMatch[1].trim());
    return true;
  }
  if(/^noticias$|\bnoticias\b/.test(n) && !newsSubjectMatch){
    userLine.textContent = text;
    switchTab("news");
    speakAllNews();
    return true;
  }
  if(/bom dia/.test(n) && n.length < 30){
    userLine.textContent = text;
    switchTab("digest");
    runDigest(true);
    return true;
  }
  if(/o que voce sabe fazer|quais sao seus comandos/.test(n)){
    userLine.textContent = text;
    const msg = `Além de conversar, ${CONFIG.address}, eu cuido da sua agenda, triagem os e-mails em ação, informação e ruído, monto um radar de notícias dos seus assuntos, e te dou bom dia com um briefing completo. É só pedir.`;
    assistantLine.textContent = msg;
    speak(msg, ()=>{});
    return true;
  }
  return false;
}

/* ======================= NOTAS / SECOND BRAIN ======================= */
function slugify(str){
  return normalize(str).replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"") || ("nota-" + Date.now());
}

function upsertNote(area, title, body){
  if(!AREA[area]) area = "meta";
  let existing = NOTES.find(n => normalize(n.title) === normalize(title));
  let id;
  if(existing){
    existing.area = area;
    existing.body = body;
    id = existing.id;
  }else{
    id = slugify(title);
    NOTES.push({ id, area, title, body });
    // conecta a nova nota ao hub de metas, se existir, senão à primeira nota
    const hub = NOTES.find(n => n.area === "metas") || NOTES[0];
    if(hub && hub.id !== id) REL.push([hub.id, id]);
  }
  saveNotes();
  renderGraph();
  renderLegend();
  blinkNode(id);
}

function deleteNote(id){
  NOTES = NOTES.filter(n => n.id !== id);
  REL = REL.filter(pair => pair[0] !== id && pair[1] !== id);
  saveNotes();
  renderGraph();
  renderLegend();
}

/* ---------- MODAL ---------- */
const modalOverlay = $("modal-overlay");
const noteIdField = $("note-id");
const noteTitleField = $("note-title");
const noteAreaField = $("note-area");
const noteBodyField = $("note-body");

function openModal(note){
  noteIdField.value = note ? note.id : "";
  noteTitleField.value = note ? note.title : "";
  noteAreaField.value = note ? note.area : "metas";
  noteBodyField.value = note ? note.body : "";
  $("modal-delete").style.display = note ? "block" : "none";
  modalOverlay.classList.add("show");
}
function closeModal(){ modalOverlay.classList.remove("show"); }

$("modal-cancel").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if(e.target === modalOverlay) closeModal(); });

$("modal-save").addEventListener("click", () => {
  const title = noteTitleField.value.trim();
  const area = noteAreaField.value;
  const body = noteBodyField.value.trim();
  if(!title || !body){ return; }
  const id = noteIdField.value;
  if(id){
    const n = NOTES.find(x => x.id === id);
    if(n){ n.title = title; n.area = area; n.body = body; }
  }else{
    const newId = slugify(title);
    NOTES.push({ id:newId, area, title, body });
    const hub = NOTES.find(n => n.area === "metas") || NOTES[0];
    if(hub && hub.id !== newId) REL.push([hub.id, newId]);
  }
  saveNotes();
  renderGraph();
  renderLegend();
  closeModal();
});

$("modal-delete").addEventListener("click", () => {
  const id = noteIdField.value;
  if(id) deleteNote(id);
  closeModal();
});

$("add-note-btn").addEventListener("click", () => openModal(null));
$("reload-btn").addEventListener("click", () => { renderGraph(); renderLegend(); });

/* ---------- LEGENDA ---------- */
function renderLegend(){
  const areasPresent = [...new Set(NOTES.map(n => n.area))];
  let html = "";
  areasPresent.forEach(a => {
    if(!AREA[a]) return;
    html += `<div class="legend-item"><span class="legend-dot" style="background:${AREA[a].color}"></span>${AREA[a].label}</div>`;
  });
  html += `<div id="legend-status">✓ contexto injetado em todos os comandos do ${CONFIG.name}</div>`;
  legendEl.innerHTML = html;
  brainCount.textContent = `${NOTES.length} notas · ${areasPresent.length} áreas`;
}

/* ---------- GRAFO SVG ---------- */
let nodePositions = {}; // id -> {x,y,r}
let blinkTargets = {};  // id -> timestamp

function computeConnections(){
  const counts = {};
  NOTES.forEach(n => counts[n.id] = 0);
  REL.forEach(([a,b]) => {
    if(counts[a] !== undefined) counts[a]++;
    if(counts[b] !== undefined) counts[b]++;
  });
  return counts;
}

function renderGraph(){
  const W = 1000, H = 540;
  const cx = W/2, cy = H/2 + 10;
  const n = NOTES.length;
  const counts = computeConnections();
  nodePositions = {};

  const rx = W*0.36, ry = H*0.36;
  NOTES.forEach((note, i) => {
    const angle = (i / Math.max(n,1)) * Math.PI * 2 - Math.PI/2;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    const conn = counts[note.id] || 0;
    const r = 20 + Math.min(conn, 6) * 4.2;
    nodePositions[note.id] = { x, y, r, area: note.area, title: note.title };
  });

  let defs = `
    <defs>
      <radialGradient id="coreGrad" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stop-color="#c7a5ff"/>
        <stop offset="55%" stop-color="${AREA.projetos.color}"/>
        <stop offset="100%" stop-color="#3a1f7a"/>
      </radialGradient>
      <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#2dd4ff"/>
      </linearGradient>
      <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="glowSoft" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>`;

  let edgesSvg = "";
  let raysSvg = "";
  const edgeCurves = []; // guarda pontos p/ animação de sinapses

  REL.forEach(([aId, bId]) => {
    const A = nodePositions[aId], B = nodePositions[bId];
    if(!A || !B) return;
    const mx = (A.x + B.x)/2, my = (A.y + B.y)/2;
    const cxp = mx + (cx - mx) * 0.35;
    const cyp = my + (cy - my) * 0.35;
    edgesSvg += `<path d="M ${A.x} ${A.y} Q ${cxp} ${cyp} ${B.x} ${B.y}" fill="none" stroke="url(#edgeGrad)" stroke-width="1.4" opacity="0.55" stroke-dasharray="6 7" class="edge-dash"/>`;
    edgeCurves.push({ A, C:{x:cxp,y:cyp}, B });
  });

  NOTES.forEach(note => {
    const pos = nodePositions[note.id];
    const color = (AREA[note.area] || AREA.meta).color;
    raysSvg += `<line x1="${cx}" y1="${cy}" x2="${pos.x}" y2="${pos.y}" stroke="${color}" stroke-width="0.7" opacity="0.22"/>`;
  });

  let nodesSvg = "";
  NOTES.forEach(note => {
    const pos = nodePositions[note.id];
    const color = (AREA[note.area] || AREA.meta).color;
    const labelSafe = escapeXml(note.title);
    nodesSvg += `
      <g class="graph-node" data-id="${note.id}" style="cursor:pointer">
        <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r + 7}" fill="none" stroke="${color}" stroke-width="1" opacity="0.4" class="breath-ring"/>
        <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r}" fill="${color}" opacity="0.88" filter="url(#glowSoft)"/>
        <circle cx="${pos.x}" cy="${pos.y}" r="${pos.r}" fill="none" stroke="#00000055" stroke-width="1"/>
        <text x="${pos.x}" y="${pos.y + pos.r + 16}" text-anchor="middle" font-size="11" fill="#e8eaf2" font-family="-apple-system,sans-serif">${labelSafe}</text>
      </g>`;
  });

  const coreSvg = `
    <circle cx="${cx}" cy="${cy}" r="34" fill="url(#coreGrad)" filter="url(#glow)" class="core-pulse"/>
    <circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="#e8eaf2" stroke-width="1" opacity="0.3"/>
    <text x="${cx}" y="${cy+7}" text-anchor="middle" font-size="22">🧠</text>
  `;

  const svgInner = defs + raysSvg + edgesSvg + coreSvg + nodesSvg;
  // CRÍTICO: injeta via innerHTML de uma DIV contêiner, nunca direto num elemento <svg>
  graphContainer.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>`;

  // listeners de clique nos nós
  graphContainer.querySelectorAll(".graph-node").forEach(g => {
    g.addEventListener("click", () => {
      const id = g.getAttribute("data-id");
      const note = NOTES.find(x => x.id === id);
      if(note) openModal(note);
    });
  });

  // (re)inicia animação de sinapses com as curvas atuais
  startSynapseAnimation(edgeCurves);

  // aplica estado de piscar, se houver
  applyBlinkStyles();
}

function escapeXml(str){
  return String(str).replace(/[<>&'"]/g, c => ({
    "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;"
  }[c]));
}

function startSynapseAnimation(curves){
  if(animFrame) cancelAnimationFrame(animFrame);
  if(!curves.length) return;

  synapses = [];
  const count = Math.min(12, Math.max(4, curves.length * 2));
  for(let i=0;i<count;i++){
    synapses.push(makeSynapse(curves));
  }

  function makeSynapse(curveList){
    const curve = curveList[Math.floor(Math.random()*curveList.length)];
    return { curve, t: Math.random(), speed: 0.004 + Math.random()*0.006 };
  }

  function bezierPoint(curve, t){
    const {A,C,B} = curve;
    const mt = 1 - t;
    const x = mt*mt*A.x + 2*mt*t*C.x + t*t*B.x;
    const y = mt*mt*A.y + 2*mt*t*C.y + t*t*B.y;
    return {x,y};
  }

  // camada de pulsos, criada uma vez, atualizada via atributos (não recria innerHTML inteiro por frame)
  const svgEl = graphContainer.querySelector("svg");
  if(!svgEl) return;
  const pulseLayer = document.createElementNS("http://www.w3.org/2000/svg","g");
  pulseLayer.setAttribute("id","pulse-layer");
  svgEl.appendChild(pulseLayer);

  synapses.forEach((s, idx) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg","circle");
    dot.setAttribute("r","3");
    dot.setAttribute("fill","#ffffff");
    dot.setAttribute("filter","url(#glowSoft)");
    dot.setAttribute("id","syn-"+idx);
    pulseLayer.appendChild(dot);
    s.el = dot;
  });

  function tick(){
    synapses.forEach(s => {
      s.t += s.speed;
      if(s.t >= 1){
        s.t = 0;
        s.curve = curves[Math.floor(Math.random()*curves.length)];
      }
      const p = bezierPoint(s.curve, s.t);
      const op = Math.sin(s.t * Math.PI); // sobe e desce
      if(s.el){
        s.el.setAttribute("cx", p.x);
        s.el.setAttribute("cy", p.y);
        s.el.setAttribute("opacity", (0.25 + op*0.75).toFixed(2));
      }
    });
    animFrame = requestAnimationFrame(tick);
  }
  tick();
}

function blinkNode(id){
  blinkTargets[id] = Date.now() + 2200;
  applyBlinkStyles();
  setTimeout(() => { delete blinkTargets[id]; applyBlinkStyles(); }, 2200);
}
function applyBlinkStyles(){
  Object.keys(blinkTargets).forEach(id => {
    const g = graphContainer.querySelector(`.graph-node[data-id="${id}"] circle:nth-child(2)`);
    if(g){
      g.style.animation = "none";
      void g.offsetWidth;
      g.style.filter = "url(#glow)";
      g.style.transition = "filter .3s ease";
    }
  });
}

/* breathing rings via CSS aplicado pós-render (SVG injetado não herda keyframes globais automaticamente, então usamos SMIL simples via classe + JS opacity loop) */
(function breathingLoop(){
  function tick(){
    const t = Date.now()/1000;
    graphContainer.querySelectorAll(".breath-ring").forEach((el, i) => {
      const phase = t*1.2 + i*0.4;
      const scale = 1 + Math.sin(phase)*0.06;
      const op = 0.25 + (Math.sin(phase)*0.5+0.5)*0.3;
      el.setAttribute("opacity", op.toFixed(2));
      el.setAttribute("transform", `scale(${scale.toFixed(3)})`);
      el.style.transformOrigin = "center";
      el.style.transformBox = "fill-box";
    });
    const core = graphContainer.querySelector(".core-pulse");
    if(core){
      const phase2 = t*1.4;
      const scale2 = 1 + Math.sin(phase2)*0.08;
      core.setAttribute("transform", `scale(${scale2.toFixed(3)})`);
      core.style.transformOrigin = "center";
      core.style.transformBox = "fill-box";
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

/* ============================================================
   MÓDULOS NOVOS — Agenda · E-mails · Notícias · Digest · Motor
   Tudo abaixo é ADITIVO: nenhuma função da Parte 1 foi alterada.
   ============================================================ */

/* ---------- helper genérico de chamada única à API (triagem/digest) ---------- */
async function callAnthropicOnce(system, userMsg, maxTokens){
  const apiKey = apikeyInput.value.trim();
  if(!apiKey) return null;
  try{
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: maxTokens || 400,
        system: system,
        messages: [{ role:"user", content: userMsg }]
      })
    });
    if(!response.ok) return null;
    const data = await response.json();
    return (data && data.content && data.content[0] && data.content[0].text) || null;
  }catch(e){ return null; }
}

function antennaOfflineHTML(){
  return `<div class="empty-hint">ANTENA OFFLINE — rode: <code>node server.js</code></div>`;
}
function escapeAttr(str){ return String(str||"").replace(/"/g,"&quot;"); }
function isSameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function formatHM(d){ return d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
function dayKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function dayLabel(d){
  const today = new Date(); const tomorrow = new Date(); tomorrow.setDate(today.getDate()+1);
  if(isSameDay(d,today)) return "HOJE";
  if(isSameDay(d,tomorrow)) return "AMANHÃ";
  const weekday = d.toLocaleDateString("pt-BR",{weekday:"long"}).toUpperCase();
  const dm = d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
  return `${weekday} · ${dm}`;
}
function relativeTime(dateStr){
  if(!dateStr) return "";
  const d = new Date(dateStr);
  if(isNaN(d)) return "";
  const diffMin = Math.round((Date.now()-d.getTime())/60000);
  if(diffMin < 1) return "agora";
  if(diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin/60);
  if(diffH < 24) return `há ${diffH} h`;
  return `há ${Math.round(diffH/24)} d`;
}
function getTodayEventsCompact(){
  const today = new Date();
  const todays = AGENDA_EVENTS.filter(e=>isSameDay(e.start, today)).sort((a,b)=>a.start-b.start);
  if(!todays.length) return "";
  return todays.slice(0,15).map(e => `${e.allDay?"DIA TODO":formatHM(e.start)} ${e.title}`).join(" · ");
}

/* ---------- ABAS ---------- */
function setupTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> switchTab(btn.getAttribute("data-tab")));
  });
}
function switchTab(tab){
  document.querySelectorAll(".tab-btn").forEach(b=> b.classList.toggle("active", b.getAttribute("data-tab")===tab));
  $("panel-brain").classList.toggle("active", tab === "brain");
  document.querySelectorAll(".tab-panel").forEach(p=> p.classList.toggle("active", p.id === "panel-"+tab));
}

/* ---------- CONFIGURAÇÕES (⚙) ---------- */
function setupSettings(){
  settingsBtn.addEventListener("click", ()=> settingsOverlay.classList.add("show"));
  $("settings-close").addEventListener("click", ()=> settingsOverlay.classList.remove("show"));
  settingsOverlay.addEventListener("click", (e)=>{ if(e.target === settingsOverlay) settingsOverlay.classList.remove("show"); });

  document.querySelectorAll(".stab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".stab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".stab-panel").forEach(p=>p.classList.remove("active"));
      btn.classList.add("active");
      $("stab-"+btn.getAttribute("data-stab")).classList.add("active");
    });
  });

  document.querySelectorAll(".model-option").forEach(opt=>{
    opt.classList.toggle("selected", opt.getAttribute("data-model") === CONFIG.model);
    opt.addEventListener("click", ()=>{
      document.querySelectorAll(".model-option").forEach(o=>o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });
  $("economy-toggle").checked = ECONOMY_MODE;

  $("add-calendar-btn").addEventListener("click", ()=>{
    CALENDARS.push({ id:"cal-"+Date.now(), name:"Nova agenda", color:"#ff5547", ics:"" });
    renderCalendarsSettings();
  });
  $("add-email-btn").addEventListener("click", ()=>{
    EMAIL_ACCOUNTS.push({ id:"email-"+Date.now(), nickname:"Nova conta", color:"#2dd4ff", host:"imap.gmail.com", email:"", appPassword:"" });
    renderEmailsSettings();
  });

  $("settings-save").addEventListener("click", ()=>{
    document.querySelectorAll("#calendars-list .entry-row").forEach(row=>{
      const cal = CALENDARS.find(c=>c.id === row.getAttribute("data-id"));
      if(!cal) return;
      cal.name = row.querySelector(".f-name").value.trim() || cal.name;
      cal.color = row.querySelector(".f-color").value || cal.color;
      cal.ics = row.querySelector(".f-ics").value.trim();
    });
    saveJSON("otto_calendars", CALENDARS);

    document.querySelectorAll("#emails-list .entry-row").forEach(row=>{
      const acc = EMAIL_ACCOUNTS.find(a=>a.id === row.getAttribute("data-id"));
      if(!acc) return;
      acc.nickname = row.querySelector(".f-nickname").value.trim() || acc.nickname;
      acc.color = row.querySelector(".f-color").value || acc.color;
      acc.email = row.querySelector(".f-email").value.trim();
      acc.appPassword = row.querySelector(".f-pass").value.trim();
    });
    saveJSON("otto_emails", EMAIL_ACCOUNTS);

    const selectedModel = document.querySelector(".model-option.selected");
    if(selectedModel){
      CONFIG.model = selectedModel.getAttribute("data-model");
      localStorage.setItem("otto_model", CONFIG.model);
    }
    ECONOMY_MODE = $("economy-toggle").checked;
    localStorage.setItem("otto_economy", ECONOMY_MODE ? "true" : "false");

    settingsOverlay.classList.remove("show");
    refreshAgenda(true);
    refreshEmails(true);
  });
}

function renderCalendarsSettings(){
  calendarsList.innerHTML = "";
  CALENDARS.forEach(cal=>{
    const row = document.createElement("div");
    row.className = "entry-row";
    row.setAttribute("data-id", cal.id);
    row.innerHTML = `
      <div class="row-2">
        <div><label>Nome</label><input class="f-name" type="text" value="${escapeAttr(cal.name)}"></div>
        <div><label>Cor</label><input class="f-color" type="color" value="${escapeAttr(cal.color)}"></div>
      </div>
      <label>Endereço secreto iCal</label>
      <input class="f-ics" type="text" placeholder="https://calendar.google.com/calendar/ical/..." value="${escapeAttr(cal.ics)}">
      <button class="entry-remove">Remover</button>`;
    row.querySelector(".entry-remove").addEventListener("click", ()=>{
      CALENDARS = CALENDARS.filter(c=>c.id !== cal.id);
      saveJSON("otto_calendars", CALENDARS);
      renderCalendarsSettings();
    });
    calendarsList.appendChild(row);
  });
}

function renderEmailsSettings(){
  emailsList.innerHTML = "";
  EMAIL_ACCOUNTS.forEach(acc=>{
    const row = document.createElement("div");
    row.className = "entry-row";
    row.setAttribute("data-id", acc.id);
    row.innerHTML = `
      <div class="row-2">
        <div><label>Apelido</label><input class="f-nickname" type="text" value="${escapeAttr(acc.nickname)}"></div>
        <div><label>Cor</label><input class="f-color" type="color" value="${escapeAttr(acc.color)}"></div>
      </div>
      <label>E-mail (Gmail)</label>
      <input class="f-email" type="text" placeholder="voce@gmail.com" value="${escapeAttr(acc.email)}">
      <label>Senha de app (16 letras)</label>
      <input class="f-pass" type="password" placeholder="xxxx xxxx xxxx xxxx" value="${escapeAttr(acc.appPassword)}">
      <button class="entry-remove">Remover</button>`;
    row.querySelector(".entry-remove").addEventListener("click", ()=>{
      EMAIL_ACCOUNTS = EMAIL_ACCOUNTS.filter(a=>a.id !== acc.id);
      saveJSON("otto_emails", EMAIL_ACCOUNTS);
      renderEmailsSettings();
    });
    emailsList.appendChild(row);
  });
}

/* ============================================================
   MÓDULO AGENDA — parser ICS (line unfolding, TZID/UTC/DATE, RRULE)
   ============================================================ */
function unfoldICS(text){
  return text.replace(/\r\n/g,"\n").split("\n").reduce((acc,line)=>{
    if(/^[ \t]/.test(line) && acc.length){
      acc[acc.length-1] += line.slice(1);
    } else if(line.trim().length){
      acc.push(line);
    }
    return acc;
  }, []);
}
function parseICSLine(line){
  const colonIdx = line.indexOf(":");
  if(colonIdx === -1) return null;
  const left = line.slice(0,colonIdx);
  const value = line.slice(colonIdx+1);
  const parts = left.split(";");
  const name = parts[0];
  const params = {};
  parts.slice(1).forEach(p=>{ const [k,v] = p.split("="); if(k) params[k]=v; });
  return { name, params, value };
}
function parseICSDate(value, params){
  value = (value||"").trim();
  const isDateOnly = /^\d{8}$/.test(value) || (params && params.VALUE === "DATE");
  if(isDateOnly){
    const y=+value.slice(0,4), mo=+value.slice(4,6)-1, d=+value.slice(6,8);
    return { date: new Date(y,mo,d), allDay:true };
  }
  const utc = value.endsWith("Z");
  const clean = value.replace("Z","");
  const y=+clean.slice(0,4), mo=+clean.slice(4,6)-1, d=+clean.slice(6,8);
  const h=+clean.slice(9,11)||0, mi=+clean.slice(11,13)||0, s=+clean.slice(13,15)||0;
  const dt = utc ? new Date(Date.UTC(y,mo,d,h,mi,s)) : new Date(y,mo,d,h,mi,s);
  return { date: dt, allDay:false };
}
function unescapeICSText(s){
  return (s||"").replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\");
}
function parseRRule(value){
  const rule = {};
  value.split(";").forEach(p=>{ const [k,v]=p.split("="); rule[k]=v; });
  return rule;
}
function makeOccurrence(ev, dtstart, dtend){
  return {
    title: ev.summary || "(sem título)",
    location: ev.location || "",
    start: dtstart.date,
    end: dtend ? dtend.date : null,
    allDay: dtstart.allDay,
    calName: ev.calName,
    calColor: ev.calColor
  };
}
function expandRecurring(ev){
  const rule = ev.rrule;
  const freq = rule.FREQ;
  const count = rule.COUNT ? parseInt(rule.COUNT,10) : null;
  const until = rule.UNTIL ? parseICSDate(rule.UNTIL,{}).date : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(",") : null;
  const dayMap = { SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6 };

  const windowStart = new Date(); windowStart.setDate(windowStart.getDate()-1); windowStart.setHours(0,0,0,0);
  const windowEnd = new Date(); windowEnd.setDate(windowEnd.getDate()+8); windowEnd.setHours(23,59,59,999);

  const occurrences = [];
  let cursor = new Date(ev.dtstart.date);
  const duration = ev.dtend ? (ev.dtend.date.getTime()-ev.dtstart.date.getTime()) : 0;
  let n = 0, safety = 0;

  while(cursor <= windowEnd && safety < 3000){
    safety++;
    let matches = true;
    if(byday && (freq === "WEEKLY" || freq === "MONTHLY")){
      const dayCode = Object.keys(dayMap).find(k=>dayMap[k]===cursor.getDay());
      matches = byday.some(bd => bd.replace(/[-+0-9]/g,"") === dayCode);
    }
    if(matches){
      n++;
      if(!ev.exdates.includes(cursor.getTime()) && cursor >= windowStart && cursor <= windowEnd){
        const end = duration ? new Date(cursor.getTime()+duration) : null;
        occurrences.push(makeOccurrence(ev, {date:new Date(cursor), allDay:ev.dtstart.allDay}, end?{date:end}:null));
      }
      if(count && n >= count) break;
    }
    if(until && cursor > until) break;
    if(freq === "DAILY"){
      cursor.setDate(cursor.getDate() + (parseInt(rule.INTERVAL,10)||1));
    } else if(freq === "WEEKLY"){
      cursor.setDate(cursor.getDate() + (byday ? 1 : 7*(parseInt(rule.INTERVAL,10)||1)));
    } else if(freq === "MONTHLY"){
      cursor.setDate(cursor.getDate() + (byday ? 1 : 0));
      if(!byday) cursor.setMonth(cursor.getMonth() + (parseInt(rule.INTERVAL,10)||1));
    } else if(freq === "YEARLY"){
      cursor.setFullYear(cursor.getFullYear() + (parseInt(rule.INTERVAL,10)||1));
    } else {
      break;
    }
  }
  return occurrences;
}
function parseICS(text, calMeta){
  const lines = unfoldICS(text);
  const events = [];
  let cur = null;
  lines.forEach(rawLine=>{
    const line = parseICSLine(rawLine);
    if(!line) return;
    if(line.name === "BEGIN" && line.value === "VEVENT"){ cur = { summary:"", location:"", exdates:[] }; return; }
    if(line.name === "END" && line.value === "VEVENT"){ if(cur) events.push(cur); cur = null; return; }
    if(!cur) return;
    switch(line.name){
      case "SUMMARY": cur.summary = unescapeICSText(line.value); break;
      case "LOCATION": cur.location = unescapeICSText(line.value); break;
      case "DTSTART": cur.dtstart = parseICSDate(line.value, line.params); break;
      case "DTEND": cur.dtend = parseICSDate(line.value, line.params); break;
      case "RRULE": cur.rrule = parseRRule(line.value); break;
      case "EXDATE": cur.exdates.push(parseICSDate(line.value, line.params).date.getTime()); break;
    }
  });
  const expanded = [];
  events.forEach(ev=>{
    if(!ev.dtstart) return;
    ev.calName = calMeta.name; ev.calColor = calMeta.color;
    if(ev.rrule){ expandRecurring(ev).forEach(o=>expanded.push(o)); }
    else { expanded.push(makeOccurrence(ev, ev.dtstart, ev.dtend)); }
  });
  return expanded;
}

async function refreshAgenda(force){
  if(!CALENDARS.some(c=>c.ics)){
    agendaBody.innerHTML = `<div class="empty-hint">Nenhuma agenda configurada ainda. Clique em ⚙ → Agenda e cole o endereço secreto iCal.</div>`;
    AGENDA_EVENTS = [];
    return;
  }
  agendaBody.innerHTML = `<div class="empty-hint">Carregando agenda...</div>`;
  let allEvents = [], anyOnline = false;
  for(const cal of CALENDARS){
    if(!cal.ics) continue;
    try{
      const res = await fetch(`${ANTENNA_BASE}/proxy?url=${encodeURIComponent(cal.ics)}`);
      if(!res || !res.ok) throw new Error("falhou");
      anyOnline = true;
      const text = await res.text();
      allEvents = allEvents.concat(parseICS(text, cal));
    }catch(e){ /* essa agenda falhou, segue com as outras */ }
  }
  if(!anyOnline){ agendaBody.innerHTML = antennaOfflineHTML(); return; }
  allEvents.sort((a,b)=>a.start-b.start);
  AGENDA_EVENTS = allEvents;
  renderAgendaPanel();
}

function renderAgendaPanel(){
  const now = new Date();
  const windowEnd = new Date(); windowEnd.setDate(windowEnd.getDate()+7); windowEnd.setHours(23,59,59,999);
  const todayStart = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const visible = AGENDA_EVENTS.filter(e => e.start <= windowEnd && (e.end ? e.end >= now : e.start >= todayStart));
  if(!visible.length){ agendaBody.innerHTML = `<div class="empty-hint">Nenhum evento nos próximos 7 dias.</div>`; return; }

  let html = "";
  const next = visible.find(e => e.start > now);
  if(next){
    const diffMs = next.start - now;
    const h = Math.floor(diffMs/3600000), m = Math.floor((diffMs%3600000)/60000);
    html += `<div class="agenda-countdown" id="agenda-countdown-el">Próximo: ${escapeXml(next.title)} em ${h}h ${m}min</div>`;
  }

  const groups = {};
  visible.forEach(e=>{ const k = dayKey(e.start); (groups[k] = groups[k]||[]).push(e); });
  Object.keys(groups).sort().forEach(key=>{
    const dayEvents = groups[key].sort((a,b)=>a.start-b.start);
    html += `<div class="agenda-daylabel">${dayLabel(dayEvents[0].start)}</div>`;
    dayEvents.forEach(e=>{
      const time = e.allDay ? "DIA TODO" : formatHM(e.start);
      html += `<div class="agenda-event" style="border-left-color:${e.calColor}">
        <div class="dot-time">${time}</div>
        <div>
          <div class="ev-title">${escapeXml(e.title)}</div>
          ${e.location ? `<div class="ev-loc">📍 ${escapeXml(e.location)}</div>` : ""}
          <div class="ev-cal">${escapeXml(e.calName)}</div>
        </div></div>`;
    });
  });
  agendaBody.innerHTML = html;
}

function startAgendaCountdownTicker(){
  if(agendaCountdownTimer) clearInterval(agendaCountdownTimer);
  agendaCountdownTimer = setInterval(()=>{
    const el = $("agenda-countdown-el");
    if(!el || !AGENDA_EVENTS.length) return;
    const now = new Date();
    const next = AGENDA_EVENTS.filter(e=>e.start>now).sort((a,b)=>a.start-b.start)[0];
    if(!next) return;
    const diffMs = next.start-now;
    if(diffMs<=0){ renderAgendaPanel(); return; }
    const h = Math.floor(diffMs/3600000), m = Math.floor((diffMs%3600000)/60000);
    el.textContent = `Próximo: ${next.title} em ${h}h ${m}min`;
  }, 60000);
}
$("agenda-refresh").addEventListener("click", ()=> refreshAgenda(true));

function speakAgendaToday(){
  const today = new Date();
  const todays = AGENDA_EVENTS.filter(e=>isSameDay(e.start,today)).sort((a,b)=>a.start-b.start);
  const msg = !todays.length
    ? `Sua agenda de hoje está livre, ${CONFIG.address}.`
    : `Hoje você tem: ${todays.map(e=>`${e.allDay?"o dia todo":formatHM(e.start)}, ${e.title}`).join("; ")}.`;
  assistantLine.textContent = msg; speak(msg, ()=>{});
}
function speakNextEvent(){
  const now = new Date();
  const next = AGENDA_EVENTS.filter(e=>e.start>now).sort((a,b)=>a.start-b.start)[0];
  if(!next){ const msg=`Não encontrei nenhum compromisso futuro, ${CONFIG.address}.`; assistantLine.textContent=msg; speak(msg,()=>{}); return; }
  const diffMs = next.start-now;
  const h=Math.floor(diffMs/3600000), m=Math.floor((diffMs%3600000)/60000);
  const msg = `Seu próximo compromisso é ${next.title}, em ${h} horas e ${m} minutos.`;
  assistantLine.textContent = msg; speak(msg, ()=>{});
}
function speakAgendaWeek(){
  const now = new Date(); const windowEnd = new Date(); windowEnd.setDate(windowEnd.getDate()+7);
  const upcoming = AGENDA_EVENTS.filter(e=>e.start>=now && e.start<=windowEnd).sort((a,b)=>a.start-b.start);
  if(!upcoming.length){ const msg=`Sua semana está livre, ${CONFIG.address}.`; assistantLine.textContent=msg; speak(msg,()=>{}); return; }
  const byDay = {};
  upcoming.forEach(e=>{ const l=dayLabel(e.start); byDay[l]=(byDay[l]||0)+1; });
  const msg = `Sua semana: ${Object.entries(byDay).map(([l,c])=>`${l}: ${c} compromisso${c>1?"s":""}`).join("; ")}.`;
  assistantLine.textContent = msg; speak(msg, ()=>{});
}

/* ============================================================
   MÓDULO E-MAILS — via antena (/emails), triagem com cache
   ============================================================ */
async function refreshEmails(force){
  if(!EMAIL_ACCOUNTS.some(a=>a.email && a.appPassword)){
    emailsBody.innerHTML = `<div class="empty-hint">Nenhuma conta configurada ainda. Clique em ⚙ → E-mails e siga o passo a passo.</div>`;
    emailsSub.textContent = "";
    updateActionBadge(0);
    return;
  }
  emailsBody.innerHTML = `<div class="empty-hint">Carregando e-mails...</div>`;
  let allEmails = [], anyOnline = false, anyError = false;
  for(const acc of EMAIL_ACCOUNTS){
    if(!acc.email || !acc.appPassword) continue;
    try{
      const res = await fetch(`${ANTENNA_BASE}/emails`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ host: acc.host||"imap.gmail.com", usuario: acc.email, senhaApp: acc.appPassword, quantidade: EMAILS_PER_ACCOUNT })
      });
      if(!res || !res.ok){ anyError = true; continue; }
      anyOnline = true;
      const data = await res.json();
      (data.emails||[]).forEach(m=>{ m.accountColor = acc.color; m.accountNickname = acc.nickname; });
      allEmails = allEmails.concat(data.emails||[]);
    }catch(e){ anyError = true; }
  }
  if(!anyOnline){
    emailsBody.innerHTML = anyError
      ? `<div class="empty-hint">Não consegui conectar às contas. Confira a senha de app em ⚙ → E-mails.</div>`
      : antennaOfflineHTML();
    updateActionBadge(0);
    return;
  }
  await triageEmails(allEmails);
}

async function triageEmails(rawEmails){
  const cached = [], fresh = [];
  rawEmails.forEach(m=>{
    if(EMAIL_TRIAGE_CACHE[m.id]) cached.push(Object.assign({}, m, EMAIL_TRIAGE_CACHE[m.id]));
    else fresh.push(m);
  });
  if(fresh.length){
    let triaged = ECONOMY_MODE ? null : null;
    triaged = await triageViaAPI(fresh);
    if(!triaged) triaged = fresh.map(m => Object.assign({}, m, heuristicTriage(m)));
    triaged.forEach(m=>{ EMAIL_TRIAGE_CACHE[m.id] = { balde:m.balde, resumo:m.resumo }; });
    saveJSON("otto_email_triage", EMAIL_TRIAGE_CACHE);
    EMAIL_ITEMS = cached.concat(triaged);
  } else {
    EMAIL_ITEMS = cached;
  }
  EMAIL_ITEMS.sort((a,b)=> new Date(b.data||0) - new Date(a.data||0));
  renderEmailsPanel();
}

async function triageViaAPI(emails){
  const apiKey = apikeyInput.value.trim();
  if(!apiKey) return null;
  const compact = emails.map(m=>({ id:m.id, de:m.remetente||"", assunto:m.assunto||"", trecho:(m.trecho||"").slice(0,200) }));
  const system = `Você tria e-mails em 3 baldes: "acao" (pede resposta, tarefa, decisão ou tem prazo — alguém esperando o usuário), "info" (vale saber mas não exige nada: confirmação, recibo, atualização), "ruido" (promoção, newsletter, notificação automática). Responda SOMENTE um array JSON válido, sem nenhum texto antes ou depois, no formato: [{"id":"...","balde":"acao|info|ruido","resumo":"uma frase curta em português"}]`;
  const text = await callAnthropicOnce(system, JSON.stringify(compact), 900);
  if(!text) return null;
  try{
    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
    return emails.map(m=>{
      const found = parsed.find(p=>p.id===m.id);
      return Object.assign({}, m, found ? { balde:found.balde, resumo:found.resumo } : heuristicTriage(m));
    });
  }catch(e){ return null; }
}

function heuristicTriage(m){
  const blob = normalize(`${m.remetente||""} ${m.assunto||""}`);
  if(/noreply|newsletter|unsubscribe|promo(cao|tion)|no-reply/.test(blob)) return { balde:"ruido", resumo:"Triagem local: parece promocional ou automático." };
  if(/(prazo|fatura|reuniao|por favor|confirma|responda|urgente|pendente)/.test(blob)) return { balde:"acao", resumo:"Triagem local: parece pedir uma ação sua." };
  return { balde:"info", resumo:"Triagem local: informativo." };
}

function renderEmailsPanel(){
  const acao = EMAIL_ITEMS.filter(e=>e.balde==="acao");
  const info = EMAIL_ITEMS.filter(e=>e.balde==="info");
  const ruido = EMAIL_ITEMS.filter(e=>e.balde==="ruido");
  emailsSub.textContent = `${EMAIL_ITEMS.length} e-mails · ${acao.length} pedindo ação`;
  updateActionBadge(acao.length);

  let html = `<div class="bucket-label bucket-acao">⚡ AÇÃO (${acao.length})</div>`;
  html += acao.length ? acao.map(emailItemHtml).join("") : `<div class="empty-hint">Nada pendente por aqui.</div>`;
  html += `<div class="bucket-label bucket-info">ℹ️ INFO (${info.length})</div>`;
  html += info.length ? info.map(emailItemHtml).join("") : `<div class="empty-hint">Sem novidades.</div>`;
  html += `<div class="bucket-label bucket-ruido" id="toggle-ruido">🔕 RUÍDO (${ruido.length}) · clique pra ver</div>`;
  html += `<div id="bucket-ruido-body">${ruido.map(emailItemHtml).join("")}</div>`;
  emailsBody.innerHTML = html;

  $("toggle-ruido").addEventListener("click", ()=> $("bucket-ruido-body").classList.toggle("show"));
  emailsBody.querySelectorAll(".email-item").forEach(el=> el.addEventListener("click", ()=> el.classList.toggle("expanded")));
}
function emailItemHtml(m){
  return `<div class="email-item">
    <div class="em-top">
      <span class="em-dot" style="background:${m.accountColor||'#ff3b30'}"></span>
      <span class="em-from">${escapeXml(m.remetente||"")}</span>
      <span class="em-time">${relativeTime(m.data)}</span>
    </div>
    <div class="em-summary">${escapeXml(m.resumo||m.assunto||"")}</div>
    <div class="em-excerpt">${escapeXml(m.assunto||"")}\n\n${escapeXml((m.trecho||"").slice(0,400))}</div>
  </div>`;
}
function updateActionBadge(count){
  [hudBadge, tabBadge].forEach(el=>{
    if(!el) return;
    if(count > 0){ el.style.display="inline-block"; el.textContent=String(count); }
    else { el.style.display="none"; }
  });
}
$("emails-refresh").addEventListener("click", ()=> refreshEmails(true));

function speakActionEmails(onlyAction){
  const acao = EMAIL_ITEMS.filter(e=>e.balde==="acao");
  if(onlyAction){
    const msg = !acao.length
      ? `Nenhum e-mail pedindo ação, ${CONFIG.address}. Tudo em dia.`
      : `Você tem ${acao.length} e-mails de ação: ${acao.slice(0,5).map(e=>`${e.remetente}: ${e.resumo}`).join("; ")}.`;
    assistantLine.textContent = msg; speak(msg, ()=>{});
    return;
  }
  const info = EMAIL_ITEMS.filter(e=>e.balde==="info").length;
  const ruido = EMAIL_ITEMS.filter(e=>e.balde==="ruido").length;
  const msg = `Você tem ${EMAIL_ITEMS.length} e-mails: ${acao.length} de ação, ${info} informativos e ${ruido} de ruído.`;
  assistantLine.textContent = msg; speak(msg, ()=>{});
}

/* ============================================================
   MÓDULO NOTÍCIAS — RSS do Google News via antena
   ============================================================ */
async function fetchNewsSubject(subject, force){
  const cacheEntry = NEWS_CACHE[subject];
  if(!force && cacheEntry && (Date.now()-cacheEntry.ts) < NEWS_REFRESH_MS) return cacheEntry.items;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(subject)}&hl=${NEWS_LOCALE.hl}&gl=${NEWS_LOCALE.gl}&ceid=${NEWS_LOCALE.ceid}`;
  try{
    const res = await fetch(`${ANTENNA_BASE}/proxy?url=${encodeURIComponent(rssUrl)}`);
    if(!res || !res.ok) return null;
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, "text/xml");
    const items = Array.from(xml.querySelectorAll("item")).slice(0, NEWS_PER_SUBJECT).map(it=>({
      title: (it.querySelector("title")?.textContent || "").replace(/\s-\s[^-]+$/, ""),
      link: it.querySelector("link")?.textContent || "",
      pubDate: it.querySelector("pubDate")?.textContent || "",
      source: it.querySelector("source")?.textContent || ""
    }));
    NEWS_CACHE[subject] = { ts: Date.now(), items };
    saveJSON("otto_news_cache", NEWS_CACHE);
    return items;
  }catch(e){ return null; }
}
async function refreshNews(force){
  newsBody.innerHTML = `<div class="empty-hint">Buscando manchetes...</div>`;
  let anyOnline = false, html = "";
  for(const subject of NEWS_SUBJECTS){
    const items = await fetchNewsSubject(subject, force);
    if(items){
      anyOnline = true;
      html += `<div class="news-subject">${escapeXml(subject.toUpperCase())}</div>`;
      html += items.length ? items.map(newsItemHtml).join("") : `<div class="empty-hint">Nenhuma manchete encontrada.</div>`;
    }
  }
  if(!anyOnline){
    const anyCache = NEWS_SUBJECTS.some(s=>NEWS_CACHE[s]);
    if(anyCache){
      html = "";
      NEWS_SUBJECTS.forEach(subject=>{
        const entry = NEWS_CACHE[subject]; if(!entry) return;
        html += `<div class="news-subject">${escapeXml(subject.toUpperCase())} <span style="color:var(--text-dim);font-weight:400;">(cache)</span></div>`;
        html += entry.items.map(newsItemHtml).join("");
      });
      newsBody.innerHTML = html || antennaOfflineHTML();
    } else { newsBody.innerHTML = antennaOfflineHTML(); }
    return;
  }
  newsBody.innerHTML = html;
}
function newsItemHtml(item){
  return `<a class="news-item" href="${escapeAttr(item.link)}" target="_blank" rel="noopener">
    ${escapeXml(item.title)}
    <div class="nw-src">${escapeXml(item.source)} · ${relativeTime(item.pubDate)}</div>
  </a>`;
}
$("news-refresh").addEventListener("click", ()=> refreshNews(true));

function speakAllNews(){
  const lines = [];
  NEWS_SUBJECTS.forEach(subject=>{
    const entry = NEWS_CACHE[subject];
    if(entry && entry.items.length) lines.push(`Em ${subject}: ${entry.items[0].title}.`);
  });
  if(!lines.length){
    const msg = `Ainda não tenho manchetes carregadas, ${CONFIG.address}. Um segundo.`;
    assistantLine.textContent = msg; speak(msg, ()=>{});
    refreshNews(true);
    return;
  }
  const msg = lines.join(" ");
  assistantLine.textContent = msg; speak(msg, ()=>{});
}
function speakNewsSubject(subjectSpoken){
  const subjectNorm = normalize(subjectSpoken);
  const match = NEWS_SUBJECTS.find(s => normalize(s).includes(subjectNorm) || subjectNorm.includes(normalize(s)));
  if(!match){ const msg=`Não tenho ${subjectSpoken} configurado no seu radar, ${CONFIG.address}.`; assistantLine.textContent=msg; speak(msg,()=>{}); return; }
  const entry = NEWS_CACHE[match];
  if(!entry || !entry.items.length){ const msg=`Ainda não tenho manchetes de ${match}, ${CONFIG.address}.`; assistantLine.textContent=msg; speak(msg,()=>{}); return; }
  const msg = `Em ${match}: ${entry.items.slice(0,3).map(i=>i.title).join("; ")}.`;
  assistantLine.textContent = msg; speak(msg, ()=>{});
}

/* ============================================================
   MÓDULO MORNING DIGEST
   ============================================================ */
async function maybeAutoDigest(){
  if(LAST_DIGEST_DATE === dayKey(new Date())) return;
  setTimeout(()=> runDigest(false), 4000);
}

async function runDigest(spokenTrigger){
  digestBody.innerHTML = `<div class="empty-hint">Montando seu briefing...</div>`;
  if(spokenTrigger) switchTab("digest");

  const now = new Date();
  const weekday = now.toLocaleDateString("pt-BR",{weekday:"long"});
  const dateStr = now.toLocaleDateString("pt-BR",{day:"2-digit",month:"long"});
  const weatherLine = DIGEST_CONFIG.weather ? await getWeatherSummary() : "";

  const todays = AGENDA_EVENTS.filter(e=>isSameDay(e.start, now)).sort((a,b)=>a.start-b.start);
  const agendaLines = todays.slice(0,15).map(e => `${e.allDay?"dia todo":formatHM(e.start)} · ${e.title}`);
  const acao = EMAIL_ITEMS.filter(e=>e.balde==="acao");
  const newsLines = [];
  NEWS_SUBJECTS.forEach(subject=>{
    const entry = NEWS_CACHE[subject];
    if(entry && entry.items.length) newsLines.push(`${subject}: ${entry.items.slice(0,3).map(i=>i.title).join(" / ")}`);
  });
  const metas = NOTES.filter(n=>n.area==="metas").slice(0,2).map(n=>n.body);

  const packet = {
    diaSemana: weekday, data: dateStr, clima: weatherLine,
    agenda: agendaLines, emailsAcao: acao.length, resumosAcao: acao.slice(0,5).map(e=>e.resumo||e.assunto),
    noticias: newsLines, metas
  };

  const maxTokens = DIGEST_CONFIG.size === "medio" ? 800 : 500;
  let digestText = null;
  if(apikeyInput.value.trim()){
    const system = buildSystemPromptBase() + `\n\nMonte um Morning Digest: um briefing corrido, natural e falável, na sua personalidade, com saudação, dia da semana e data, clima se houver, a agenda de hoje evento por evento, quantos e-mails pedem ação (citando os resumos), as principais manchetes de cada assunto, e termine com uma frase de foco do dia conectada às metas do usuário. Tamanho ${DIGEST_CONFIG.size==="medio" ? "médio (~1 minuto falado)" : "curto (~30 segundos falados)"}. Sem markdown, sem emojis, em português do Brasil.`;
    digestText = await callAnthropicOnce(system, `Dados do dia: ${JSON.stringify(packet)}`, maxTokens);
  }
  if(!digestText) digestText = buildDigestFallback(packet);

  LAST_DIGEST_DATE = dayKey(now);
  localStorage.setItem("otto_last_digest", LAST_DIGEST_DATE);

  digestBody.innerHTML = `<div id="digest-meta">${weekday}, ${dateStr}${weatherLine ? " · " + escapeXml(weatherLine) : ""}</div><div id="digest-text">${escapeXml(digestText)}</div>`;
  assistantLine.textContent = digestText;
  if(DIGEST_CONFIG.speak) speak(digestText, ()=>{});
}

function buildDigestFallback(packet){
  let text = `Bom dia, ${CONFIG.address}. Hoje é ${packet.diaSemana}, ${packet.data}.`;
  if(packet.clima) text += ` ${packet.clima}.`;
  text += packet.agenda.length ? ` Sua agenda: ${packet.agenda.join("; ")}.` : ` Sua agenda está livre hoje.`;
  text += packet.emailsAcao > 0 ? ` Você tem ${packet.emailsAcao} e-mails pedindo ação: ${packet.resumosAcao.join("; ")}.` : ` Nenhum e-mail pedindo ação.`;
  if(packet.noticias.length) text += ` Notícias: ${packet.noticias.join(". ")}.`;
  if(packet.metas.length) text += ` Foco do dia: ${packet.metas[0]}`;
  return text;
}

async function getWeatherSummary(){
  try{
    const geoKey = "otto_geocode_" + slugify(DIGEST_CONFIG.city);
    let coords = loadJSON(geoKey, null);
    if(!coords){
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(DIGEST_CONFIG.city)}&count=1&language=pt&format=json`);
      const geoData = await geoRes.json();
      if(!geoData.results || !geoData.results.length) return "";
      coords = { lat: geoData.results[0].latitude, lon: geoData.results[0].longitude };
      saveJSON(geoKey, coords);
    }
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`);
    const wData = await wRes.json();
    if(!wData.daily) return "";
    const max = Math.round(wData.daily.temperature_2m_max[0]);
    const min = Math.round(wData.daily.temperature_2m_min[0]);
    const rain = wData.daily.precipitation_probability_max[0];
    return `Em ${DIGEST_CONFIG.city}: mínima de ${min}° e máxima de ${max}°, ${rain}% de chance de chuva`;
  }catch(e){ return ""; }
}
$("digest-btn").addEventListener("click", ()=> runDigest(true));

})();
