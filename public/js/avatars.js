// ═══════════════════════════════════════════════════════════════════════════════
//  LAWTECH PRO — Sistema de Avatares
//  avatars.js
//  Inclua este arquivo ANTES de chat.js:
//    <script src="/js/avatars.js"></script>
//    <script src="/js/chat.js"></script>
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Paletas ───────────────────────────────────────────────────────────────────
const SKIN = {
  claro:    { base: '#FDDBB4', sombra: '#F5C49A', boca: '#c9856a' },
  medio:    { base: '#D4956A', sombra: '#C07A50', boca: '#a05a38' },
  moreno:   { base: '#A0674A', sombra: '#8A5038', boca: '#7a3a22' },
  escuro:   { base: '#5C3317', sombra: '#4A2510', boca: '#3a1a08' },
  oliva:    { base: '#C8A882', sombra: '#B08E64', boca: '#8a6040' },
};

const HAIR = {
  loiro:    '#F5D060',
  castanho: '#7B4F2E',
  preto:    '#1C1C1C',
  ruivo:    '#C0392B',
  grisalho: '#9E9E9E',
  branco:   '#E8E8E8',
};

const EYES = {
  castanho: '#6B3A2A',
  azul:     '#2980B9',
  verde:    '#27AE60',
  preto:    '#1a1a1a',
  mel:      '#A0522D',
};

// ─── Biblioteca de avatares ────────────────────────────────────────────────────
// Cada avatar é uma função (sk, hr, ey, opcoes) → string SVG 80×80
// Variações: sexo (m/f), cabelo, pele, olhos, óculos, barba, acessórios

function _base(sk, hr, ey, opts = {}) {
  const s = SKIN[sk] || SKIN.claro;
  const h = HAIR[hr] || HAIR.castanho;
  const e = EYES[ey] || EYES.castanho;
  const { glasses = false, beard = false, earring = false, hairStyle = 'curto', lipstick = false } = opts;

  // ── Corpo / pescoço ──
  const neck = `<rect x="32" y="54" width="16" height="10" rx="4" fill="${s.base}"/>`;
  const body = `<rect x="14" y="63" width="52" height="20" rx="10" fill="#2A4A73"/>`;

  // ── Rosto ──
  const face = `<ellipse cx="40" cy="38" rx="20" ry="22" fill="${s.base}"/>`;
  const cheeks = `<ellipse cx="25" cy="42" rx="5" ry="3" fill="${s.sombra}" opacity="0.35"/>
                  <ellipse cx="55" cy="42" rx="5" ry="3" fill="${s.sombra}" opacity="0.35"/>`;

  // ── Nariz ──
  const nose = `<ellipse cx="40" cy="42" rx="2.5" ry="2" fill="${s.sombra}" opacity="0.5"/>`;

  // ── Boca ──
  const mouthColor = lipstick ? '#e0435a' : s.boca;
  const mouth = `<path d="M35 48 Q40 52 45 48" stroke="${mouthColor}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;

  // ── Olhos ──
  const eyeWhiteL = `<ellipse cx="33" cy="37" rx="4.5" ry="3.5" fill="white"/>`;
  const eyeWhiteR = `<ellipse cx="47" cy="37" rx="4.5" ry="3.5" fill="white"/>`;
  const eyeIrisL  = `<circle cx="33.5" cy="37.5" r="2.2" fill="${e}"/>`;
  const eyeIrisR  = `<circle cx="47.5" cy="37.5" r="2.2" fill="${e}"/>`;
  const eyePupilL = `<circle cx="34" cy="37.5" r="1" fill="#111"/>`;
  const eyePupilR = `<circle cx="48" cy="37.5" r="1" fill="#111"/>`;
  const eyeShineL = `<circle cx="34.5" cy="36.8" r="0.6" fill="white" opacity="0.9"/>`;
  const eyeShineR = `<circle cx="48.5" cy="36.8" r="0.6" fill="white" opacity="0.9"/>`;

  // ── Sobrancelhas ──
  const browColor = (hr === 'loiro') ? '#c9a840' : (hr === 'ruivo') ? '#a02010' : (hr === 'grisalho' || hr === 'branco') ? '#888' : '#333';
  const browsM = `<path d="M29 33 Q33 31 37 33" stroke="${browColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                  <path d="M43 33 Q47 31 51 33" stroke="${browColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  const browsF = `<path d="M29 33 Q33 30.5 37 32.5" stroke="${browColor}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
                  <path d="M43 32.5 Q47 30.5 51 33" stroke="${browColor}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;

  // ── Orelhas ──
  const ears = `<ellipse cx="20" cy="39" rx="3.5" ry="4.5" fill="${s.base}"/>
                <ellipse cx="60" cy="39" rx="3.5" ry="4.5" fill="${s.base}"/>
                <ellipse cx="20" cy="39" rx="2" ry="2.8" fill="${s.sombra}" opacity="0.3"/>
                <ellipse cx="60" cy="39" rx="2" ry="2.8" fill="${s.sombra}" opacity="0.3"/>`;

  // ── Óculos ──
  const glassesEl = glasses ? `
    <rect x="27.5" y="33.5" width="11" height="8" rx="3" fill="none" stroke="#2A4A73" stroke-width="1.5" opacity="0.85"/>
    <rect x="41.5" y="33.5" width="11" height="8" rx="3" fill="none" stroke="#2A4A73" stroke-width="1.5" opacity="0.85"/>
    <line x1="38.5" y1="37.5" x2="41.5" y2="37.5" stroke="#2A4A73" stroke-width="1.3" opacity="0.85"/>
    <line x1="23.5" y1="37" x2="27.5" y2="37" stroke="#2A4A73" stroke-width="1.3" opacity="0.85"/>
    <line x1="52.5" y1="37" x2="56.5" y2="37" stroke="#2A4A73" stroke-width="1.3" opacity="0.85"/>` : '';

  // ── Brinco ──
  const earringEl = earring ? `
    <circle cx="60" cy="45" r="2" fill="#F4D06F" stroke="#c9a500" stroke-width="0.5"/>
    <circle cx="20" cy="45" r="2" fill="#F4D06F" stroke="#c9a500" stroke-width="0.5"/>` : '';

  // ── Barba ──
  const beardEl = beard ? `
    <path d="M24 46 Q40 58 56 46 Q52 56 40 59 Q28 56 24 46Z" fill="${h}" opacity="0.55"/>` : '';

  // ── Cabelos por estilo ──
  let hairEl = '';
  if (hairStyle === 'curto') {
    hairEl = `<ellipse cx="40" cy="22" rx="20" ry="13" fill="${h}"/>
              <rect x="20" y="22" width="40" height="10" fill="${h}"/>`;
  } else if (hairStyle === 'medio') {
    hairEl = `<ellipse cx="40" cy="21" rx="21" ry="13" fill="${h}"/>
              <rect x="20" y="21" width="40" height="12" fill="${h}"/>
              <rect x="19" y="28" width="5" height="20" rx="3" fill="${h}"/>
              <rect x="56" y="28" width="5" height="20" rx="3" fill="${h}"/>`;
  } else if (hairStyle === 'longo') {
    hairEl = `<ellipse cx="40" cy="20" rx="21" ry="13" fill="${h}"/>
              <rect x="20" y="20" width="40" height="14" fill="${h}"/>
              <rect x="18" y="28" width="6" height="36" rx="4" fill="${h}"/>
              <rect x="56" y="28" width="6" height="36" rx="4" fill="${h}"/>`;
  } else if (hairStyle === 'cacheado') {
    hairEl = `<ellipse cx="40" cy="20" rx="22" ry="14" fill="${h}"/>
              <circle cx="22" cy="26" r="7" fill="${h}"/>
              <circle cx="58" cy="26" r="7" fill="${h}"/>
              <circle cx="30" cy="16" r="6" fill="${h}"/>
              <circle cx="50" cy="16" r="6" fill="${h}"/>
              <circle cx="40" cy="14" r="6" fill="${h}"/>
              <rect x="20" y="26" width="40" height="10" fill="${h}"/>`;
  } else if (hairStyle === 'raspado') {
    hairEl = `<ellipse cx="40" cy="24" rx="20" ry="10" fill="${h}" opacity="0.6"/>`;
  } else if (hairStyle === 'coque') {
    hairEl = `<ellipse cx="40" cy="23" rx="20" ry="12" fill="${h}"/>
              <rect x="20" y="23" width="40" height="10" fill="${h}"/>
              <ellipse cx="40" cy="16" rx="8" ry="7" fill="${h}"/>
              <circle cx="40" cy="10" r="5" fill="${h}"/>`;
  } else if (hairStyle === 'careca') {
    hairEl = `<ellipse cx="40" cy="24" rx="20" ry="12" fill="${s.base}" opacity="0.7"/>`;
  } else if (hairStyle === 'tranca') {
    hairEl = `<ellipse cx="40" cy="21" rx="21" ry="13" fill="${h}"/>
              <rect x="20" y="21" width="40" height="12" fill="${h}"/>
              <rect x="35" y="32" width="4" height="32" rx="2" fill="${h}"/>
              <rect x="41" y="32" width="4" height="32" rx="2" fill="${h}"/>
              <rect x="29" y="30" width="3.5" height="26" rx="2" fill="${h}"/>
              <rect x="47" y="30" width="3.5" height="26" rx="2" fill="${h}"/>`;
  }

  const brows = opts.gender === 'f' ? browsF : browsM;
  const eyesAll = eyeWhiteL + eyeWhiteR + eyeIrisL + eyeIrisR + eyePupilL + eyePupilR + eyeShineL + eyeShineR;

  return `
    ${hairEl}
    ${ears}
    ${face}
    ${cheeks}
    ${nose}
    ${brows}
    ${eyesAll}
    ${glassesEl}
    ${mouth}
    ${beardEl}
    ${earringEl}
    ${neck}
    ${body}
  `;
}

function makeSVG(sk, hr, ey, opts = {}, bgColor = '#E8F0FE') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
    <circle cx="40" cy="40" r="40" fill="${bgColor}"/>
    ${_base(sk, hr, ey, opts)}
  </svg>`;
}

// ─── Catálogo de avatares pré-definidos ────────────────────────────────────────
// id único, label descritivo, parâmetros de geração
const AVATAR_CATALOG = [
  // ── MASCULINOS ──────────────────────────────────────────────────────────────
  { id:'m01', label:'Homem loiro',          gender:'m', sk:'claro',  hr:'loiro',    ey:'azul',     opts:{ hairStyle:'curto',   gender:'m' },            bg:'#DBEAFE' },
  { id:'m02', label:'Homem castanho',       gender:'m', sk:'claro',  hr:'castanho', ey:'castanho', opts:{ hairStyle:'curto',   gender:'m' },            bg:'#D1FAE5' },
  { id:'m03', label:'Homem moreno',         gender:'m', sk:'medio',  hr:'castanho', ey:'castanho', opts:{ hairStyle:'curto',   gender:'m' },            bg:'#FEF3C7' },
  { id:'m04', label:'Homem ruivo',          gender:'m', sk:'claro',  hr:'ruivo',    ey:'verde',    opts:{ hairStyle:'medio',   gender:'m' },            bg:'#FFE4E6' },
  { id:'m05', label:'Homem careca',         gender:'m', sk:'claro',  hr:'careca',   ey:'castanho', opts:{ hairStyle:'careca',  gender:'m' },            bg:'#E0E7FF' },
  { id:'m06', label:'Homem c/ óculos',      gender:'m', sk:'medio',  hr:'preto',    ey:'preto',    opts:{ hairStyle:'curto',   gender:'m', glasses:true }, bg:'#F3E8FF' },
  { id:'m07', label:'Homem grisalho',       gender:'m', sk:'claro',  hr:'grisalho', ey:'azul',     opts:{ hairStyle:'curto',   gender:'m' },            bg:'#F1F5F9' },
  { id:'m08', label:'Homem barba',          gender:'m', sk:'moreno', hr:'preto',    ey:'preto',    opts:{ hairStyle:'curto',   gender:'m', beard:true },  bg:'#FDF4E7' },
  { id:'m09', label:'Homem cabelo preto',   gender:'m', sk:'escuro', hr:'preto',    ey:'preto',    opts:{ hairStyle:'curto',   gender:'m' },            bg:'#C7F2E0' },
  { id:'m10', label:'Homem ruivo barba',    gender:'m', sk:'claro',  hr:'ruivo',    ey:'verde',    opts:{ hairStyle:'curto',   gender:'m', beard:true },  bg:'#FFF3CD' },
  { id:'m11', label:'Homem óculos grisalho',gender:'m', sk:'oliva',  hr:'grisalho', ey:'mel',      opts:{ hairStyle:'curto',   gender:'m', glasses:true }, bg:'#E2F0D9' },
  { id:'m12', label:'Homem raspado',        gender:'m', sk:'escuro', hr:'raspado',  ey:'preto',    opts:{ hairStyle:'raspado',  gender:'m' },            bg:'#FCE4EC' },
  { id:'m13', label:'Homem cabelo médio',   gender:'m', sk:'oliva',  hr:'castanho', ey:'mel',      opts:{ hairStyle:'medio',   gender:'m' },            bg:'#E8F5E9' },
  { id:'m14', label:'Homem loiro óculos',   gender:'m', sk:'claro',  hr:'loiro',    ey:'azul',     opts:{ hairStyle:'medio',   gender:'m', glasses:true }, bg:'#E3F2FD' },
  { id:'m15', label:'Homem pele escura',    gender:'m', sk:'escuro', hr:'preto',    ey:'castanho', opts:{ hairStyle:'cacheado', gender:'m' },            bg:'#FFF8E1' },
  { id:'m16', label:'Homem branco sênior',  gender:'m', sk:'claro',  hr:'branco',   ey:'azul',     opts:{ hairStyle:'curto',   gender:'m', glasses:true }, bg:'#E8EAF6' },

  // ── FEMININOS ───────────────────────────────────────────────────────────────
  { id:'f01', label:'Mulher loira',         gender:'f', sk:'claro',  hr:'loiro',    ey:'azul',     opts:{ hairStyle:'longo',   gender:'f', lipstick:true  }, bg:'#FCE4EC' },
  { id:'f02', label:'Mulher castanha',      gender:'f', sk:'claro',  hr:'castanho', ey:'castanho', opts:{ hairStyle:'longo',   gender:'f' },               bg:'#F3E5F5' },
  { id:'f03', label:'Mulher morena',        gender:'f', sk:'medio',  hr:'preto',    ey:'preto',    opts:{ hairStyle:'longo',   gender:'f' },               bg:'#FFF3E0' },
  { id:'f04', label:'Mulher ruiva',         gender:'f', sk:'claro',  hr:'ruivo',    ey:'verde',    opts:{ hairStyle:'longo',   gender:'f', lipstick:true  }, bg:'#E8F5E9' },
  { id:'f05', label:'Mulher cacheada',      gender:'f', sk:'escuro', hr:'preto',    ey:'preto',    opts:{ hairStyle:'cacheado', gender:'f' },              bg:'#E1F5FE' },
  { id:'f06', label:'Mulher c/ óculos',     gender:'f', sk:'claro',  hr:'castanho', ey:'mel',      opts:{ hairStyle:'medio',   gender:'f', glasses:true  }, bg:'#F9FBE7' },
  { id:'f07', label:'Mulher grisalha',      gender:'f', sk:'claro',  hr:'grisalho', ey:'azul',     opts:{ hairStyle:'medio',   gender:'f' },               bg:'#ECEFF1' },
  { id:'f08', label:'Mulher coque',         gender:'f', sk:'medio',  hr:'castanho', ey:'castanho', opts:{ hairStyle:'coque',   gender:'f', lipstick:true  }, bg:'#FFF9C4' },
  { id:'f09', label:'Mulher pele escura',   gender:'f', sk:'escuro', hr:'preto',    ey:'castanho', opts:{ hairStyle:'longo',   gender:'f' },               bg:'#E8F0FE' },
  { id:'f10', label:'Mulher trança',        gender:'f', sk:'moreno', hr:'preto',    ey:'preto',    opts:{ hairStyle:'tranca',  gender:'f' },               bg:'#FDE7F3' },
  { id:'f11', label:'Mulher loira óculos',  gender:'f', sk:'claro',  hr:'loiro',    ey:'azul',     opts:{ hairStyle:'coque',   gender:'f', glasses:true, lipstick:true }, bg:'#E0F7FA' },
  { id:'f12', label:'Mulher ruiva cacheada',gender:'f', sk:'claro',  hr:'ruivo',    ey:'verde',    opts:{ hairStyle:'cacheado', gender:'f', lipstick:true }, bg:'#FFF3E0' },
  { id:'f13', label:'Mulher oliva',         gender:'f', sk:'oliva',  hr:'castanho', ey:'mel',      opts:{ hairStyle:'longo',   gender:'f' },               bg:'#F1F8E9' },
  { id:'f14', label:'Mulher branca sênior', gender:'f', sk:'claro',  hr:'branco',   ey:'azul',     opts:{ hairStyle:'medio',   gender:'f', glasses:true  }, bg:'#EDE7F6' },
  { id:'f15', label:'Mulher brinco',        gender:'f', sk:'medio',  hr:'preto',    ey:'castanho', opts:{ hairStyle:'cacheado', gender:'f', earring:true, lipstick:true }, bg:'#E8EAF6' },
  { id:'f16', label:'Mulher morena trança', gender:'f', sk:'escuro', hr:'castanho', ey:'mel',      opts:{ hairStyle:'tranca',  gender:'f', earring:true  }, bg:'#FFFDE7' },
];

// ─── Gera o SVG de um avatar pelo id ──────────────────────────────────────────
function getAvatarSVG(id, size = 80) {
  const av = AVATAR_CATALOG.find(a => a.id === id);
  if (!av) return _makeInitialsSVG('?', '#4A90E2', size);
  const svgRaw = makeSVG(av.sk, av.hr, av.ey, av.opts, av.bg);
  if (size === 80) return svgRaw;
  return svgRaw.replace('width="80" height="80"', `width="${size}" height="${size}"`);
}

// SVG de fallback com iniciais
function _makeInitialsSVG(iniciais, cor, size = 80) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="${size}" height="${size}">
    <circle cx="40" cy="40" r="40" fill="${cor}"/>
    <text x="40" y="47" text-anchor="middle" font-family="Outfit,sans-serif" font-size="26" font-weight="700" fill="white">${iniciais}</text>
  </svg>`;
}

// ─── Chave de localStorage ─────────────────────────────────────────────────────
const AVATAR_KEY = 'lawtech_avatar';

function getAvatarAtual() {
  return localStorage.getItem(AVATAR_KEY) || null;
}

function salvarAvatar(id) {
  localStorage.setItem(AVATAR_KEY, id);
}

// ─── Retorna o elemento <img> ou <span> com o avatar do usuário ───────────────
function renderAvatarUsuario(size = 40) {
  const id = getAvatarAtual();
  const svg = id ? getAvatarSVG(id, size) : null;
  const blob = svg ? 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))) : null;
  return blob;
}

// ─── Renderiza avatar de outro usuário (salvo em cache) ───────────────────────
const _avatarCache = {};  // userId → avatarId (populado via API)

function setUserAvatarCache(userId, avatarId) {
  _avatarCache[userId] = avatarId;
}

function getAvatarDataUrl(id, size = 40) {
  if (!id) return null;
  const svg = getAvatarSVG(id, size);
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

// ─── MODAL DE SELEÇÃO ─────────────────────────────────────────────────────────
function abrirModalAvatar() {
  // Remove modal anterior se existir
  const existing = document.getElementById('avatarModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'avatarModal';
  modal.innerHTML = `
    <style>
      #avatarModal {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(15, 25, 50, 0.65);
        backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        animation: avModalIn 0.2s ease-out;
      }
      @keyframes avModalIn { from { opacity:0 } to { opacity:1 } }

      #avatarModalBox {
        background: #fff; border-radius: 20px; width: 660px; max-width: 95vw;
        max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 30px 80px rgba(0,0,0,0.25);
        animation: avBoxIn 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      @keyframes avBoxIn { from { transform: scale(0.94) translateY(10px); opacity:0 } to { transform:scale(1) translateY(0); opacity:1 } }

      #avatarModalHeader {
        background: linear-gradient(135deg, #1E3A5F, #2563eb);
        padding: 20px 28px; display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
      }
      #avatarModalHeader h2 {
        font-family: 'Outfit', sans-serif; font-size: 17px; font-weight: 700;
        color: white; margin: 0; display: flex; align-items: center; gap: 10px;
      }
      #avatarModalClose {
        width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.15);
        border: none; color: white; font-size: 18px; cursor: pointer; display: flex;
        align-items: center; justify-content: center; transition: background 0.15s;
      }
      #avatarModalClose:hover { background: rgba(255,255,255,0.3); }

      #avatarModalPreview {
        background: linear-gradient(135deg, #e8f0fe, #dce8f8);
        padding: 20px; display: flex; align-items: center; justify-content: center;
        gap: 20px; flex-shrink: 0; border-bottom: 1px solid #e2e8f0;
      }
      #avatarPreviewImg {
        width: 80px; height: 80px; border-radius: 50%;
        border: 3px solid #2563eb;
        box-shadow: 0 0 0 4px rgba(37,99,235,0.15), 0 8px 20px rgba(0,0,0,0.12);
        overflow: hidden; background: #fff;
        display: flex; align-items: center; justify-content: center;
      }
      #avatarPreviewImg img { width: 100%; height: 100%; }
      #avatarPreviewLabel {
        font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 600;
        color: #1E3A5F;
      }
      #avatarPreviewSub {
        font-family: 'Outfit', sans-serif; font-size: 11px; color: #64748b;
        margin-top: 3px;
      }

      #avatarModalFilters {
        padding: 14px 20px 8px; display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0;
        border-bottom: 1px solid #f0f4f8;
      }
      .av-filter-btn {
        padding: 5px 14px; border-radius: 20px; border: 1.5px solid #d1d9e8;
        background: white; font-family: 'Outfit', sans-serif; font-size: 12px;
        font-weight: 600; color: #4a5568; cursor: pointer; transition: all 0.15s;
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .av-filter-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
      .av-filter-btn.active { background: #2563eb; border-color: #2563eb; color: white; }

      #avatarModalGrid {
        flex: 1; overflow-y: auto; padding: 16px 20px;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 12px;
      }
      #avatarModalGrid::-webkit-scrollbar { width: 5px; }
      #avatarModalGrid::-webkit-scrollbar-thumb { background: #d1d9e8; border-radius: 3px; }

      .av-item {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        cursor: pointer; padding: 10px 6px; border-radius: 14px;
        border: 2px solid transparent; transition: all 0.18s;
        background: #f8fafc;
      }
      .av-item:hover { background: #eff6ff; border-color: #bfdbfe; transform: translateY(-2px); }
      .av-item.selected { border-color: #2563eb; background: #eff6ff;
        box-shadow: 0 0 0 3px rgba(37,99,235,0.2); }
      .av-item img { width: 64px; height: 64px; border-radius: 50%; display: block; }
      .av-item span {
        font-family: 'Outfit', sans-serif; font-size: 10px; font-weight: 600;
        color: #64748b; text-align: center; line-height: 1.2;
        text-transform: none; max-width: 80px;
      }
      .av-item.selected span { color: #2563eb; }
      .av-check {
        display: none; width: 18px; height: 18px; background: #2563eb;
        border-radius: 50%; align-items: center; justify-content: center;
        position: absolute; top: 4px; right: 4px; font-size: 11px; color: white;
      }
      .av-item.selected .av-check { display: flex; }
      .av-item { position: relative; }

      #avatarModalFooter {
        padding: 16px 24px; border-top: 1px solid #e2e8f0;
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0; background: #f8fafc;
      }
      #avatarModalFooter small { font-family: 'Outfit', sans-serif; font-size: 11px; color: #94a3b8; }
      #btnConfirmarAvatar {
        background: linear-gradient(135deg, #1E3A5F, #2563eb);
        color: white; border: none; border-radius: 10px;
        padding: 10px 28px; font-family: 'Outfit', sans-serif;
        font-size: 13px; font-weight: 700; cursor: pointer;
        transition: all 0.2s; letter-spacing: 0.03em;
      }
      #btnConfirmarAvatar:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(37,99,235,0.35); }
      #btnConfirmarAvatar:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    </style>

    <div id="avatarModalBox">
      <!-- Header -->
      <div id="avatarModalHeader">
        <h2>👤 Escolher Avatar</h2>
        <button id="avatarModalClose" onclick="fecharModalAvatar()">✕</button>
      </div>

      <!-- Preview do selecionado -->
      <div id="avatarModalPreview">
        <div id="avatarPreviewImg"><img id="avatarPreviewImgEl" src="" alt="preview"/></div>
        <div>
          <div id="avatarPreviewLabel">Nenhum selecionado</div>
          <div id="avatarPreviewSub">Clique em um avatar para pré-visualizar</div>
        </div>
      </div>

      <!-- Filtros -->
      <div id="avatarModalFilters">
        <button class="av-filter-btn active" data-filter="todos" onclick="filtrarAvatares('todos', this)">Todos</button>
        <button class="av-filter-btn" data-filter="m" onclick="filtrarAvatares('m', this)">👨 Masculinos</button>
        <button class="av-filter-btn" data-filter="f" onclick="filtrarAvatares('f', this)">👩 Femininos</button>
        <button class="av-filter-btn" data-filter="oculos" onclick="filtrarAvatares('oculos', this)">🕶️ Óculos</button>
        <button class="av-filter-btn" data-filter="cacheado" onclick="filtrarAvatares('cacheado', this)">🌀 Cacheado</button>
        <button class="av-filter-btn" data-filter="loiro" onclick="filtrarAvatares('loiro', this)">🌾 Loiro(a)</button>
        <button class="av-filter-btn" data-filter="ruivo" onclick="filtrarAvatares('ruivo', this)">🦊 Ruivo(a)</button>
      </div>

      <!-- Grade de avatares -->
      <div id="avatarModalGrid"></div>

      <!-- Footer -->
      <div id="avatarModalFooter">
        <small>Seu avatar aparecerá no chat e no perfil</small>
        <button id="btnConfirmarAvatar" onclick="confirmarAvatar()" disabled>✔ Confirmar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Fechar clicando fora
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharModalAvatar(); });

  // Renderiza todos inicialmente
  _renderGridAvatares(AVATAR_CATALOG);

  // Marca o atual se houver
  const atual = getAvatarAtual();
  if (atual) _selecionarAvatarModal(atual);
}

let _avatarSelecionado = null;
let _filtroAtivo = 'todos';

function filtrarAvatares(filtro, btn) {
  _filtroAtivo = filtro;
  // Atualiza botões
  document.querySelectorAll('.av-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  let lista = AVATAR_CATALOG;
  if (filtro === 'm') lista = AVATAR_CATALOG.filter(a => a.gender === 'm');
  else if (filtro === 'f') lista = AVATAR_CATALOG.filter(a => a.gender === 'f');
  else if (filtro === 'oculos') lista = AVATAR_CATALOG.filter(a => a.opts.glasses);
  else if (filtro === 'cacheado') lista = AVATAR_CATALOG.filter(a => a.opts.hairStyle === 'cacheado');
  else if (filtro === 'loiro') lista = AVATAR_CATALOG.filter(a => a.hr === 'loiro');
  else if (filtro === 'ruivo') lista = AVATAR_CATALOG.filter(a => a.hr === 'ruivo');

  _renderGridAvatares(lista);

  // Re-marca o selecionado se estiver na lista filtrada
  if (_avatarSelecionado) {
    const el = document.querySelector(`.av-item[data-id="${_avatarSelecionado}"]`);
    if (el) el.classList.add('selected');
  }
}

function _renderGridAvatares(lista) {
  const grid = document.getElementById('avatarModalGrid');
  if (!grid) return;
  grid.innerHTML = lista.map(av => {
    const dataUrl = getAvatarDataUrl(av.id, 64);
    const isSelected = av.id === _avatarSelecionado ? 'selected' : '';
    return `
      <div class="av-item ${isSelected}" data-id="${av.id}" onclick="_selecionarAvatarModal('${av.id}')">
        <span class="av-check">✔</span>
        <img src="${dataUrl}" alt="${av.label}" loading="lazy"/>
        <span>${av.label}</span>
      </div>`;
  }).join('');
}

function _selecionarAvatarModal(id) {
  _avatarSelecionado = id;

  // Atualiza visuais da grade
  document.querySelectorAll('.av-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  // Atualiza preview
  const av = AVATAR_CATALOG.find(a => a.id === id);
  if (av) {
    const previewImg = document.getElementById('avatarPreviewImgEl');
    const previewLabel = document.getElementById('avatarPreviewLabel');
    const previewSub = document.getElementById('avatarPreviewSub');
    if (previewImg) previewImg.src = getAvatarDataUrl(id, 80);
    if (previewLabel) previewLabel.textContent = av.label;
    if (previewSub) previewSub.textContent = av.gender === 'm' ? '👨 Masculino' : '👩 Feminino';
  }

  // Habilita botão confirmar
  const btn = document.getElementById('btnConfirmarAvatar');
  if (btn) btn.disabled = false;
}

function confirmarAvatar() {
  if (!_avatarSelecionado) return;
  salvarAvatar(_avatarSelecionado);

  // Atualiza avatar em toda a UI do chat imediatamente
  atualizarAvatarUI(_avatarSelecionado);

  // Persiste no servidor (endpoint opcional — se não existir, ignora silenciosamente)
  if (typeof API !== 'undefined') {
    API.put('/api/auth/avatar', { avatar_id: _avatarSelecionado }).catch(() => {});
  }

  fecharModalAvatar();

  // Toast de confirmação (usa a função do chat.js se disponível)
  if (typeof showToast === 'function') showToast('✅ Avatar atualizado com sucesso!', 'success');
}

function fecharModalAvatar() {
  const modal = document.getElementById('avatarModal');
  if (modal) {
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.15s';
    setTimeout(() => modal.remove(), 150);
  }
  _avatarSelecionado = null;
}

// ─── Atualiza todos os pontos da UI que exibem o avatar do usuário logado ─────
function atualizarAvatarUI(avatarId) {
  const dataUrl = getAvatarDataUrl(avatarId, 40);
  if (!dataUrl) return;

  // Troca o círculo de iniciais no header pelo avatar
  const circulo = document.getElementById('userCircle');
  if (circulo) {
    circulo.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="avatar"/>`;
    circulo.style.padding = '0';
    circulo.style.overflow = 'hidden';
  }
}

// ─── Inicialização automática ao carregar ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const id = getAvatarAtual();
  if (id) atualizarAvatarUI(id);
});