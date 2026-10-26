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

const DEFAULT_NOTES=[];

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
  economico: "claude-haiku-4-5-20251001",
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
  city: "Cidade não definida",
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

/* ======================= AUXILIARY FUNCTIONS ======================= */
function showError(msg) {
  if (errorToast) {
    errorToast.textContent = msg;
    errorToast.classList.add("show");
    setTimeout(() => errorToast.classList.remove("show"), 4000);
  } else {
    console.error(msg);
  }
}

/* ======================= BOOT SEQUENCE ======================= */
window.addEventListener("load", () => {
  try{
    const savedKey = localStorage.getItem("anthropic_key");
    if(savedKey) apikeyInput.value = savedKey;
  }catch(e){}

  setTimeout(() => {
    if (bootScreen) {
      bootScreen.classList.add("fade");
      setTimeout(() => {
        bootScreen.style.display = "none";
        if (activationScreen) activationScreen.classList.add("show");
      }, 800);
    }
  }, 2200);
});

// Correção e Conclusão do botão de Salvar a API Key
if (savekeyBtn) {
  savekeyBtn.addEventListener("click", () => {
    const key = apikeyInput.value.trim();
    if(!key){
      showError("Cole uma API key antes de salvar.");
      return;
    }
    try{
      localStorage.setItem("anthropic_key", key);
      const originalText = savekeyBtn.textContent;
      savekeyBtn.textContent = "Salvo!";
      savekeyBtn.disabled = true;
      setTimeout(() => {
        savekeyBtn.textContent = originalText;
        savekeyBtn.disabled = false;
      }, 2000);
    }catch(e){
      showError("Não foi possível salvar no armazenamento local.");
    }
  });
}

/* ---------- Controle do painel de configurações (Módulos Novos) ---------- */
if (settingsBtn && settingsOverlay) {
  settingsBtn.addEventListener("click", () => {
    settingsOverlay.classList.toggle("show");
  });
}

})();