import { useState, useEffect, useCallback } from "react";

// ─── Backend Config ───────────────────────────────────────────────
const BACKEND = "https://script.google.com/macros/s/AKfycbw7IhJ6sg_Qm27O-6mU8CAvmNLA95ICP5Mm4EFQjsiGnemLnkkPx7dR6lgO55dSZDZfbw/exec";

const api = async (body) => {
  const res = await fetch(BACKEND, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
};

const apiGet = async (params) => {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${BACKEND}?${qs}`);
  return res.json();
};

// ─── Helpers de datos ─────────────────────────────────────────────
const saveAppData       = (key, data)    => api({ action:"saveData", key, data });
const loadAppData       = (key)          => apiGet({ action:"loadData", key }).then(r=>r.data);
const saveColorsToSheet = (colors)       => api({ action:"saveColors", data:colors });
const loadColorsFromSheet = ()           => apiGet({ action:"loadColors" }).then(r=>r.data);
const saveFormatsToSheet  = (formats)    => api({ action:"saveFormats", data:formats });
const loadFormatsFromSheet = ()          => apiGet({ action:"loadFormats" }).then(r=>r.data);

// ─── Conversión control → fila Sheets ────────────────────────────
const resolveAnchoForSheet = (tile, fmt) => {
  if (!tile.anchoOpt || tile.anchoOpt==="") return "";
  if (tile.anchoOpt==="otro") return tile.anchoCustom||"";
  const base = fmt?.ancho||0;
  const is375 = fmt?.id==="375x750", is300 = fmt?.id==="300x600";
  if (tile.anchoOpt==="nominal") return base;
  if (tile.anchoOpt==="minus1")  return (is375||is300)?base-2:base-1;
  return (is375||is300)?base-3:base-2;
};
const resolveLargoForSheet = (tile, fmt) => {
  if (!tile.largoOpt || tile.largoOpt==="") return "";
  if (tile.largoOpt==="otro") return tile.largoCustom||"";
  const base = fmt?.largo||0;
  if (tile.largoOpt==="nominal") return base;
  if (tile.largoOpt==="minus1")  return base-1;
  return base-2;
};

const ctrlToRow = (ctrl, formats, colors, driveFolderUrl) => {
  const fmt   = formats.find(f=>f.id===ctrl.formatId);
  const color = colors.find(c=>c.id===ctrl.colorId);
  const row = [
    ctrl.id,
    ctrl.date ? new Date(ctrl.date).toLocaleDateString("es-ES") : "",
    ctrl.proveedor||"",
    ctrl.referencia||"",
    ctrl.lote||"",
    color ? `${color.color}` : "",
    color ? `${color.serie}` : "",
    ctrl.colorUso||"",
    fmt ? `${fmt.label} mm` : "",
    ctrl.grosor||10,
    ctrl.tiles?.length||0,
  ];
  for (let i=0; i<5; i++) {
    const t = ctrl.tiles?.[i];
    if (t) {
      const planRaw = t.planimetria==="otro"?t.planimetriaCustom:t.planimetria;
      row.push(t.tone||"", resolveAnchoForSheet(t,fmt), resolveLargoForSheet(t,fmt), planRaw||"", t.planimetriaDir||"", t.rd||"", t.nota||"");
    } else {
      row.push("","","","","","","");
    }
  }
  row.push(ctrl.labEspesor||"", ctrl.labManchas?"Sí":"No", driveFolderUrl||"", ctrl.verdict||"", ctrl.labDone?"Sí":"No", ctrl.noMuestras?"Sí":"No");
  return row;
};

// ─── Sync control con backend ─────────────────────────────────────
const toBase64 = async (dataUrl) => {
  const parts = dataUrl.split(",");
  return { base64: parts[1], mimeType: parts[0].match(/:(.*?);/)[1] };
};

const syncCtrl = async (ctrl, formats, colors) => {
  let driveFolderUrl = ctrl.driveFolderUrl || "";

  // Crear carpeta y subir fotos si es nuevo
  if (!ctrl.driveFolderUrl) {
    const folderName = `${ctrl.lote||ctrl.id} - ${ctrl.date?new Date(ctrl.date).toLocaleDateString("es-ES"):""}`;
    const folder = await api({ action:"createFolder", name:folderName });
    driveFolderUrl = folder.url;
    for (const tile of (ctrl.tiles||[])) {
      for (const foto of (tile.fotos||[])) {
        if (!foto.uploaded && foto.src?.startsWith("data:")) {
          const { base64, mimeType } = await toBase64(foto.src);
          await api({ action:"uploadPhoto", name:foto.name||`foto_${Date.now()}.jpg`, base64, mimeType });
        }
      }
    }
  }

  // Guardar fila legible en Sheets
  const row = ctrlToRow(ctrl, formats, colors, driveFolderUrl);
  await api({ action:"saveCtrlRow", data:row });

  return driveFolderUrl;
};

const DEFAULT_FORMATS = [
  { id: "1200x1200", label: "1200 × 1200", largo: 1200, ancho: 1200 },
  { id: "600x1200",  label: "600 × 1200",  largo: 1200, ancho: 600  },
  { id: "900x900",   label: "900 × 900",   largo: 900,  ancho: 900  },
  { id: "750x750",   label: "750 × 750",   largo: 750,  ancho: 750  },
  { id: "600x600",   label: "600 × 600",   largo: 600,  ancho: 600  },
  { id: "375x750",   label: "375 × 750",   largo: 750,  ancho: 375  },
  { id: "300x600",   label: "300 × 600",   largo: 600,  ancho: 300  },
  { id: "147x147",   label: "147 × 147",   largo: 147,  ancho: 147  },
];

const DEFAULT_COLORS = [
  // Crosscut (CS)
  { id:"cs-puro",       serie:"Crosscut",  abbr:"CS", color:"Puro"       },
  { id:"cs-petra",      serie:"Crosscut",  abbr:"CS", color:"Petra"      },
  { id:"cs-cloud",      serie:"Crosscut",  abbr:"CS", color:"Cloud"      },
  // Veincut (VN)
  { id:"vn-aurora",     serie:"Veincut",   abbr:"VN", color:"Aurora"     },
  { id:"vn-sahara",     serie:"Veincut",   abbr:"VN", color:"Sahara"     },
  { id:"vn-basalt",     serie:"Veincut",   abbr:"VN", color:"Basalt"     },
  // Savoy (SV)
  { id:"sv-moon",       serie:"Savoy",     abbr:"SV", color:"Moon"       },
  { id:"sv-desert",     serie:"Savoy",     abbr:"SV", color:"Desert"     },
  { id:"sv-land",       serie:"Savoy",     abbr:"SV", color:"Land"       },
  // Stromboli (ST)
  { id:"st-light",      serie:"Stromboli", abbr:"ST", color:"Light"      },
  { id:"st-cream",      serie:"Stromboli", abbr:"ST", color:"Cream"      },
  { id:"st-silver",     serie:"Stromboli", abbr:"ST", color:"Silver"     },
  // Cupira (CP)
  { id:"cp-hueso",      serie:"Cupira",    abbr:"CP", color:"Hueso"      },
  { id:"cp-multi",      serie:"Cupira",    abbr:"CP", color:"Multi"      },
  { id:"cp-marengo",    serie:"Cupira",    abbr:"CP", color:"Marengo"    },
  // Salem (SL)
  { id:"sl-clar",       serie:"Salem",     abbr:"SL", color:"Clar"       },
  { id:"sl-dune",       serie:"Salem",     abbr:"SL", color:"Dune"       },
  // Coralina (CO)
  { id:"co-aguada",     serie:"Coralina",  abbr:"CO", color:"Aguada"     },
  { id:"co-samana",     serie:"Coralina",  abbr:"CO", color:"Samaná"     },
  // Eterna (ET)
  { id:"et-alba",       serie:"Eterna",    abbr:"ET", color:"Alba"       },
  { id:"et-argent",     serie:"Eterna",    abbr:"ET", color:"Argent"     },
  { id:"et-cendra",     serie:"Eterna",    abbr:"ET", color:"Cendra"     },
  // Iconic (IC)
  { id:"ic-stone",      serie:"Iconic",    abbr:"IC", color:"Stone"      },
  { id:"ic-fresh",      serie:"Iconic",    abbr:"IC", color:"Fresh"      },
  // Cements (CM)
  { id:"cm-snow",       serie:"Cements",   abbr:"CM", color:"Snow"       },
  // Cotto (CT)
  { id:"ct-boho",       serie:"Cotto",     abbr:"CT", color:"Boho"       },
  // Amazonia (AM)
  { id:"am-miel",       serie:"Amazonia",  abbr:"AM", color:"Miel"       },
  { id:"am-canela",     serie:"Amazonia",  abbr:"AM", color:"Canela"     },
  // Mizu (MI)
  { id:"mi-kai",        serie:"Mizu",      abbr:"MI", color:"Kai"        },
  { id:"mi-midori",     serie:"Mizu",      abbr:"MI", color:"Midori"     },
  { id:"mi-shiro",      serie:"Mizu",      abbr:"MI", color:"Shiro"      },
  // Tropic (TP)
  { id:"tp-turqueta",   serie:"Tropic",    abbr:"TP", color:"Turqueta"   },
  { id:"tp-aguamarina", serie:"Tropic",    abbr:"TP", color:"Aguamarina" },
  // Bali (BA)
  { id:"ba-zatu",       serie:"Bali",      abbr:"BA", color:"Zatu"       },
  { id:"ba-goa",        serie:"Bali",      abbr:"BA", color:"Goa"        },
  // Volcanic (VO)
  { id:"vo-lava",       serie:"Volcanic",  abbr:"VO", color:"Lava"       },
];

const TONE_OPTIONS = [
  { value: "T50", label: "T50", desc: "Muy claro", color: "#f5f0e8", bad: true },
  { value: "T54", label: "T54", desc: "Claro",     color: "#e8dcc8", warn: true },
  { value: "T55", label: "T55 ✓", desc: "Patrón",  color: "#d4c4a0", ok: true },
  { value: "T56", label: "T56", desc: "Oscuro",    color: "#b8a478", warn: true },
  { value: "T60", label: "T60", desc: "Muy oscuro",color: "#7a6440", bad: true },
];

const PLANIMETRIA_OPTS = ["0.0","0.5","0.5–1","1.0","1.3","1.5","2.0","otro"];

const GROSOR_20 = [
  { formatId:"600x1200", colorIds:["st-light","cs-puro","cs-petra","cs-cloud"] },
  { formatId:"900x900",  colorIds:["sv-moon","sv-desert","sv-land","sl-clar"]  },
];

const canHave20mm = (formatId, colorId) =>
  GROSOR_20.some(r => r.formatId === formatId && r.colorIds.includes(colorId));

const getGrosor = (ctrl) => ctrl.grosor || 10;

const getToneStatus = (tone) => {
  if (!tone) return null;
  if (tone === "T55") return "ok";
  if (tone === "T50" || tone === "T60") return "reject";
  return "warn";
};

const getPlanimetriaStatus = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  if (v <= 0.5)  return "ok";
  if (v <= 1.0)  return "warn";
  return "reject";
};

// Returns the planimetría numeric value from a tile
const planimetriaVal = (tile) => {
  const raw = tile.planimetria === "otro" ? tile.planimetriaCustom : tile.planimetria;
  if (!raw || raw === "0.0") return 0;
  if (raw === "0.5–1") return 0.75;
  return parseFloat(raw) || 0;
};

// Returns array of {label, color, bg} badges for chip summary
const getChipBadges = (ctrl) => {
  if (!ctrl.tiles || !ctrl.tiles.length) return [];
  const badges = [];

  // Tono
  const tones = ctrl.tiles.map(t => t.tone).filter(Boolean);
  const hasT50T60 = tones.some(t => t === "T50" || t === "T60");
  const hasBadTone = tones.some(t => t !== "T55" && t !== "");
  if (hasT50T60) {
    badges.push({ label:"MAL TONO", color:"#f87171", bg:"rgba(248,113,113,0.15)" });
  } else if (hasBadTone) {
    badges.push({ label:"MAL TONO", color:"#fbbf24", bg:"rgba(251,191,36,0.15)" });
  } else if (tones.length && tones.every(t => t === "T55")) {
    badges.push({ label:"TONO OK", color:"#4ade80", bg:"rgba(74,222,128,0.15)" });
  }

  // Planimetría
  const vals = ctrl.tiles.map(t => planimetriaVal(t));
  const maxPlan = vals.length ? Math.max(...vals) : 0;
  if (maxPlan > 1.0) {
    badges.push({ label:"DOBLADO", color:"#f87171", bg:"rgba(248,113,113,0.15)" });
  } else if (maxPlan > 0.5) {
    badges.push({ label:"DOBLADO", color:"#f97316", bg:"rgba(249,115,22,0.15)" });
  } else if (maxPlan > 0) {
    badges.push({ label:"DOBLADO", color:"#fbbf24", bg:"rgba(251,191,36,0.15)" });
  }

  // RD — solo si el laboratorio está completado
  if (ctrl.labDone) {
    const rdVals = ctrl.tiles.map(t => t.rd).filter(v => v !== "" && v !== undefined && v !== null);
    if (rdVals.length) {
      const allOk  = rdVals.every(v => getRdStatus(v, ctrl.colorUso) === "ok");
      const anyBad = rdVals.some(v  => getRdStatus(v, ctrl.colorUso) === "reject");
      // Peor caso para mostrar
      const worst  = ctrl.colorUso === "IN"
        ? Math.max(...rdVals.map(Number))   // IN: el más alto es el peor
        : Math.min(...rdVals.map(Number));  // OUT: el más bajo es el peor
      const label  = `RD ${worst}`;
      if (allOk) {
        badges.push({ label, color:"#4ade80", bg:"rgba(74,222,128,0.15)" });
      } else if (anyBad) {
        badges.push({ label, color:"#f87171", bg:"rgba(248,113,113,0.15)" });
      }
    }
  }

  return badges;
};

// Returns display strings for tono, medidas, planimetría for chip inline info
const getChipInfo = (ctrl, formats) => {
  if (!ctrl.tiles || !ctrl.tiles.length) return null;
  const first = ctrl.tiles[0];
  const fmt   = formats ? formats.find(f => f.id === ctrl.formatId) : null;

  // Tono — primera baldosa
  const tono = first.tone || null;

  // Medidas — primera baldosa, resuelta con formato
  const resolveAncho = (tile) => {
    if (!tile.anchoOpt || tile.anchoOpt === "") return null;
    if (tile.anchoOpt === "otro") return tile.anchoCustom ? `${tile.anchoCustom}` : null;
    const base = fmt?.ancho || 0;
    const is375 = ctrl.formatId === "375x750";
    const is300 = ctrl.formatId === "300x600";
    if (tile.anchoOpt === "nominal") return `${base}`;
    if (tile.anchoOpt === "minus1")  return `${(is375||is300) ? base-2 : base-1}`;
    return `${(is375||is300) ? base-3 : base-2}`;
  };
  const resolveLargo = (tile) => {
    if (!tile.largoOpt || tile.largoOpt === "") return null;
    if (tile.largoOpt === "otro") return tile.largoCustom ? `${tile.largoCustom}` : null;
    const base = fmt?.largo || 0;
    if (tile.largoOpt === "nominal") return `${base}`;
    if (tile.largoOpt === "minus1")  return `${base-1}`;
    return `${base-2}`;
  };
  const ancho = resolveAncho(first);
  const largo = resolveLargo(first);
  const medidas = (ancho && largo) ? `${ancho}×${largo}` : (ancho || largo || null);

  // Planimetría — peor caso, valor raw del tile con mayor valor
  const worstTile = ctrl.tiles.reduce((a,b) => planimetriaVal(a) >= planimetriaVal(b) ? a : b);
  const rawPlan = worstTile.planimetria === "otro"
    ? (worstTile.planimetriaCustom || null)
    : (worstTile.planimetria || null);
  const planStr = rawPlan && rawPlan !== "" ? rawPlan : null;

  return { tono, medidas, planStr };
};

// RD status: IN = max 30, OUT = min 45
const getRdStatus = (rd, colorUso) => {
  if (rd === "" || rd === null || rd === undefined) return null;
  const v = parseFloat(rd);
  if (isNaN(v)) return null;
  if (colorUso === "IN") return v <= 30 ? "ok" : "reject";
  return v >= 45 ? "ok" : "reject";
};

// Detailed RD info with label, color and bar %
// IN ranges:  <18 muy bajo | 18-25 bajo OK | 25-35 OK | 35-44 no ok | >44 rechazado
// OUT ranges: <45 no ok | 45-50 ok justo | 50-60 OK | >60 ok alto
const getRdInfo = (rd, uso) => {
  const v = parseFloat(rd);
  if (isNaN(v) || rd==="" ) return null;
  if (uso === "IN") {
    // Bar: 0=0, 100=50 (scale 0-50)
    const bar = Math.min(Math.max(v/50*100, 2), 100);
    if (v < 18)       return { label:"Muy bajo",  color:"#60a5fa", bg:"#0a1a2a", bar, ok:false };
    if (v <= 25)      return { label:"Bajo · OK",  color:"#34d399", bg:"#0a1a12", bar, ok:true  };
    if (v <= 35)      return { label:"OK",          color:"#4ade80", bg:"#0a1a0a", bar, ok:true  };
    if (v <= 44)      return { label:"Alto · No OK",color:"#f97316", bg:"#1a0d00", bar, ok:false };
    return             { label:"Rechazado",  color:"#f87171", bg:"#1a0808", bar, ok:false };
  } else {
    // Bar: 0=0, 100=80 (scale 0-80)
    const bar = Math.min(Math.max(v/80*100, 2), 100);
    if (v < 45)       return { label:"No OK",       color:"#f87171", bg:"#1a0808", bar, ok:false };
    if (v <= 50)      return { label:"OK · Justo",  color:"#fbbf24", bg:"#1a1200", bar, ok:true  };
    if (v <= 60)      return { label:"OK",           color:"#4ade80", bg:"#0a1a0a", bar, ok:true  };
    return             { label:"OK · Alto",   color:"#60a5fa", bg:"#0a1020", bar, ok:true  };
  }
};

const verdictFromStatuses = (statuses) => {
  const valid = statuses.filter(Boolean);
  if (!valid.length) return null;
  if (valid.some(s => s === "reject")) return "RECHAZADO";
  if (valid.some(s => s === "warn"))   return "DOBLADO";
  if (valid.every(s => s === "ok"))    return "APROBADO";
  return null;
};

// Smart verdict: uses MAL TONO when tone is the only/main issue
const getSmartVerdict = (ctrl, getTileStatusesFn) => {
  const allToneStatuses = ctrl.tiles.map(t => getToneStatus(t.tone));
  const allPlanStatuses = ctrl.tiles.map(t => getPlanimetriaStatus(
    t.planimetria === "otro" ? t.planimetriaCustom : t.planimetria
  ));
  const hasBadTone = allToneStatuses.some(s => s === "warn" || s === "reject");
  const hasRejectTone = allToneStatuses.some(s => s === "reject");
  const hasBadPlan = allPlanStatuses.some(s => s === "warn" || s === "reject");
  if (hasRejectTone) return "RECHAZADO";
  if (hasBadTone && !hasBadPlan) return "MAL TONO";
  if (hasBadTone && hasBadPlan)  return "MAL TONO";
  if (hasBadPlan)                return "DOBLADO";
  const allSt = ctrl.tiles.flatMap(t => Object.values(getTileStatusesFn(t)));
  return verdictFromStatuses(allSt);
};

const verdictColor = (v) => {
  if (v === "APROBADO")  return "#4ade80";
  if (v === "RECHAZADO") return "#f87171";
  if (v === "DOBLADO")   return "#f97316";
  if (v === "MAL TONO")  return "#fbbf24";
  return "#9ca3af";
};
const verdictBg = (v) => {
  if (v === "APROBADO")  return "rgba(74,222,128,0.10)";
  if (v === "RECHAZADO") return "rgba(248,113,113,0.10)";
  if (v === "DOBLADO")   return "rgba(249,115,22,0.10)";
  if (v === "MAL TONO")  return "rgba(251,191,36,0.10)";
  return "rgba(156,163,175,0.08)";
};

const StatusDot = ({ status }) => (
  <span style={{
    display:"inline-block", width:8, height:8, borderRadius:"50%", marginRight:5, flexShrink:0,
    background: status === "ok" ? "#4ade80" : status === "warn" ? "#fbbf24" : status === "reject" ? "#f87171" : "transparent",
    border: status ? "none" : "1px solid #3a3a3a",
  }} />
);

const emptyTile = () => ({ id: Date.now() + Math.random(), tone:"", largoOpt:"", largoCustom:"", anchoOpt:"", anchoCustom:"", planimetria:"", planimetriaCustom:"", planimetriaDir:"", nota:"", fotos:[] });
const formatDate = (d) => { const dt = d instanceof Date ? d : new Date(d); return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`; };

const MESES_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const buildFotoName = (ctrl, colors, formats, tileIndex, fotoIndex, totalTiles, totalFotosThisTile, ext="jpg") => {
  const color  = colors.find(c=>c.id===ctrl.colorId);
  const fmt    = formats.find(f=>f.id===ctrl.formatId);
  const abbr   = color?.abbr  || "XX";
  const modelo = color?.color || "Color";
  const uso    = ctrl.colorUso || "OUT";
  const medida = fmt ? `${fmt.ancho/10}x${fmt.largo/10}` : "0x0";
  const lote   = ctrl.lote || "LOTE";
  const date   = ctrl.date ? new Date(ctrl.date) : new Date();
  const mes    = MESES_ES[date.getMonth()];
  const anyo   = String(date.getFullYear()).slice(-2);
  const base   = `${abbr}_${modelo}_${uso}_${medida}_${lote}_${mes}${anyo}`;
  const multiBaldosa = totalTiles > 1;
  const multiFoto    = totalFotosThisTile > 1;
  if (multiBaldosa && multiFoto) return `${base}_B${tileIndex+1}_${fotoIndex+1}.${ext}`;
  if (multiBaldosa)              return `${base}_B${tileIndex+1}.${ext}`;
  if (multiFoto)                 return `${base}_${fotoIndex+1}.${ext}`;
  return `${base}.${ext}`;
};
const genId = () => Math.random().toString(36).slice(2,8).toUpperCase();

const C = {
  bg:"#0f0f0f", surface:"#161616", surfaceAlt:"#111",
  border:"#242424", gold:"#b8a478", text:"#e8e0d4",
  textMuted:"#6b7280", textDim:"#9ca3af",
  green:"#4ade80", yellow:"#fbbf24", red:"#f87171",
};
const font = "'DM Mono','Courier New',monospace";

const S = {
  app:  { minHeight:"100vh", background:C.bg, color:C.text, fontFamily:font, paddingBottom:80 },
  header: {
    background:C.bg, borderBottom:`1px solid ${C.border}`, padding:"14px 18px",
    display:"flex", alignItems:"center", justifyContent:"space-between",
    position:"sticky", top:0, zIndex:100,
  },
  headerTitle: { fontSize:13, letterSpacing:"0.15em", textTransform:"uppercase", color:C.gold, fontWeight:600 },
  backBtn: {
    background:"none", border:`1px solid ${C.border}`, color:C.textMuted,
    padding:"5px 11px", borderRadius:4, fontSize:11, cursor:"pointer", fontFamily:font,
  },
  page: { padding:"18px 16px" },
  card: { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:14, marginBottom:10 },
  label: { fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.textMuted, marginBottom:5, display:"block" },
  input: {
    width:"100%", background:C.bg, border:`1px solid ${C.border}`, borderRadius:4,
    color:C.text, padding:"9px 11px", fontSize:13, fontFamily:font, boxSizing:"border-box", outline:"none",
  },
  primaryBtn: {
    width:"100%", background:C.gold, color:C.bg, border:"none", borderRadius:6,
    padding:"13px", fontSize:12, fontWeight:700, letterSpacing:"0.12em",
    textTransform:"uppercase", cursor:"pointer", fontFamily:font,
  },
  secondaryBtn: {
    width:"100%", background:"transparent", color:C.gold, border:`1px solid ${C.gold}`,
    borderRadius:6, padding:"11px", fontSize:11, fontWeight:600,
    letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", fontFamily:font,
  },
  ghostBtn: {
    background:"none", border:`1px solid ${C.border}`, color:C.textMuted,
    borderRadius:4, padding:"5px 10px", fontSize:11, cursor:"pointer", fontFamily:font,
  },
  sectionTitle: {
    fontSize:10, letterSpacing:"0.15em", textTransform:"uppercase",
    color:C.textMuted, marginBottom:8, marginTop:2,
  },
  toneGrid:   { display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:5, marginBottom:12 },
  measureRow: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 },
  statGrid:   { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:22 },
};

// ─── SEED DATA ───────────────────────────────────────────────────
const SEED_HISTORY = [];
const SEED_PENDING = [];
const SEED_PENDING_LAB = [];

export default function App() {
  const [screen, setScreen]         = useState("home");
  const [history, setHistory]       = useState(SEED_HISTORY);
  const [formats, setFormats]       = useState(DEFAULT_FORMATS);
  const [colors, setColors]         = useState(DEFAULT_COLORS);
  const [activeControl, setAC]      = useState(null);
  const [editingId, setEditingId]   = useState(null);
  const [viewingId, setViewingId]   = useState(null);
  const [prevScreen, setPrevScreen] = useState("home");
  const [prevLabScreen, setPrevLabScreen] = useState("pending-lab");
  const [lightboxFoto, setLightboxFoto] = useState(null);
  const [pending, setPending]         = useState(SEED_PENDING);
  const [pendingLab, setPendingLab]   = useState(SEED_PENDING_LAB); // ids of controls awaiting lab
  const [labCtrl, setLabCtrl]         = useState(null); // control being lab-edited
  const [newFmt, setNewFmt]           = useState({ largo:"", ancho:"" });
  const [fmtError, setFmtError]       = useState("");
  const [newColor, setNewColor]       = useState({ serie:"", abbr:"", color:"" });
  const [colorError, setColorError]   = useState("");
  const [filterProveedor, setFilterProveedor] = useState("");
  const [filterFormato,   setFilterFormato]   = useState("");
  const [filterColor,     setFilterColor]     = useState("");
  const [syncing,   setSyncing]   = useState(false);
  const [syncError, setSyncError] = useState("");
  const [seenIds,       setSeenIds]       = useState(new Set());
  const [verdictFilter, setVerdictFilter] = useState(null);
  const [statsPeriod,   setStatsPeriod]   = useState(3);
  const [statsFrom,     setStatsFrom]     = useState("");
  const [statsTo,       setStatsTo]       = useState("");
  const [statsCustom,   setStatsCustom]   = useState(false);
  const [reclamaciones, setReclamaciones] = useState([]);
  const [newRec,        setNewRec]        = useState(null);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [expandedRecId,  setExpandedRecId]  = useState(null);
  const [expandedHomeId, setExpandedHomeId] = useState(null);
  const [expandedProv,  setExpandedProv]  = useState(null);
  const [expandedSerie, setExpandedSerie] = useState(null);
  const [exportIds,     setExportIds]     = useState(new Set());
  const [exportScreen,  setExportScreen]  = useState(false);
  const [exportQ,       setExportQ]       = useState("");
  const [alertConfig,   setAlertConfig]   = useState({
    pctRechazoMax: 20,      // % rechazos proveedor este mes
    pctAprobadoMin: 60,     // % aprobado global mínimo
    recsMax: 3,             // max reclamaciones por mes
    incidenciasMax: 5,      // max incidencias un proveedor este mes
  });
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [trazQuery,       setTrazQuery]       = useState("");
  const [dirPeriod,       setDirPeriod]       = useState(30);
  const [dirCustomFrom,   setDirCustomFrom]   = useState("");
  const [dirCustomTo,     setDirCustomTo]     = useState("");
  const [dirCustom,       setDirCustom]       = useState(false);

  // ── Cargar todos los datos desde Sheets al arrancar ─────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [loadedColors, loadedFormats, loadedHistory, loadedPending, loadedPendingLab, loadedRecs, loadedSeen] = await Promise.all([
          loadColorsFromSheet(),
          loadFormatsFromSheet(),
          loadAppData("history"),
          loadAppData("pending"),
          loadAppData("pendingLab"),
          loadAppData("reclamaciones"),
          loadAppData("seenIds"),
        ]);
        if (loadedColors       && loadedColors.length  > 0) setColors(loadedColors);
        if (loadedFormats      && loadedFormats.length > 0) setFormats(loadedFormats);
        if (loadedHistory      && loadedHistory.length > 0) setHistory(loadedHistory);
        if (loadedPending      && loadedPending.length > 0) setPending(loadedPending);
        if (loadedPendingLab   && loadedPendingLab.length > 0) setPendingLab(loadedPendingLab);
        if (loadedRecs         && loadedRecs.length    > 0) setReclamaciones(loadedRecs);
        if (loadedSeen         && loadedSeen.length    > 0) setSeenIds(new Set(loadedSeen));
      } catch(e) {
        // Sin token todavía — se cargará tras el primer login
      }
    };
    load();
  }, []);

  const getTileStatuses = (tile) => ({
    tone:       getToneStatus(tile.tone),
    planimetria: getPlanimetriaStatus(tile.planimetria === "otro" ? tile.planimetriaCustom : tile.planimetria),
  });

  const getVerdict = (ctrl) =>
    getSmartVerdict(ctrl, getTileStatuses);

  const isIncomplete = (ctrl) => {
    if (!ctrl.lote || !ctrl.formatId || !ctrl.colorId || !ctrl.colorSerie) return true;
    if (!ctrl.tiles.some(t => t.fotos && t.fotos.length > 0)) return true;
    if (ctrl.tiles.some(t => !t.tone)) return true;
    if (ctrl.tiles.some(t => !t.planimetria)) return true;
    return false;
  };

  // Open blank lote form (step 1)
  const startNewLote = () => {
    setAC({ id:genId(), date:new Date(), proveedor:"", referencia:"", lote:"",
            formatId:formats[0].id, colorId:colors[0].id, colorUso:"OUT", colorSerie:colors[0].serie,
            grosor:10, tiles:[emptyTile()] });
    setScreen("new-lote");
  };

  // Save lote data → goes to pending list or back to history
  const saveLote = () => {
    const isInHistory = history.some(c => c.id === activeControl.id);
    if (isInHistory) {
      // Actualizar en historial y sincronizar
      const updatedCtrl = {...activeControl, verdict: getVerdict(activeControl)};
      const newHistory  = history.map(c => c.id === updatedCtrl.id ? updatedCtrl : c);
      setHistory(newHistory);
      setAC(null);
      setEditingId(null);
      setScreen("history");
      setSyncing(true); setSyncError("");
      syncCtrl(updatedCtrl, formats, colors)
        .then(driveFolderUrl => {
          const finalCtrl    = {...updatedCtrl, driveFolderUrl};
          const finalHistory = newHistory.map(c => c.id === finalCtrl.id ? finalCtrl : c);
          setHistory(finalHistory);
          return saveAppData("history", finalHistory);
        })
        .then(()=>setSyncing(false))
        .catch(e=>{setSyncing(false);setSyncError("Sync: "+e.message);});
    } else {
      // Actualizar en pendientes
      let updated;
      if (editingId) {
        updated = pending.map(c => c.id===editingId ? {...activeControl} : c);
      } else {
        updated = [activeControl, ...pending];
      }
      setPending(updated);
      setAC(null);
      setEditingId(null);
      setScreen("pending");
      saveAppData("pending", updated).catch(()=>{});
    }
  };

  // Open a pending control for inspection
  const openInspection = (ctrl) => {
    setAC({...ctrl});
    setEditingId(ctrl.id);
    setPrevScreen("pending");
    setScreen("control");
  };

  // Open a pending control to edit its lote data
  const editLote = (ctrl) => {
    setAC({...ctrl});
    setEditingId(ctrl.id);
    // Detectar si viene del historial o de pendientes
    const isInHistory = history.some(c => c.id === ctrl.id);
    setPrevScreen(isInHistory ? "history" : "pending");
    setScreen("new-lote");
  };

  // Edit an already-saved control from history
  const editControl = (ctrl) => {
    setEditingId(ctrl.id);
    setAC({...ctrl});
    setPrevScreen("history");
    setScreen("control");
  };

  const updateMeta = (f,v) => setAC(c => ({
    ...c,
    [f]:v,
    ...(f==="formatId"||f==="colorId" ? {grosor:10} : {}),
  }));
  const updateTile = (id,f,v) => setAC(c => ({...c, tiles:c.tiles.map(t => t.id===id?{...t,[f]:v}:t)}));
  const addTile    = () => setAC(c => ({...c, tiles:[...c.tiles, emptyTile()]}));
  const removeTile = (id) => setAC(c => ({...c, tiles:c.tiles.filter(t => t.id!==id)}));

  const handleAddColor = () => {
    const serie = newColor.serie.trim(), abbr = newColor.abbr.trim(), color = newColor.color.trim();
    if (!serie||!color) { setColorError("Serie y color son obligatorios."); return; }
    const id = `${serie.toLowerCase().replace(/\s+/g,"-")}-${color.toLowerCase().replace(/\s+/g,"-")}`;
    if (colors.find(c=>c.id===id)) { setColorError("Ese color ya existe."); return; }
    const newEntry = { id, serie, abbr: abbr||serie.slice(0,2).toUpperCase(), color };
    const updated = [...colors, newEntry];
    setColors(updated);
    setNewColor({ serie:"", abbr:"", color:"" });
    setColorError("");
    saveColorsToSheet(updated).catch(()=>{});
  };

  const saveControl = () => {
    const ctrl = {...activeControl, verdict: getVerdict(activeControl)};
    const newPending = pending.filter(c => c.id !== ctrl.id);
    let newHistory, newPendingLab;
    if (history.find(c => c.id === ctrl.id)) {
      newHistory    = history.map(c => c.id === ctrl.id ? ctrl : c);
      newPendingLab = pendingLab;
    } else {
      newHistory    = [ctrl, ...history];
      newPendingLab = [...pendingLab, ctrl.id];
    }
    setPending(newPending);
    setHistory(newHistory);
    setPendingLab(newPendingLab);
    setAC(null);
    setEditingId(null);
    setScreen(prevScreen || "history");
    setSyncing(true); setSyncError("");
    syncCtrl(ctrl, formats, colors)
      .then(driveFolderUrl => {
        // Actualizar history con el driveFolderUrl si es nuevo
        const finalCtrl = {...ctrl, driveFolderUrl};
        const finalHistory = newHistory.map(c => c.id === finalCtrl.id ? finalCtrl : c);
        setHistory(finalHistory);
        return Promise.all([
          saveAppData("history", finalHistory),
          saveAppData("pending", newPending),
          saveAppData("pendingLab", newPendingLab),
        ]);
      })
      .then(()=>setSyncing(false))
      .catch(e=>{setSyncing(false);setSyncError("Sync: "+e.message);});
  };

  const openLab = (ctrl, from="pending-lab") => {
    // Initialise lab data on tiles if not present
    const withLab = {
      ...ctrl,
      labEspesor: ctrl.labEspesor || "",
      tiles: ctrl.tiles.map(t => ({...t, rd: t.rd || ""})),
    };
    setLabCtrl(withLab);
    setPrevLabScreen(from);
    setScreen("lab");
  };

  const saveLab = () => {
    const ctrl = {...labCtrl, labDone: true};
    const newHistory    = history.map(c => c.id === ctrl.id ? ctrl : c);
    const newPendingLab = pendingLab.filter(id => id !== ctrl.id);
    setHistory(newHistory);
    setPendingLab(newPendingLab);
    setLabCtrl(null);
    setScreen(prevLabScreen || "pending-lab");
    setSyncing(true); setSyncError("");
    syncCtrl(ctrl, formats, colors)
      .then(driveFolderUrl => {
        const finalCtrl    = {...ctrl, driveFolderUrl};
        const finalHistory = newHistory.map(c => c.id === finalCtrl.id ? finalCtrl : c);
        setHistory(finalHistory);
        return Promise.all([
          saveAppData("history", finalHistory),
          saveAppData("pendingLab", newPendingLab),
        ]);
      })
      .then(()=>setSyncing(false))
      .catch(e=>{setSyncing(false);setSyncError("Sync: "+e.message);});
  };

  const updateLab  = (f,v) => setLabCtrl(c => ({...c, [f]:v}));
  const updateLabTile = (id,f,v) => setLabCtrl(c => ({...c, tiles:c.tiles.map(t => t.id===id?{...t,[f]:v}:t)}));

  const handleAddFormat = () => {
    const l = parseInt(newFmt.largo), a = parseInt(newFmt.ancho);
    if (!l||!a||l<10||a<10) { setFmtError("Introduce medidas válidas (mín. 10 mm)."); return; }
    const id = `${Math.min(l,a)}x${Math.max(l,a)}`;
    if (formats.find(f=>f.id===id)) { setFmtError("Ese formato ya existe."); return; }
    const largo = Math.max(l,a), ancho = Math.min(l,a);
    const label = largo===ancho ? `${largo} × ${ancho}` : `${largo} × ${ancho}`;
    const updated = [...formats, {id,label,largo,ancho}].sort((a,b)=>(b.largo*b.ancho)-(a.largo*a.ancho));
    setFormats(updated);
    setNewFmt({largo:"",ancho:""});
    setFmtError("");
    saveFormatsToSheet(updated).catch(()=>{});
  };

  const currentFmt   = activeControl ? (formats.find(f=>f.id===activeControl.formatId)||formats[0]) : null;
  const currentColor = activeControl ? colors.find(c=>c.id===activeControl.colorId) : null;
  const colorLabel   = (c, uso) => c ? `${c.abbr} ${c.color} ${uso}` : "—";
  const allSeries    = [...new Set(colors.map(c=>c.serie))];

  // ── HOME ─────────────────────────────────────────────────────────
  if (screen === "home") {
    const aprobados  = history.filter(c=>c.verdict==="APROBADO").length;
    const rechazados = history.filter(c=>c.verdict==="RECHAZADO").length;
    const malTono    = history.filter(c=>c.verdict==="MAL TONO").length;
    const revision   = history.filter(c=>c.verdict==="DOBLADO").length;
    const unseen = history.filter(c => !seenIds.has(c.id));
    const seen   = history.filter(c =>  seenIds.has(c.id));

    const filteredHistory = verdictFilter
      ? [...unseen.filter(c=>c.verdict===verdictFilter), ...seen.filter(c=>c.verdict===verdictFilter)]
      : [...unseen, ...seen];
    const ultimas = filteredHistory.slice(0, 8);

    const statsChips = [
      { v:"APROBADO",  n:aprobados,  color:C.green,   label:"Aprobado"  },
      { v:"MAL TONO",  n:malTono,    color:C.yellow,  label:"Mal tono"  },
      { v:"DOBLADO",   n:revision,   color:"#f97316", label:"Doblado"   },
      { v:"RECHAZADO", n:rechazados, color:C.red,     label:"Rechazado" },
    ];

    // ── KPIs ejecutivos ──
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const thisMon = history.filter(c=>new Date(c.date)>=startOfThisMonth);
    const lastMon = history.filter(c=>new Date(c.date)>=startOfLastMonth&&new Date(c.date)<=endOfLastMonth);

    const pctAprobado = n => n.length ? Math.round(n.filter(c=>c.verdict==="APROBADO").length/n.length*100) : null;
    const pctThisMon = pctAprobado(thisMon);
    const pctLastMon = pctAprobado(lastMon);
    const pctDiff = pctThisMon!==null&&pctLastMon!==null ? pctThisMon-pctLastMon : null;

    // Proveedor con más incidencias este mes
    const incidencias = thisMon.filter(c=>c.verdict!=="APROBADO");
    const provCount = {};
    incidencias.forEach(c=>{if(c.proveedor){provCount[c.proveedor]=(provCount[c.proveedor]||0)+1;}});
    const worstProv = Object.entries(provCount).sort((a,b)=>b[1]-a[1])[0];

    // Reclamaciones este mes
    const recsThisMon = reclamaciones.filter(r=>{
      const ctrl = history.find(c=>c.id===r.ctrlId);
      return ctrl && new Date(ctrl.date)>=startOfThisMonth;
    }).length;

    return (
      <div style={S.app}>
        <div style={S.header}>
          <span style={S.headerTitle}>CeraCheck</span>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {syncing && <span style={{fontSize:10,color:"#a855f7",letterSpacing:"0.05em"}}>↑ Sheets</span>}
            {syncError && <span style={{fontSize:10,color:C.red}} title={syncError}>⚠ Sync</span>}
            <button style={{...S.ghostBtn,borderColor:"#38bdf840",color:"#38bdf8"}} onClick={()=>setScreen("direccion")}>Dirección</button>
            <button style={{...S.ghostBtn,borderColor:"#f59e0b40",color:"#f59e0b"}} onClick={()=>setScreen("stats")}>Stats</button>
            <button style={S.ghostBtn} onClick={()=>setScreen("colors")}>Colores</button>
            <button style={S.ghostBtn} onClick={()=>setScreen("formats")}>Formatos</button>
          </div>
        </div>
        <div style={S.page}>
          <div style={{marginBottom:18}}>
            <div style={{fontSize:21,fontWeight:700,letterSpacing:"0.04em",color:C.text,marginBottom:3}}>Control de Calidad</div>
            <div style={{fontSize:11,color:C.textMuted,letterSpacing:"0.08em"}}>Baldosas cerámicas · Terceros</div>
          </div>

          {history.length > 0 && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:16}}>
              {statsChips.map(({v,n,color,label})=>{
                const active = verdictFilter===v;
                return (
                  <div key={v} onClick={()=>setVerdictFilter(active?null:v)} style={{
                    background: active?`${color}20`:C.surface,
                    border:`1px solid ${active?color:color+"28"}`,
                    borderRadius:8, padding:"10px 6px", textAlign:"center",
                    cursor:"pointer", transition:"all 0.15s",
                  }}>
                    <div style={{fontSize:22,fontWeight:700,color,fontFamily:font}}>{n}</div>
                    <div style={{fontSize:8,letterSpacing:"0.08em",color:active?color:C.textMuted,marginTop:2,textTransform:"uppercase"}}>{label}</div>
                  </div>
                );
              })}
            </div>
          )}

          <button style={S.primaryBtn} onClick={startNewLote}>+ Nuevo Control</button>
          {pending.length > 0 && (
            <button style={{...S.secondaryBtn, marginTop:9, borderColor:"#f59e0b", color:"#f59e0b"}}
              onClick={()=>setScreen("pending")}>
              Pendientes de inspección ({pending.length})
            </button>
          )}
          {pendingLab.length > 0 && (
            <button style={{...S.secondaryBtn, marginTop:9, borderColor:"#a855f7", color:"#a855f7"}}
              onClick={()=>setScreen("pending-lab")}>
              Pendientes de laboratorio ({pendingLab.length})
            </button>
          )}
          {history.length > 0 && (
            <button style={{...S.secondaryBtn,marginTop:9}} onClick={()=>setScreen("history")}>
              Ver historial completo ({history.length})
            </button>
          )}
          <button style={{...S.secondaryBtn,marginTop:9,borderColor:"#f87171",color:"#f87171"}}
            onClick={()=>setScreen("reclamaciones")}>
            Reclamaciones {reclamaciones.length>0?`(${reclamaciones.length})`:""}
          </button>

          {ultimas.length > 0 && (
            <div style={{marginTop:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={S.sectionTitle}>
                  {verdictFilter ? `Filtrando: ${verdictFilter}` : "Últimas revisiones"}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {verdictFilter && <button style={{...S.ghostBtn,fontSize:10,padding:"2px 8px",color:"#f59e0b",borderColor:"#f59e0b40"}} onClick={()=>setVerdictFilter(null)}>✕ Limpiar</button>}
                  {unseen.length > 0 && !verdictFilter && <span style={{fontSize:10,color:C.textMuted}}>{unseen.length} sin revisar</span>}
                </div>
              </div>
              {ultimas.map(ctrl=>{
                const fmt      = formats.find(f=>f.id===ctrl.formatId);
                const color    = colors.find(c=>c.id===ctrl.colorId);
                const incomplete = isIncomplete(ctrl);
                const isSeen   = seenIds.has(ctrl.id);
                const fmtCm  = fmt ? `${fmt.ancho/10}×${fmt.largo/10}` : "—";
                const grosor = getGrosor(ctrl);
                const fila2  = [
                  color ? `${color.abbr} ${color.color}` : null,
                  fmtCm!=="—"?fmtCm:null,
                  grosor===20?"2cm":null,
                  ctrl.lote||null,
                ].filter(Boolean).join(" · ");
                const isExpanded = expandedHomeId === ctrl.id;
                return (
                  <div key={ctrl.id} style={{marginBottom:7}}>
                    <div style={{
                        background: isSeen ? "#0d0d0d" : C.surface,
                        border:`1px solid ${isExpanded ? C.gold : isSeen ? "#1e1e1e" : incomplete?"#f59e0b30":C.border}`,
                        borderRadius: isExpanded ? "8px 8px 0 0" : 8,
                        padding:"12px 14px",
                        display:"flex", justifyContent:"space-between", alignItems:"center", gap:10,
                        opacity: isSeen ? 0.6 : 1,
                        cursor:"pointer",
                      }}
                      onClick={()=>setExpandedHomeId(isExpanded ? null : ctrl.id)}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                          <span style={{fontSize:10,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
                          <span style={{
                            fontSize:9,fontWeight:700,letterSpacing:"0.08em",
                            color:ctrl.colorUso==="IN"?"#38bdf8":"#f59e0b",
                            background:ctrl.colorUso==="IN"?"#0a1f2a":"#2a1f0a",
                            padding:"1px 6px",borderRadius:3,
                          }}>{ctrl.colorUso||""}</span>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>
                          {fila2||"—"}
                        </div>
                        <div style={{fontSize:11,color:C.textMuted}}>{ctrl.proveedor||"—"}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        {(()=>{
                          const ci = getChipInfo(ctrl, formats);
                          return (ci?.tono||ci?.medidas||ci?.planStr) ? (
                            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:3,borderRight:`1px solid ${C.border}`,paddingRight:10}}>
                              {ci.tono   && <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Tono</span>{ci.tono}</span>}
                              {ci.medidas&& <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Medidas</span>{ci.medidas}</span>}
                              {ci.planStr&& <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Plan.</span>{ci.planStr}</span>}
                            </div>
                          ) : null;
                        })()}
                        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                          {getChipBadges(ctrl).map((b,i)=>(
                            <span key={i} style={{fontSize:9,fontWeight:700,color:b.color,background:b.bg,padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap"}}>{b.label}</span>
                          ))}
                          {incomplete&&<span style={{fontSize:9,fontWeight:700,color:"#f59e0b",background:"#2a1f0a",padding:"2px 6px",borderRadius:4}}>INCOMPLETO</span>}
                          {!incomplete&&pendingLab.includes(ctrl.id)&&<span style={{fontSize:9,fontWeight:700,color:"#a855f7",background:"#1a0a2a",padding:"2px 6px",borderRadius:4}}>LAB ⏳</span>}
                          <span style={{fontSize:10,color:isExpanded?C.gold:C.textMuted}}>{isExpanded?"▲":"▼"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Desplegable inline */}
                    {isExpanded && (
                      <div style={{
                        background:"#0a0a0a",
                        border:`1px solid ${C.gold}`,
                        borderTop:"none",
                        borderRadius:"0 0 8px 8px",
                        padding:"14px",
                      }}>
                        {/* Veredicto */}
                        {ctrl.verdict && (
                          <div style={{
                            background:verdictBg(ctrl.verdict),border:`1px solid ${verdictColor(ctrl.verdict)}`,
                            borderRadius:6,padding:"10px 14px",textAlign:"center",marginBottom:12,
                          }}>
                            <div style={{fontSize:9,letterSpacing:"0.15em",color:C.textMuted,marginBottom:3}}>VEREDICTO</div>
                            <div style={{fontSize:20,fontWeight:700,letterSpacing:"0.2em",color:verdictColor(ctrl.verdict)}}>{ctrl.verdict}</div>
                          </div>
                        )}

                        {/* Info general */}
                        <div style={{...S.card,marginBottom:10,padding:"10px 12px"}}>
                          {[
                            ctrl.referencia && ["Referencia", ctrl.referencia],
                            ctrl.lote && ["Lote", ctrl.lote],
                            ["Baldosas", ctrl.tiles.length],
                          ].filter(Boolean).map(([k,v])=>(
                            <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                              <span style={{color:C.textMuted}}>{k}</span><span>{v}</span>
                            </div>
                          ))}
                        </div>

                        {/* Detalle por baldosa */}
                        {ctrl.tiles.map((tile,idx)=>{
                          const st = getTileStatuses(tile);
                          const tv = verdictFromStatuses(Object.values(st));
                          return (
                            <div key={tile.id} style={{
                              ...S.card,padding:"10px 12px",marginBottom:6,
                              borderColor: tv==="APROBADO"?"#4ade8028":tv==="RECHAZADO"?"#f8717128":(tv==="DOBLADO"||tv==="MAL TONO")?"#fbbf2428":C.border,
                            }}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                                <span style={{fontSize:11,fontWeight:600,color:C.gold}}>Baldosa {idx+1}</span>
                                {tv && <span style={{fontSize:9,color:verdictColor(tv),letterSpacing:"0.1em",fontWeight:700}}>{tv}</span>}
                              </div>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,fontSize:11}}>
                                <div><span style={{color:C.textMuted}}>Tono: </span>{tile.tone||"—"}</div>
                                <div><span style={{color:C.textMuted}}>Plan.: </span>{(()=>{
                                  const val = tile.planimetria==="otro"?(tile.planimetriaCustom||"—"):tile.planimetria?tile.planimetria+" mm":"—";
                                  const dir = tile.planimetriaDir?(tile.planimetriaDir==="arriba"?" ⌒":" ⌣"):"";
                                  return val+dir;
                                })()}</div>
                                <div><span style={{color:C.textMuted}}>Ancho: </span>{(()=>{
                                  if(tile.anchoOpt==="otro") return tile.anchoCustom?tile.anchoCustom+" mm":"—";
                                  if(!tile.anchoOpt) return "—";
                                  const base=fmt?.ancho||0; const is375=fmt?.id==="375x750"; const is300=fmt?.id==="300x600";
                                  return (tile.anchoOpt==="nominal"?base:tile.anchoOpt==="minus1"?((is375||is300)?base-2:base-1):((is375||is300)?base-3:base-2))+" mm";
                                })()}</div>
                                <div><span style={{color:C.textMuted}}>Largo: </span>{(()=>{
                                  if(tile.largoOpt==="otro") return tile.largoCustom?tile.largoCustom+" mm":"—";
                                  if(!tile.largoOpt) return "—";
                                  const base=fmt?.largo||0;
                                  return (tile.largoOpt==="nominal"?base:tile.largoOpt==="minus1"?base-1:base-2)+" mm";
                                })()}</div>
                              </div>
                              {tile.rd && (()=>{const info=getRdInfo(tile.rd,ctrl.colorUso); return (
                                <div style={{marginTop:6,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                                  <span style={{color:C.textMuted}}>RD</span>
                                  <span style={{fontWeight:700,color:info?info.color:C.textDim}}>{tile.rd}{info&&<span style={{fontSize:9,marginLeft:5,color:info.color,background:info.bg,padding:"1px 5px",borderRadius:3}}>{info.label}</span>}</span>
                                </div>
                              );})()}
                              {tile.nota&&<div style={{marginTop:6,fontSize:10,color:C.textMuted,fontStyle:"italic"}}>{tile.nota}</div>}
                            </div>
                          );
                        })}

                        {/* Lab */}
                        {ctrl.labDone && (ctrl.labEspesor || ctrl.labManchas !== undefined) && (
                          <div style={{...S.card,padding:"10px 12px",marginBottom:10,borderColor:"#a855f730"}}>
                            <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#a855f7",marginBottom:8}}>Laboratorio</div>
                            {ctrl.labEspesor&&<div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:C.textMuted}}>Espesor</span><span>{ctrl.labEspesor} mm</span></div>}
                            {ctrl.labManchas!==undefined&&ctrl.labManchas!==null&&(
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                                <span style={{color:C.textMuted}}>Manchas</span>
                                <span style={{fontWeight:700,color:ctrl.labManchas?"#f87171":C.green}}>{ctrl.labManchas?"Se mancha":"No se mancha"}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Acciones */}
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          <button style={{...S.secondaryBtn,flex:1,fontSize:11}} onClick={()=>editControl(ctrl)}>Editar</button>
                          <button style={{...S.secondaryBtn,flex:1,fontSize:11,borderColor:"#a855f7",color:"#a855f7"}}
                            onClick={()=>openLab(ctrl,"home")}>{ctrl.labDone?"Lab ✓":"Añadir lab"}</button>
                          <button style={{
                            ...S.secondaryBtn,flex:1,fontSize:11,
                            borderColor:isSeen?"#3a3a3a":"#4ade8040",
                            color:isSeen?"#4a4a4a":C.green,
                          }} onClick={()=>{const n=new Set(seenIds); isSeen?n.delete(ctrl.id):n.add(ctrl.id); setSeenIds(n); saveAppData("seenIds",[...n]).catch(()=>{}); if(!isSeen) setExpandedHomeId(null);}}>
                            {isSeen?"✓ Visto":"Marcar visto"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── FORMATS ──────────────────────────────────────────────────────
  if (screen === "formats") {
    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>{setFmtError("");setScreen("home");}}>← Volver</button>
          <span style={S.headerTitle}>Gestión de Formatos</span>
          <span style={{fontSize:11,color:C.textMuted}}>{formats.length}</span>
        </div>
        <div style={S.page}>
          <div style={S.sectionTitle}>Añadir formato</div>
          <div style={S.card}>
            <div style={S.measureRow}>
              <div>
                <label style={S.label}>Largo (mm)</label>
                <input style={S.input} type="number" placeholder="1200"
                  value={newFmt.largo} onChange={e=>setNewFmt(f=>({...f,largo:e.target.value}))} />
              </div>
              <div>
                <label style={S.label}>Ancho (mm)</label>
                <input style={S.input} type="number" placeholder="600"
                  value={newFmt.ancho} onChange={e=>setNewFmt(f=>({...f,ancho:e.target.value}))} />
              </div>
            </div>
            {fmtError && <div style={{fontSize:11,color:C.red,marginBottom:8}}>{fmtError}</div>}
            <button style={S.primaryBtn} onClick={handleAddFormat}>Añadir</button>
          </div>

          <div style={S.sectionTitle}>Formatos existentes</div>
          {formats.map(f=>(
            <div key={f.id} style={{
              ...S.card, display:"flex", justifyContent:"space-between",
              alignItems:"center", padding:"12px 14px",
            }}>
              <div>
                <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{f.label} mm</div>
                <div style={{fontSize:10,color:C.textMuted}}>{f.largo} × {f.ancho} mm</div>
              </div>
              {formats.length > 1 && (
                <button style={{...S.ghostBtn,color:C.red,borderColor:"#f8717128"}}
                  onClick={()=>{const u=formats.filter(x=>x.id!==f.id); setFormats(u); saveFormatsToSheet(u).catch(()=>{})}}>Eliminar</button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── NEW-LOTE ─────────────────────────────────────────────────────
  if ((screen === "new-lote") && activeControl) {
    const ctrl = activeControl;
    const isEditingLote = !!editingId;
    const canSaveLote = !!ctrl.lote && !!ctrl.formatId && !!ctrl.colorId && !!ctrl.colorSerie;
    const color = colors.find(c=>c.id===ctrl.colorId);
    const fmt   = formats.find(f=>f.id===ctrl.formatId);

    // Lote summary chip preview
    const fmtCm = fmt ? `${fmt.ancho/10}×${fmt.largo/10}` : "—";
    const grosor = getGrosor(ctrl);
    const chip  = [color?`${color.abbr} ${color.color}`:null, fmtCm!=="—"?fmtCm:null, grosor===20?"2cm":null, ctrl.lote||null].filter(Boolean).join(" · ");

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>{setAC(null);setEditingId(null);setScreen(prevScreen||"home");}}>← Cancelar</button>
          <span style={S.headerTitle}>{isEditingLote?"Editar lote":"Nuevo lote"}</span>
          <span style={{fontSize:11,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
        </div>
        <div style={S.page}>

          <div style={S.card}>
            <div style={{marginBottom:10}}>
              <label style={S.label}>Proveedor</label>
              <input style={S.input} placeholder="Nombre del proveedor"
                value={ctrl.proveedor} onChange={e=>updateMeta("proveedor",e.target.value)} />
            </div>
            <div style={S.measureRow}>
              <div>
                <label style={S.label}>Referencia</label>
                <input style={S.input} placeholder="REF-001"
                  value={ctrl.referencia} onChange={e=>updateMeta("referencia",e.target.value)} />
              </div>
              <div>
                <label style={{...S.label, color:!ctrl.lote?"#f59e0b":C.textMuted}}>Lote *</label>
                <input style={{...S.input, borderColor:!ctrl.lote?"#f59e0b40":C.border}}
                  placeholder="LOT-001" value={ctrl.lote}
                  onChange={e=>updateMeta("lote",e.target.value)} />
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <label style={S.label}>Formato *</label>
              <select style={{...S.input,appearance:"none",WebkitAppearance:"none"}}
                value={ctrl.formatId} onChange={e=>updateMeta("formatId",e.target.value)}>
                {formats.map(f=><option key={f.id} value={f.id}>{f.label} mm</option>)}
              </select>
            </div>

            {/* Color picker */}
            <div>
              <label style={S.label}>Color *</label>
              <div style={{display:"flex",marginBottom:8,borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`}}>
                {["OUT","IN"].map((uso,i)=>{
                  const active=ctrl.colorUso===uso;
                  return (
                    <button key={uso} onClick={()=>updateMeta("colorUso",uso)} style={{
                      flex:1,padding:"10px",border:"none",cursor:"pointer",fontFamily:font,
                      fontSize:12,fontWeight:700,letterSpacing:"0.12em",
                      background:active?(uso==="OUT"?"#2a1f0a":"#0a1f2a"):C.bg,
                      color:active?(uso==="OUT"?"#f59e0b":"#38bdf8"):C.textMuted,
                      borderRight:uso==="OUT"?`1px solid ${C.border}`:"none",
                    }}>{uso} — {uso==="OUT"?"Exterior":"Interior"}</button>
                  );
                })}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8,justifyContent:"center"}}>
                {[...allSeries].sort().map(serie=>{
                  const sel=ctrl.colorSerie===serie;
                  return (
                    <button key={serie} onClick={()=>updateMeta("colorSerie",sel?"":serie)} style={{
                      padding:"9px 14px",borderRadius:6,cursor:"pointer",fontFamily:font,
                      fontSize:13,fontWeight:600,
                      background:sel?C.gold:C.bg, color:sel?C.bg:C.textMuted,
                      border:sel?`1px solid ${C.gold}`:`1px solid ${C.border}`,
                    }}>{colors.find(c=>c.serie===serie)?.abbr} · {serie}</button>
                  );
                })}
              </div>
              {ctrl.colorSerie && (
                <div style={{display:"grid",gridTemplateColumns:`repeat(${colors.filter(c=>c.serie===ctrl.colorSerie).length},1fr)`,gap:6,marginBottom:8}}>
                  {colors.filter(c=>c.serie===ctrl.colorSerie).map(c=>{
                    const sel=ctrl.colorId===c.id;
                    const ac=ctrl.colorUso==="OUT"?"#f59e0b":"#38bdf8";
                    return (
                      <button key={c.id} onClick={()=>updateMeta("colorId",c.id)} style={{
                        padding:"16px 8px",borderRadius:6,cursor:"pointer",fontFamily:font,
                        fontSize:13,fontWeight:700,textAlign:"center",
                        background:sel?(ctrl.colorUso==="OUT"?"#2a1f0a":"#0a1f2a"):C.bg,
                        color:sel?ac:C.textMuted,
                        border:sel?`2px solid ${ac}`:`1px solid ${C.border}`,
                      }}>{c.color}</button>
                    );
                  })}
                </div>
              )}
              {ctrl.colorId&&ctrl.colorSerie&&(
                <div style={{padding:"7px 10px",borderRadius:4,background:ctrl.colorUso==="OUT"?"#2a1f0a":"#0a1f2a",border:`1px solid ${ctrl.colorUso==="OUT"?"#f59e0b40":"#38bdf840"}`,fontSize:11,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:9,fontWeight:700,padding:"2px 5px",borderRadius:3,background:ctrl.colorUso==="OUT"?"#f59e0b":"#38bdf8",color:C.bg}}>{ctrl.colorUso}</span>
                  <span style={{color:C.text}}>{color?.abbr} {color?.color}</span>
                </div>
              )}
            </div>
          </div>

          {/* Espesor */}
          {(()=>{
            const has20 = canHave20mm(ctrl.formatId, ctrl.colorId);
            if (!has20) return (
              <div style={{display:"flex",alignItems:"center",gap:8,background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"7px 12px",marginBottom:10}}>
                <span style={{fontSize:10,fontWeight:700,color:C.textMuted,background:"#2a2a2a",padding:"1px 7px",borderRadius:3}}>10 mm</span>
                <span style={{fontSize:11,color:C.textMuted}}>Espesor estándar</span>
              </div>
            );
            return (
              <div style={{background:"#1a0a2a",border:`1px solid #a855f740`,borderRadius:6,padding:"9px 12px",marginBottom:10}}>
                <label style={{...S.label,color:"#c084fc",marginBottom:6}}>Espesor</label>
                <div style={{display:"flex",gap:6}}>
                  {[10,20].map(g=>{
                    const sel=(ctrl.grosor||10)===g;
                    return (
                      <button key={g} onClick={()=>updateMeta("grosor",g)} style={{
                        flex:1,padding:"8px 6px",borderRadius:5,cursor:"pointer",fontFamily:font,textAlign:"center",
                        background:sel?"#2a0a4a":C.bg, border:sel?"2px solid #a855f7":`1px solid ${C.border}`,
                      }}>
                        <span style={{fontSize:13,fontWeight:700,color:sel?"#c084fc":C.textMuted,display:"block"}}>{g} mm</span>
                        <span style={{fontSize:9,color:sel?"#a855f7":C.textMuted,display:"block",marginTop:1}}>{g===10?"estándar":"especial"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Preview chip */}
          {canSaveLote && (
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:12}}>
              <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:5}}>Vista previa del chip</div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{chip}</div>
              <div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{ctrl.proveedor||"Sin proveedor"}</div>
            </div>
          )}

          <button style={{...S.primaryBtn, opacity:canSaveLote?1:0.38}} disabled={!canSaveLote} onClick={saveLote}>
            {isEditingLote ? "Guardar cambios" : "Crear control"}
          </button>
        </div>
      </div>
    );
  }

  // ── PENDING ───────────────────────────────────────────────────────
  if (screen === "pending") {
    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Pendientes</span>
          <span style={{fontSize:11,color:C.textMuted}}>{pending.length}</span>
        </div>
        <div style={S.page}>
          {pending.length===0 && (
            <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"40px 0"}}>
              No hay controles pendientes
            </div>
          )}
          {pending.map(ctrl=>{
            const fmt   = formats.find(f=>f.id===ctrl.formatId);
            const color = colors.find(c=>c.id===ctrl.colorId);
            const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
            const grosor = getGrosor(ctrl);
            const chip  = [color?`${color.abbr} ${color.color}`:null, fmtCm!=="—"?fmtCm:null, grosor===20?"2cm":null, ctrl.lote||null].filter(Boolean).join(" · ");
            return (
              <div key={ctrl.id} style={{
                background:C.surface, border:`1px solid ${C.border}`,
                borderRadius:8, marginBottom:8, overflow:"hidden",
              }}>
                <div style={{padding:"14px 15px"}}>
                  <div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>{formatDate(ctrl.date)}</div>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:3}}>{chip}</div>
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:12}}>{ctrl.proveedor||"Sin proveedor"}</div>
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.primaryBtn, flex:2}} onClick={()=>openInspection(ctrl)}>
                      Iniciar inspección
                    </button>
                    <button style={{...S.ghostBtn, flex:1}} onClick={()=>editLote(ctrl)}>
                      Editar lote
                    </button>
                    <button style={{...S.ghostBtn, flex:0, borderColor:"#f8717128", color:C.red}}
                      onClick={()=>setPending(p=>p.filter(c=>c.id!==ctrl.id))}>
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          <button style={{...S.secondaryBtn,marginTop:8}} onClick={()=>{ setAC(null);setEditingId(null);startNewLote();}}>
            + Nuevo lote
          </button>
        </div>
      </div>
    );
  }

  // ── CONTROL ──────────────────────────────────────────────────────
  if (screen === "control" && activeControl) {
    const ctrl = activeControl;
    const verdict = getVerdict(ctrl);
    const fmt   = formats.find(f=>f.id===ctrl.formatId);
    const color = colors.find(c=>c.id===ctrl.colorId);
    const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
    const grosor = getGrosor(ctrl);
    const chip  = [color?`${color.abbr} ${color.color}`:null, fmtCm!=="—"?fmtCm:null, grosor===20?"2cm":null, ctrl.lote||null].filter(Boolean).join(" · ");

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("pending")}>← Pendientes</button>
          <span style={S.headerTitle}>Inspección</span>
          <span style={{fontSize:11,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
        </div>
        <div style={S.page}>

          {/* Lote summary chip */}
          <div style={{
            background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, padding:"11px 14px", marginBottom:14,
            display:"flex", justifyContent:"space-between", alignItems:"center",
          }}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>{chip}</div>
              <div style={{fontSize:11,color:C.textMuted}}>{ctrl.proveedor||"Sin proveedor"}</div>
            </div>
            <button style={{...S.ghostBtn,fontSize:10,padding:"4px 9px"}} onClick={()=>editLote(ctrl)}>Editar</button>
          </div>
          <div style={S.sectionTitle}>Baldosas ({ctrl.tiles.length})</div>
          {ctrl.tiles.map((tile,idx)=>{
            const st = getTileStatuses(tile);
            return (
              <div key={tile.id} style={{
                background:C.surfaceAlt, border:`1px solid ${C.border}`,
                borderRadius:8, padding:14, marginBottom:9,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:13}}>
                  <span style={{fontSize:11,letterSpacing:"0.12em",color:C.gold,textTransform:"uppercase"}}>
                    Baldosa {idx+1}
                  </span>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <StatusDot status={st.tone}/><StatusDot status={st.planimetria}/>
                    {ctrl.tiles.length>1 && (
                      <button style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,padding:"0 3px"}}
                        onClick={()=>removeTile(tile.id)}>✕</button>
                    )}
                  </div>
                </div>

                {/* Fotos */}
                <div style={{marginBottom:12}}>
                  <label style={S.label}>Fotos</label>
                  <label style={{
                    display:"flex", alignItems:"center", justifyContent:"center",
                    gap:8, padding:"12px", borderRadius:6, cursor:"pointer",
                    border:`1px dashed ${tile.fotos.length===0?"#f59e0b":C.border}`,
                    background: tile.fotos.length===0?"#2a1f0a":C.bg,
                    color: tile.fotos.length===0?"#f59e0b":C.textMuted,
                    fontSize:11, fontFamily:font,
                  }}>
                    <span style={{fontSize:16}}>📷</span>
                    <span>{tile.fotos.length===0?"Añadir foto (obligatorio)":"+ Añadir otra foto"}</span>
                    <input type="file" accept="image/*" multiple style={{display:"none"}}
                      onChange={e=>{
                        const files = Array.from(e.target.files);
                        files.forEach((file, fi)=>{
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const ext = file.name.split(".").pop() || "jpg";
                            const currentFotos = activeControl?.tiles?.find(t=>t.id===tile.id)?.fotos || tile.fotos;
                            const fotoIdx = currentFotos.length + fi;
                            const totalTiles = ctrl.tiles.length;
                            const totalFotos = currentFotos.length + files.length;
                            const name = buildFotoName(ctrl, colors, formats, idx, fotoIdx, totalTiles, totalFotos, ext);
                            updateTile(tile.id,"fotos",[...currentFotos,{id:Date.now()+Math.random(),src:ev.target.result,name}]);
                          };
                          reader.readAsDataURL(file);
                        });
                        e.target.value="";
                      }}
                    />
                  </label>
                  {tile.fotos.length>0 && (
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:8}}>
                      {tile.fotos.map(foto=>(
                        <div key={foto.id} style={{position:"relative",borderRadius:6,overflow:"hidden",aspectRatio:"1",background:C.bg}}>
                          <img src={foto.src} alt={foto.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          <button onClick={()=>updateTile(tile.id,"fotos",tile.fotos.filter(f=>f.id!==foto.id))}
                            style={{
                              position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.7)",
                              border:"none",borderRadius:"50%",width:22,height:22,
                              color:"#fff",cursor:"pointer",fontSize:12,lineHeight:"22px",textAlign:"center",padding:0,
                            }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <label style={S.label}>Tono</label>
                <div style={S.toneGrid}>
                  {TONE_OPTIONS.map(opt=>{
                    const sel = tile.tone===opt.value;
                    const bc  = opt.ok?C.green:opt.warn?C.yellow:C.red;
                    return (
                      <button key={opt.value} onClick={()=>updateTile(tile.id,"tone",opt.value)}
                        style={{
                          background:sel?opt.color:C.bg,
                          border:sel?`2px solid ${bc}`:"1px solid #4a4a4a",
                          borderRadius:4, padding:"21px 3px", cursor:"pointer", textAlign:"center", background:sel?opt.color:"#1a1a1a",
                        }}>
                        <span style={{fontSize:15,fontWeight:700,color:sel?"#0f0f0f":"#d0c8bc",fontFamily:font,display:"block"}}>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                <label style={S.label}>Anotaciones</label>
                <textarea
                  style={{...S.input, resize:"vertical", minHeight:64, lineHeight:1.5, marginBottom:8}}
                  placeholder="Observaciones sobre esta baldosa..."
                  value={tile.nota}
                  onChange={e=>updateTile(tile.id,"nota",e.target.value)}
                />

                {/* Medidas */}
                <label style={S.label}>
                  Medidas — nominal {currentFmt?.label} mm
                </label>

                {[["ancho","anchoOpt","anchoCustom",currentFmt?.ancho],["largo","largoOpt","largoCustom",currentFmt?.largo]].map(([dim,optKey,customKey,nominal])=>{
                  const is375ancho = dim==="ancho" && currentFmt?.id==="375x750";
                  const is300ancho = dim==="ancho" && currentFmt?.id==="300x600";
                  const offsets = is375ancho ? [0,-2,-3] : is300ancho ? [0,-2,-3] : [0,-1,-2];
                  const opts=[
                    {v:"nominal", l:`${nominal}`,          sub:"nominal"},
                    {v:"minus1",  l:`${nominal+offsets[1]}`, sub:`${offsets[1]} mm`},
                    {v:"minus2",  l:`${nominal+offsets[2]}`, sub:`${offsets[2]} mm`},
                    {v:"otro",    l:"Otro",                  sub:"valor libre"},
                  ];
                  return (
                    <div key={dim} style={{
                      background:C.surfaceAlt,
                      border:`1px solid ${C.border}`,
                      borderRadius:6,
                      padding:10,
                      marginBottom:8,
                    }}>
                      <label style={{...S.label, marginBottom:8}}>
                        {dim==="ancho"?"Ancho":"Largo"}
                        {(is375ancho||is300ancho) && <span style={{marginLeft:6,fontSize:9,color:"#f59e0b",background:"#2a1f0a",padding:"1px 5px",borderRadius:3}}>excepción</span>}
                      </label>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
                        {opts.map(opt=>{
                          const sel=tile[optKey]===opt.v;
                          return (
                            <button key={opt.v} onClick={()=>updateTile(tile.id,optKey,opt.v)} style={{
                              padding:"16px 4px", borderRadius:4, cursor:"pointer", fontFamily:font,
                              textAlign:"center", border: sel?`2px solid ${C.gold}`:"1px solid #4a4a4a",
                              background: sel?C.surface:"#1a1a1a",
                            }}>
                              <span style={{fontSize:14,fontWeight:700,color:sel?C.gold:C.textDim,display:"block"}}>{opt.l}</span>
                            </button>
                          );
                        })}
                      </div>
                      {tile[optKey]==="otro" && (
                        <input style={{...S.input,marginTop:6}} type="number" placeholder="Medida real (mm)"
                          value={tile[customKey]}
                          onChange={e=>updateTile(tile.id,customKey,e.target.value)} />
                      )}
                    </div>
                  );
                })}

                {/* Planimetría */}
                <label style={S.label}>Planimetría (mm)</label>
                {(()=>{
                  const planOpts=["0.0","0.5","0.5–1","1.0","1.3","1.5","2.0","otro"];
                  const planStatus=v=>{
                    if(!v||v==="")return null;
                    const n=v==="0.5–1"?0.75:parseFloat(v);
                    if(isNaN(n))return null;
                    return n<=0.5?"ok":n<=1.0?"warn":"reject";
                  };
                  return (
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:6}}>
                        {planOpts.map(opt=>{
                          const sel=tile.planimetria===opt;
                          const st=planStatus(opt);
                          const stColor=st==="ok"?C.green:st==="warn"?C.yellow:st==="reject"?C.red:C.gold;
                          return (
                            <button key={opt} onClick={()=>updateTile(tile.id,"planimetria",opt)} style={{
                              padding:"16px 4px", borderRadius:4, cursor:"pointer", fontFamily:font,
                              textAlign:"center",
                              border: sel?`2px solid ${stColor}`:"1px solid #4a4a4a",
                              background: sel?C.surface:"#1a1a1a",
                            }}>
                              <span style={{fontSize:14,fontWeight:700,color:sel?stColor:"#c0b8b0",display:"block"}}>{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                      {tile.planimetria==="otro" && (
                        <input style={S.input} type="number" placeholder="Valor real (mm)" step="0.1"
                          value={tile.planimetriaCustom}
                          onChange={e=>updateTile(tile.id,"planimetriaCustom",e.target.value)} />
                      )}
                      {tile.planimetria && tile.planimetria!=="0.0" && (
                        <div style={{display:"flex",gap:6,marginTop:8}}>
                          {[
                            {v:"arriba", icon:"⌒", label:"Abajo"},
                            {v:"abajo",  icon:"⌣", label:"Arriba"},
                          ].map(({v,icon,label})=>{
                            const sel = tile.planimetriaDir===v;
                            return (
                              <button key={v} onClick={()=>updateTile(tile.id,"planimetriaDir", sel?"":v)} style={{
                                flex:1, padding:"10px 8px", borderRadius:5, cursor:"pointer", fontFamily:font,
                                textAlign:"center",
                                background: sel?"#0a1f2a":C.bg,
                                border: sel?"2px solid #38bdf8":`1px solid ${C.border}`,
                              }}>
                                <span style={{fontSize:20,display:"block",lineHeight:1,color:sel?"#38bdf8":C.textMuted}}>{icon}</span>
                                <span style={{fontSize:10,fontWeight:600,color:sel?"#38bdf8":C.textMuted,display:"block",marginTop:3}}>{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            );
          })}

          <button style={{...S.secondaryBtn,marginBottom:14}} onClick={addTile}>
            + Añadir baldosa
          </button>

          {verdict && (
            <div style={{
              background:verdictBg(verdict),border:`1px solid ${verdictColor(verdict)}`,
              borderRadius:8,padding:"16px",textAlign:"center",marginBottom:14,
            }}>
              <div style={{fontSize:10,letterSpacing:"0.15em",color:C.textMuted,marginBottom:4}}>RESULTADO PRELIMINAR</div>
              <div style={{fontSize:26,fontWeight:700,letterSpacing:"0.2em",color:verdictColor(verdict)}}>{verdict}</div>
            </div>
          )}

          {/* No apto para muestras */}
          <div style={{
            ...S.card,
            marginBottom:10,
            borderColor: ctrl.noMuestras ? "#f87171" : C.border,
            background: ctrl.noMuestras ? "#1a0505" : C.surface,
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color: ctrl.noMuestras ? "#f87171" : C.textDim,letterSpacing:"0.04em"}}>
                  {ctrl.noMuestras ? "⛔ NO USAR PARA MUESTRAS" : "NO USAR PARA MUESTRAS"}
                </div>
                {ctrl.noMuestras && (
                  <div style={{fontSize:10,color:"#f87171",marginTop:3}}>Este lote está marcado como no apto para muestras</div>
                )}
              </div>
              <button onClick={()=>updateMeta("noMuestras", !ctrl.noMuestras)} style={{
                padding:"7px 16px", borderRadius:5, cursor:"pointer", fontFamily:font,
                fontSize:12, fontWeight:700, flexShrink:0, marginLeft:10,
                background: ctrl.noMuestras ? "#f87171" : C.bg,
                color: ctrl.noMuestras ? "#fff" : C.textMuted,
                border: ctrl.noMuestras ? "1px solid #f87171" : `1px solid ${C.border}`,
              }}>{ctrl.noMuestras ? "Activado" : "Activar"}</button>
            </div>
          </div>

          {(()=>{
            const hasFotos = ctrl.tiles.some(t=>t.fotos&&t.fotos.length>0);
            return (
              <>
                {!hasFotos && (
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:10,padding:"8px 12px",background:C.surface,borderRadius:6,border:`1px solid ${C.border}`}}>
                    Añade <span style={{color:"#f59e0b"}}>al menos 1 foto</span> para guardar
                  </div>
                )}
                <button style={{...S.primaryBtn,opacity:hasFotos?1:0.38}}
                  disabled={!hasFotos} onClick={saveControl}>
                  Guardar inspección
                </button>
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // ── REPORT ───────────────────────────────────────────────────────
  if (screen === "report" && activeControl) {
    const ctrl = activeControl;
    const fmt   = formats.find(f=>f.id===ctrl.formatId)||formats[0];
    const color = colors.find(c=>c.id===ctrl.colorId)||null;
    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Inicio</button>
          <span style={S.headerTitle}>Informe #{ctrl.id}</span>
          <span style={{fontSize:11,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
        </div>
        <div style={S.page}>
          <div style={{
            background:verdictBg(ctrl.verdict),border:`1px solid ${verdictColor(ctrl.verdict)}`,
            borderRadius:8,padding:"18px 16px",textAlign:"center",marginBottom:14,
          }}>
            <div style={{fontSize:10,letterSpacing:"0.15em",color:C.textMuted,marginBottom:5}}>VEREDICTO FINAL</div>
            <div style={{fontSize:28,fontWeight:700,letterSpacing:"0.2em",color:verdictColor(ctrl.verdict)}}>{ctrl.verdict}</div>
          </div>

          <div style={S.card}>
            {[
              ["Proveedor", ctrl.proveedor],
              color && ["Color", `${color.abbr} ${color.color} (${ctrl.colorUso||"—"})`],
              ["Formato",   fmt?.label+" mm"],
              ctrl.referencia && ["Referencia", ctrl.referencia],
              ctrl.lote && ["Lote", ctrl.lote],
              ["Fecha", formatDate(ctrl.date)],
              ["Baldosas revisadas", ctrl.tiles.length],
            ].filter(Boolean).map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
                <span style={{color:C.textMuted}}>{k}</span><span>{v}</span>
              </div>
            ))}
          </div>

          <div style={S.sectionTitle}>Detalle por baldosa</div>
          {ctrl.tiles.map((tile,idx)=>{
            const st = getTileStatuses(tile);
            const tv = verdictFromStatuses(Object.values(st));
            return (
              <div key={tile.id} style={{
                ...S.card,
                borderColor: tv==="APROBADO"?"#4ade8028":tv==="RECHAZADO"?"#f8717128":(tv==="DOBLADO"||tv==="MAL TONO")?"#fbbf2428":C.border,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontSize:12,fontWeight:600}}>Baldosa {idx+1}</span>
                  {tv && <span style={{fontSize:10,color:verdictColor(tv),letterSpacing:"0.1em"}}>{tv}</span>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,fontSize:12}}>
                  <div style={{display:"flex",alignItems:"center"}}>
                    <StatusDot status={st.tone}/>
                    <span style={{color:C.textMuted}}>Tono:</span>&nbsp;<span>{tile.tone||"—"}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center"}}>
                    <StatusDot status={st.planimetria}/>
                    <span style={{color:C.textMuted}}>Plan.:</span>&nbsp;
                    <span>{(()=>{
                      const val = tile.planimetria==="otro"?(tile.planimetriaCustom?tile.planimetriaCustom+" mm":"—"):tile.planimetria?tile.planimetria+" mm":"—";
                      const dir = tile.planimetriaDir?(tile.planimetriaDir==="arriba"?" ⌒":" ⌣"):"";
                      return val+dir;
                    })()}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center"}}>
                    <span style={{width:13,display:"inline-block"}}/>
                    <span style={{color:C.textMuted}}>Ancho:</span>&nbsp;
                    <span>{(()=>{
                      if(tile.anchoOpt==="otro") return tile.anchoCustom?tile.anchoCustom+" mm":"—";
                      if(!tile.anchoOpt) return "—";
                      const is375 = fmt?.id==="375x750";
                      const is300 = fmt?.id==="300x600";
                      const base = fmt?.ancho||0;
                      const val = tile.anchoOpt==="nominal"?base:tile.anchoOpt==="minus1"?((is375||is300)?base-2:base-1):((is375||is300)?base-3:base-2);
                      return val+" mm";
                    })()}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center"}}>
                    <span style={{width:13,display:"inline-block"}}/>
                    <span style={{color:C.textMuted}}>Largo:</span>&nbsp;
                    <span>{(()=>{
                      if(tile.largoOpt==="otro") return tile.largoCustom?tile.largoCustom+" mm":"—";
                      if(!tile.largoOpt) return "—";
                      const base = fmt?.largo||0;
                      const val = tile.largoOpt==="nominal"?base:tile.largoOpt==="minus1"?base-1:base-2;
                      return val+" mm";
                    })()}</span>
                  </div>
                </div>
                {tile.nota && (
                  <div style={{
                    marginTop:10, padding:"8px 10px", borderRadius:4,
                    background:"#0a0a0a", border:`1px solid ${C.border}`,
                    fontSize:11, color:C.textDim, lineHeight:1.5,
                  }}>
                    <span style={{color:C.textMuted,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",display:"block",marginBottom:3}}>Anotación</span>
                    {tile.nota}
                  </div>
                )}
                {tile.fotos && tile.fotos.length>0 && (
                  <div style={{marginTop:10}}>
                    <span style={{color:C.textMuted,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",display:"block",marginBottom:6}}>
                      Fotos ({tile.fotos.length})
                    </span>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
                      {tile.fotos.map(foto=>(
                        <div key={foto.id} style={{borderRadius:5,overflow:"hidden",aspectRatio:"1",background:C.bg}}>
                          <img src={foto.src} alt={foto.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button style={{...S.primaryBtn,marginTop:6}} onClick={()=>setScreen("home")}>Finalizar</button>
        </div>
      </div>
    );
  }

  // ── PENDING LAB ──────────────────────────────────────────────────
  if (screen === "pending-lab") {
    const labPending = history.filter(c => pendingLab.includes(c.id));
    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Pendientes laboratorio</span>
          <span style={{fontSize:11,color:C.textMuted}}>{labPending.length}</span>
        </div>
        <div style={S.page}>
          {labPending.length===0 && (
            <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"40px 0"}}>
              No hay controles pendientes de laboratorio
            </div>
          )}
          {labPending.map(ctrl=>{
            const fmt   = formats.find(f=>f.id===ctrl.formatId);
            const color = colors.find(c=>c.id===ctrl.colorId);
            const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
            const grosor = getGrosor(ctrl);
            const chip  = [color?`${color.abbr} ${color.color}`:null, fmtCm!=="—"?fmtCm:null, grosor===20?"2cm":null, ctrl.lote||null].filter(Boolean).join(" · ");
            return (
              <div key={ctrl.id} style={{background:C.surface,border:`1px solid #a855f730`,borderRadius:8,marginBottom:8,padding:"14px 15px"}}>
                <div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>{formatDate(ctrl.date)}</div>
                <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:3}}>{chip}</div>
                <div style={{fontSize:11,color:C.textMuted,marginBottom:12}}>{ctrl.proveedor||"Sin proveedor"}</div>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.primaryBtn,flex:1,background:"#a855f7"}} onClick={()=>openLab(ctrl)}>
                    Iniciar laboratorio
                  </button>
                  <button style={{...S.ghostBtn,color:"#f87171",borderColor:"#f8717128"}}
                    onClick={()=>setPendingLab(p=>p.filter(id=>id!==ctrl.id))}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── LAB ──────────────────────────────────────────────────────────
  if (screen === "lab" && labCtrl) {
    const ctrl = labCtrl;
    const color = colors.find(c=>c.id===ctrl.colorId);
    const fmt   = formats.find(f=>f.id===ctrl.formatId);
    const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
    const grosor = getGrosor(ctrl);
    const chip  = [color?`${color.abbr} ${color.color}`:null, fmtCm!=="—"?fmtCm:null, grosor===20?"2cm":null, ctrl.lote||null].filter(Boolean).join(" · ");
    const rdLimit = ctrl.colorUso==="IN" ? "≤ 30 (Interior)" : "≥ 45 (Exterior)";

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>{setLabCtrl(null);setScreen("pending-lab");}}>← Cancelar</button>
          <span style={S.headerTitle}>Laboratorio</span>
          <span style={{fontSize:11,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
        </div>
        <div style={S.page}>

          {/* Chip resumen */}
          <div style={{background:C.surface,border:`1px solid #a855f730`,borderRadius:8,padding:"11px 14px",marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>{chip}</div>
            <div style={{fontSize:11,color:C.textMuted}}>{ctrl.proveedor||"Sin proveedor"}</div>
          </div>

          {/* Espesor del lote */}
          <div style={S.sectionTitle}>Espesor del lote</div>
          <div style={S.card}>
            <label style={S.label}>Espesor medido (mm)</label>
            <input style={S.input} type="number" step="0.1" placeholder="ej. 10.2"
              value={ctrl.labEspesor||""}
              onChange={e=>updateLab("labEspesor",e.target.value)}/>
            <div style={{fontSize:10,color:C.textMuted,marginTop:4}}>Solo registro — sin validación</div>
          </div>

          {/* RD por baldosa */}
          <div style={S.sectionTitle}>RD por baldosa — {rdLimit}</div>
          {ctrl.tiles.map((tile,idx)=>{
            const info = getRdInfo(tile.rd, ctrl.colorUso);
            return (
              <div key={tile.id} style={{...S.card,padding:"12px 14px",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom: info?8:0}}>
                  <span style={{fontSize:11,color:C.gold,fontWeight:600,minWidth:70,flexShrink:0}}>Baldosa {idx+1}</span>
                  <input style={{...S.input,flex:1}} type="number" step="0.1" placeholder="RD"
                    value={tile.rd||""}
                    onChange={e=>updateLabTile(tile.id,"rd",e.target.value)}/>
                  {info && (
                    <span style={{
                      fontSize:13,fontWeight:700,color:info.color,
                      minWidth:32,textAlign:"right",flexShrink:0,
                    }}>{tile.rd}</span>
                  )}
                </div>
                {info && (
                  <div style={{background:info.bg,borderRadius:5,padding:"7px 10px",border:`1px solid ${info.color}30`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:10,fontWeight:700,color:info.color,letterSpacing:"0.06em"}}>{info.label}</span>
                      <span style={{fontSize:9,color:info.ok?"#4ade80":"#f87171"}}>
                        {ctrl.colorUso==="IN"?"Límite ≤ 30":"Límite ≥ 45"}
                      </span>
                    </div>
                    {/* Bar */}
                    <div style={{height:6,borderRadius:3,background:"#1a1a1a",overflow:"hidden",position:"relative"}}>
                      {/* Limit marker */}
                      <div style={{
                        position:"absolute",
                        left: ctrl.colorUso==="IN" ? `${30/50*100}%` : `${45/80*100}%`,
                        top:0,bottom:0,width:2,background:"#ffffff30",zIndex:1,
                      }}/>
                      <div style={{width:`${info.bar}%`,height:"100%",background:info.color,borderRadius:3,transition:"width 0.3s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                      <span style={{fontSize:8,color:"#3a3a3a"}}>{ctrl.colorUso==="IN"?"0":"0"}</span>
                      <span style={{fontSize:8,color:"#3a3a3a"}}>{ctrl.colorUso==="IN"?"50":"80"}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Manchas */}
          <div style={S.sectionTitle}>Manchas</div>
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,color:C.textDim}}>¿El lote se mancha?</span>
              <div style={{display:"flex",gap:6}}>
                {[["Sí", true],["No", false]].map(([label, val])=>{
                  const isSelected = ctrl.labManchas === val;
                  return (
                    <button key={label} onClick={()=>updateLab("labManchas", val)} style={{
                      padding:"7px 18px",borderRadius:5,cursor:"pointer",fontFamily:font,
                      fontSize:12,fontWeight:700,
                      background: isSelected ? (val ? "#f8717120" : "#4ade8020") : C.bg,
                      color: isSelected ? (val ? "#f87171" : C.green) : C.textMuted,
                      border: isSelected
                        ? `1px solid ${val ? "#f87171" : C.green}`
                        : `1px solid ${C.border}`,
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>
          </div>

          <button style={{...S.primaryBtn,marginTop:8,background:"#a855f7"}} onClick={saveLab}>
            Guardar laboratorio
          </button>
        </div>
      </div>
    );
  }

  // ── HISTORY ──────────────────────────────────────────────────────
  if (screen === "history") {
    const uniqueProveedores = [...new Set(history.map(c=>c.proveedor).filter(Boolean))];
    const uniqueFormatos    = [...new Set(history.map(c=>c.formatId).filter(Boolean))];
    const uniqueColores     = [...new Set(history.map(c=>c.colorId).filter(Boolean))];

    const q = searchQuery.toLowerCase().trim();
    const filtered = history.filter(c => {
      if (filterProveedor && c.proveedor !== filterProveedor) return false;
      if (filterFormato   && c.formatId  !== filterFormato)   return false;
      if (filterColor     && c.colorId   !== filterColor)     return false;
      if (q) {
        const color = colors.find(x=>x.id===c.colorId);
        const fmt   = formats.find(x=>x.id===c.formatId);
        const haystack = [
          c.lote, c.proveedor, c.referencia,
          color?.color, color?.abbr, color?.serie,
          fmt?.label, c.colorUso,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const hasFilters = filterProveedor || filterFormato || filterColor || searchQuery;

    return (
      <div style={S.app}>
        {lightboxFoto && (
          <div onClick={()=>setLightboxFoto(null)} style={{
            position:"fixed",top:0,left:0,right:0,bottom:0,
            background:"rgba(0,0,0,0.92)",zIndex:999,
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            padding:16,
          }}>
            <img src={lightboxFoto.src} alt={lightboxFoto.name}
              style={{maxWidth:"100%",maxHeight:"75vh",borderRadius:8,objectFit:"contain"}}
              onClick={e=>e.stopPropagation()}
            />
            <div style={{display:"flex",gap:12,marginTop:16}}>
              <a href={lightboxFoto.src} download={lightboxFoto.name||"foto.jpg"}
                onClick={e=>e.stopPropagation()}
                style={{
                  background:C.gold,color:C.bg,borderRadius:6,padding:"10px 20px",
                  fontSize:13,fontWeight:700,textDecoration:"none",letterSpacing:"0.08em",
                }}>↓ Descargar</a>
              <button onClick={()=>setLightboxFoto(null)} style={{
                background:"none",border:`1px solid ${C.border}`,color:C.textMuted,
                borderRadius:6,padding:"10px 20px",fontSize:13,cursor:"pointer",fontFamily:font,
              }}>Cerrar</button>
            </div>
          </div>
        )}
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Historial</span>
          <span style={{fontSize:11,color:C.textMuted}}>{filtered.length}/{history.length}</span>
        </div>
        <div style={S.page}>

          {/* Buscador */}
          <div style={{position:"relative",marginBottom:10}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,color:C.textMuted,pointerEvents:"none"}}>🔍</span>
            <input
              style={{...S.input,paddingLeft:32,fontSize:13}}
              placeholder="Buscar por lote, proveedor, color..."
              value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={()=>setSearchQuery("")} style={{
                position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",color:C.textMuted,cursor:"pointer",
                fontSize:16,lineHeight:1,padding:0,
              }}>✕</button>
            )}
          </div>

          {/* Filtros */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={S.sectionTitle}>Filtros</span>
              {hasFilters && (
                <button style={{...S.ghostBtn,fontSize:10,padding:"3px 8px",color:"#f59e0b",borderColor:"#f59e0b40"}}
                  onClick={()=>{setFilterProveedor("");setFilterFormato("");setFilterColor("");setSearchQuery("");}}>
                  Limpiar
                </button>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <select style={{...S.input,fontSize:12}} value={filterProveedor} onChange={e=>setFilterProveedor(e.target.value)}>
                <option value="">Todos los proveedores</option>
                {uniqueProveedores.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <select style={{...S.input,fontSize:12}} value={filterFormato} onChange={e=>setFilterFormato(e.target.value)}>
                <option value="">Todos los formatos</option>
                {uniqueFormatos.map(id=>{
                  const f=formats.find(x=>x.id===id);
                  return <option key={id} value={id}>{f?.label||id} mm</option>;
                })}
              </select>
              <select style={{...S.input,fontSize:12}} value={filterColor} onChange={e=>setFilterColor(e.target.value)}>
                <option value="">Todos los colores</option>
                {uniqueColores.map(id=>{
                  const c=colors.find(x=>x.id===id);
                  return <option key={id} value={id}>{c?`${c.abbr} ${c.color}`:id}</option>;
                })}
              </select>
            </div>
          </div>

          {filtered.length===0 && (
            <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"32px 0"}}>
              No hay controles con estos filtros
            </div>
          )}

          {filtered.map(ctrl=>{
            const fmt      = formats.find(f=>f.id===ctrl.formatId);
            const color    = colors.find(c=>c.id===ctrl.colorId);
            const incomplete = isIncomplete(ctrl);
            const colorStr = color ? `${color.serie} ${color.color} ${ctrl.colorUso||""}` : "—";
            const fmtStr   = fmt ? `${fmt.label} mm` : "—";
            const fmtCm    = fmt ? `${fmt.ancho/10}×${fmt.largo/10}` : "—";
            const grosor   = getGrosor(ctrl);
            const fila2Parts = [
              color ? `${color.abbr} ${color.color}` : null,
              fmtCm !== "—" ? fmtCm : null,
              grosor === 20 ? "2cm" : null,
              ctrl.lote || null,
            ].filter(Boolean).join(" · ");
            return (
              <div key={ctrl.id} style={{
                background:C.surface, border:`1px solid ${incomplete?"#f59e0b30":C.border}`,
                borderRadius:8, marginBottom:8, overflow:"hidden",
              }}>
                {/* Clickable summary row */}
                <div style={{padding:"13px 15px",cursor:"pointer"}}
                  onClick={()=>setViewingId(viewingId===ctrl.id?null:ctrl.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      {/* Fila 1: fecha + IN/OUT */}
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <span style={{fontSize:10,color:C.textMuted}}>{formatDate(ctrl.date)}</span>
                        <span style={{
                          fontSize:9,fontWeight:700,letterSpacing:"0.08em",
                          color:ctrl.colorUso==="IN"?"#38bdf8":"#f59e0b",
                          background:ctrl.colorUso==="IN"?"#0a1f2a":"#2a1f0a",
                          padding:"1px 6px",borderRadius:3,
                        }}>{ctrl.colorUso||""}</span>
                      </div>
                      {/* Fila 2: abbr+color+uso+medida(cm)+lote — protagonista */}
                      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {fila2Parts||"—"}
                      </div>
                      {/* Fila 4: proveedor */}
                      <div style={{fontSize:11,color:C.textMuted}}>{ctrl.proveedor||"—"}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginLeft:10,flexShrink:0}}>
                      {(()=>{
                        const ci = getChipInfo(ctrl, formats);
                        return (ci?.tono||ci?.medidas||ci?.planStr) ? (
                          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:3,borderRight:`1px solid ${C.border}`,paddingRight:12}}>
                            {ci.tono   && <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Tono</span>{ci.tono}</span>}
                            {ci.medidas&& <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Medidas</span>{ci.medidas}</span>}
                            {ci.planStr&& <span style={{fontSize:12,color:C.textDim,whiteSpace:"nowrap",display:"block"}}><span style={{color:C.textMuted,fontSize:12,display:"inline-block",width:60}}>Plan.</span>{ci.planStr}</span>}
                          </div>
                        ) : null;
                      })()}
                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                        {getChipBadges(ctrl).map((b,i)=>(
                          <span key={i} style={{fontSize:9,fontWeight:700,color:b.color,background:b.bg,padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap"}}>{b.label}</span>
                        ))}
                        {incomplete && (
                          <span style={{fontSize:9,fontWeight:700,color:"#f59e0b",background:"#2a1f0a",padding:"2px 7px",borderRadius:4}}>
                            INCOMPLETO
                          </span>
                        )}
                        <span style={{fontSize:10,color:C.textMuted,marginTop:2}}>{viewingId===ctrl.id?"▲":"▼"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {viewingId===ctrl.id && (
                  <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 15px",background:C.bg}}>
                    {/* Datos generales */}
                    <div style={{marginBottom:12}}>
                      <div style={S.sectionTitle}>Datos del control</div>
                      {[
                        ["Proveedor", ctrl.proveedor||"—"],
                        ["Color", colorStr],
                        ["Formato", fmtStr],
                        ["Espesor", `${grosor} mm${grosor===20?" — especial":" — estándar"}`],
                        ["Lote", ctrl.lote||"—"],
                        ["Referencia", ctrl.referencia||"—"],
                        ["Fecha", formatDate(ctrl.date)],
                        ["Baldosas", ctrl.tiles.length],
                      ].map(([k,v])=>(
                        <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                          <span style={{color:C.textMuted}}>{k}</span>
                          <span style={{color:C.textDim,textAlign:"right",maxWidth:"60%"}}>{v}</span>
                        </div>
                      ))}
                    </div>

                    {/* Baldosas */}
                    {ctrl.tiles.map((tile,idx)=>{
                      const st  = getTileStatuses(tile);
                      const tv  = verdictFromStatuses(Object.values(st));
                      const planVal = tile.planimetria==="otro" ? (tile.planimetriaCustom||"—") : (tile.planimetria||"—");
                      const fmt2 = formats.find(f=>f.id===ctrl.formatId);
                      const is375 = ctrl.formatId==="375x750";
                      const is300 = ctrl.formatId==="300x600";
                      const resolveAncho = opt => {
                        if(!opt||opt==="otro") return tile.anchoCustom||"—";
                        const base=fmt2?.ancho||0;
                        return opt==="nominal"?base:opt==="minus1"?((is375||is300)?base-2:base-1):((is375||is300)?base-3:base-2);
                      };
                      const resolveLargo = opt => {
                        if(!opt||opt==="otro") return tile.largoCustom||"—";
                        const base=fmt2?.largo||0;
                        return opt==="nominal"?base:opt==="minus1"?base-1:base-2;
                      };
                      return (
                        <div key={tile.id} style={{
                          background:C.surface, border:`1px solid ${tv==="APROBADO"?"#4ade8020":tv==="RECHAZADO"?"#f8717120":(tv==="DOBLADO"||tv==="MAL TONO")?"#fbbf2420":C.border}`,
                          borderRadius:6, padding:"10px 12px", marginBottom:8,
                        }}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                            <span style={{fontSize:12,fontWeight:600,color:C.textDim}}>Baldosa {idx+1}</span>
                            {tv&&<span style={{fontSize:10,color:verdictColor(tv),letterSpacing:"0.08em"}}>{tv}</span>}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,fontSize:11,marginBottom:8}}>
                            {[
                              ["Tono", tile.tone||"—", st.tone],
                              ["Planimetría", (()=>{
                                const val = tile.planimetria==="otro" ? (tile.planimetriaCustom||"—") : (tile.planimetria||"—");
                                const dir = tile.planimetriaDir ? (tile.planimetriaDir==="arriba"?" ⌒":" ⌣") : "";
                                return val+(val!=="—"&&tile.planimetria!=="otro"?" mm":"")+dir;
                              })(), st.planimetria],
                              ["Ancho", resolveAncho(tile.anchoOpt)+" mm", null],
                              ["Largo", resolveLargo(tile.largoOpt)+" mm", null],
                            ].map(([k,v,s])=>(
                              <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                                {s!==undefined&&s!==null&&<StatusDot status={s}/>}
                                {(s===undefined||s===null)&&<span style={{width:13,display:"inline-block"}}/>}
                                <span style={{color:C.textMuted}}>{k}:</span>&nbsp;
                                <span style={{color:C.textDim}}>{v}</span>
                              </div>
                            ))}
                          </div>
                          {tile.nota&&(
                            <div style={{fontSize:11,color:C.textMuted,background:"#0a0a0a",border:`1px solid ${C.border}`,borderRadius:4,padding:"6px 8px",marginBottom:tile.fotos?.length?8:0}}>
                              <span style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",display:"block",marginBottom:2,color:"#4a5568"}}>Anotación</span>
                              {tile.nota}
                            </div>
                          )}
                          {tile.fotos?.length>0&&(
                            <div>
                              <span style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#4a5568",display:"block",marginBottom:5}}>Fotos ({tile.fotos.length})</span>
                              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
                                {tile.fotos.map(f=>(
                                  <div key={f.id} style={{borderRadius:4,overflow:"hidden",aspectRatio:"1",cursor:"pointer"}}
                                    onClick={()=>setLightboxFoto(f)}>
                                    <img src={f.src} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Lab data */}
                    {ctrl.labDone && (
                      <div style={{marginBottom:12}}>
                        <div style={{...S.sectionTitle,color:"#a855f7"}}>Laboratorio</div>
                        <div style={S.card}>
                          {ctrl.labEspesor && (
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
                              <span style={{color:C.textMuted}}>Espesor medido</span>
                              <span>{ctrl.labEspesor} mm</span>
                            </div>
                          )}
                          {ctrl.labManchas !== undefined && ctrl.labManchas !== null && (
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,marginBottom:6}}>
                              <span style={{color:C.textMuted}}>Manchas</span>
                              <span style={{
                                fontWeight:700,
                                color: ctrl.labManchas ? "#f87171" : C.green,
                                background: ctrl.labManchas ? "#f8717115" : "#4ade8015",
                                border: `1px solid ${ctrl.labManchas ? "#f8717140" : "#4ade8040"}`,
                                borderRadius:4, padding:"2px 8px", fontSize:11,
                              }}>{ctrl.labManchas ? "Se mancha" : "No se mancha"}</span>
                            </div>
                          )}
                          {ctrl.tiles.map((tile,idx)=>{
                            const info = getRdInfo(tile.rd, ctrl.colorUso);
                            return tile.rd ? (
                              <div key={tile.id} style={{marginBottom:6}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,marginBottom:info?4:0}}>
                                  <span style={{color:C.textMuted}}>Baldosa {idx+1} — RD</span>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    {info&&<span style={{fontSize:9,fontWeight:700,color:info.color,background:info.bg,padding:"1px 6px",borderRadius:3}}>{info.label}</span>}
                                    <span style={{fontWeight:700,color:info?info.color:C.textMuted}}>{tile.rd}</span>
                                  </div>
                                </div>
                                {info&&(
                                  <div style={{height:4,borderRadius:2,background:"#1a1a1a",overflow:"hidden",position:"relative"}}>
                                    <div style={{position:"absolute",left:ctrl.colorUso==="IN"?`${30/50*100}%`:`${45/80*100}%`,top:0,bottom:0,width:1,background:"#ffffff30"}}/>
                                    <div style={{width:`${info.bar}%`,height:"100%",background:info.color,borderRadius:2}}/>
                                  </div>
                                )}
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}

                    {/* Reclamaciones del control */}
                    {reclamaciones.filter(r=>r.ctrlId===ctrl.id).length > 0 && (
                      <div style={{marginBottom:12}}>
                        <div style={{...S.sectionTitle,color:"#f87171"}}>Reclamaciones</div>
                        {reclamaciones.filter(r=>r.ctrlId===ctrl.id).map(rec=>(
                          <div key={rec.id} style={{background:"#1a0808",border:"1px solid #f8717128",borderRadius:6,padding:"10px 12px",marginBottom:6}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{rec.fecha} · {rec.cliente||"Sin cliente"}</div>
                                <div style={{fontSize:12,color:C.textDim,lineHeight:1.5}}>{rec.descripcion}</div>
                              </div>
                              <button style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:14,padding:"0 0 0 8px"}}
                                onClick={()=>{const u=reclamaciones.filter(x=>x.id!==rec.id); setReclamaciones(u); saveAppData("reclamaciones",u).catch(()=>{})}}>✕</button>
                            </div>
                            {rec.fotos.length>0&&(
                              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginTop:8}}>
                                {rec.fotos.map(f=>(
                                  <div key={f.id} style={{borderRadius:4,overflow:"hidden",aspectRatio:"1"}}>
                                    <img src={f.src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Botones al fondo */}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button style={{...S.secondaryBtn,flex:1}} onClick={()=>editControl(ctrl)}>
                        Editar inspección
                      </button>
                      <button style={{...S.secondaryBtn,flex:1,borderColor:"#a855f7",color:"#a855f7"}}
                        onClick={()=>openLab(ctrl,"history")}>
                        {ctrl.labDone?"Editar lab":"Añadir lab"}
                      </button>
                      <button style={{
                        ...S.secondaryBtn, flex:1,
                        borderColor: seenIds.has(ctrl.id)?"#3a3a3a":"#4ade8040",
                        color: seenIds.has(ctrl.id)?"#4a4a4a":C.green,
                        background: seenIds.has(ctrl.id)?"transparent":"rgba(74,222,128,0.05)",
                      }} onClick={()=>{const n=new Set(seenIds); seenIds.has(ctrl.id)?n.delete(ctrl.id):n.add(ctrl.id); setSeenIds(n); saveAppData("seenIds",[...n]).catch(()=>{}); if(!seenIds.has(ctrl.id)){setScreen("home")}}}>
                        {seenIds.has(ctrl.id)?"✓ Visto":"Marcar visto"}
                      </button>
                    </div>

                    {/* Floating reclamación button — only if seen */}
                    {seenIds.has(ctrl.id) && (
                    <button onClick={()=>{
                      setNewRec({
                        id:genId(),
                        ctrlId:ctrl.id,
                        lote:ctrl.lote||"",
                        proveedor:ctrl.proveedor||"",
                        colorLabel: (()=>{const col=colors.find(c=>c.id===ctrl.colorId); return col?`${col.abbr} ${col.color}`:""})(),
                        fecha:new Date().toISOString().slice(0,10),
                        cliente:"", descripcion:"", motivo:"", cantidad:"", unidad:"m2",
                        solucion:"", importe:"", notas:"", fotos:[],
                      });
                      setScreen("reclamaciones");
                    }} style={{
                      width:"100%",marginTop:12,padding:"11px",borderRadius:6,cursor:"pointer",
                      fontFamily:font,fontSize:11,fontWeight:700,letterSpacing:"0.1em",
                      textTransform:"uppercase",
                      background:"rgba(248,113,113,0.08)",
                      border:"1px solid #f8717140",color:"#f87171",
                    }}>
                      ⚠ Añadir reclamación
                    </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── RECLAMACIONES ────────────────────────────────────────────────
  if (screen === "reclamaciones") {
    const emptyRec = () => ({
      id: genId(), ctrlId:null, lote:"", proveedor:"", colorLabel:"",
      fecha: new Date().toISOString().slice(0,10),
      cliente:"", descripcion:"", motivo:"", cantidad:"", unidad:"m2",
      solucion:"", importe:"", notas:"", fotos:[],
    });

    // Form view (new reclamación)
    if (newRec) {
      const rec = newRec;
      const canSave = !!rec.descripcion;
      return (
        <div style={S.app}>
          <div style={S.header}>
            <button style={S.backBtn} onClick={()=>{setNewRec(null);}}>← Cancelar</button>
            <span style={S.headerTitle}>Nueva reclamación</span>
          </div>
          <div style={S.page}>

            {/* Linked control info */}
            {rec.lote && (
              <div style={{background:"#1a0808",border:"1px solid #f8717130",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#f87171",marginBottom:4}}>Control vinculado</div>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{rec.colorLabel} · {rec.lote}</div>
                <div style={{fontSize:11,color:C.textMuted}}>{rec.proveedor}</div>
              </div>
            )}

            <div style={S.card}>
              <div style={{marginBottom:10}}>
                <label style={S.label}>Fecha de la reclamación</label>
                <div style={{width:"100%",overflow:"hidden",borderRadius:4}}>
                  <input type="date" value={rec.fecha}
                    onChange={e=>setNewRec(r=>({...r,fecha:e.target.value}))}
                    style={{...S.input,width:"100%",boxSizing:"border-box",fontSize:13,display:"block"}}/>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <label style={S.label}>Cliente</label>
                <input style={S.input} placeholder="Nombre del cliente o empresa"
                  value={rec.cliente} onChange={e=>setNewRec(r=>({...r,cliente:e.target.value}))}/>
              </div>

              {/* Motivo */}
              <div style={{marginBottom:10}}>
                <label style={S.label}>Motivo</label>
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:5}}>
                  {["Tono","Medidas","Rotura","Doblado","Deslizamiento","Otro"].map(m=>{
                    const sel = rec.motivo===m;
                    return (
                      <button key={m} onClick={()=>setNewRec(r=>({...r,motivo:sel?"":m}))} style={{
                        padding:"9px 4px",borderRadius:5,cursor:"pointer",fontFamily:font,
                        fontSize:11,fontWeight:600,textAlign:"center",
                        background:sel?"#1a0808":C.bg,
                        color:sel?"#f87171":C.textMuted,
                        border:sel?"1px solid #f87171":`1px solid ${C.border}`,
                      }}>{m}</button>
                    );
                  })}
                </div>
              </div>

              {/* Cantidad */}
              <div style={{marginBottom:10}}>
                <label style={S.label}>Cantidad afectada</label>
                <div style={{display:"flex",gap:8}}>
                  <input style={{...S.input,flex:2}} type="number" step="0.1" placeholder="0"
                    value={rec.cantidad} onChange={e=>setNewRec(r=>({...r,cantidad:e.target.value}))}/>
                  <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`,flex:1}}>
                    {["m2","pzas"].map(u=>{
                      const sel=rec.unidad===u;
                      return (
                        <button key={u} onClick={()=>setNewRec(r=>({...r,unidad:u}))} style={{
                          flex:1,border:"none",cursor:"pointer",fontFamily:font,fontSize:11,fontWeight:600,
                          background:sel?C.surface:C.bg, color:sel?C.text:C.textMuted,
                          borderRight:u==="m2"?`1px solid ${C.border}`:"none",
                        }}>{u}</button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Descripción */}
              <div style={{marginBottom:10}}>
                <label style={{...S.label,color:!rec.descripcion?"#f87171":C.textMuted}}>Descripción *</label>
                <textarea style={{...S.input,resize:"vertical",minHeight:80,lineHeight:1.5}}
                  placeholder="Describe la incidencia..."
                  value={rec.descripcion}
                  onChange={e=>setNewRec(r=>({...r,descripcion:e.target.value}))}/>
              </div>

              {/* Solución + Importe */}
              <div style={{marginBottom:10}}>
                <label style={S.label}>Solución aplicada</label>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:8}}>
                  {["Reposición","Descuento","Pendiente"].map(s=>{
                    const sel=rec.solucion===s;
                    return (
                      <button key={s} onClick={()=>setNewRec(r=>({...r,solucion:sel?"":s}))} style={{
                        padding:"9px 4px",borderRadius:5,cursor:"pointer",fontFamily:font,
                        fontSize:11,fontWeight:600,textAlign:"center",
                        background:sel?"#0d1a0d":C.bg,
                        color:sel?C.green:C.textMuted,
                        border:sel?`1px solid ${C.green}`:`1px solid ${C.border}`,
                      }}>{s}</button>
                    );
                  })}
                </div>
              </div>

              <div style={{marginBottom:10}}>
                <label style={S.label}>Importe (€)</label>
                <input style={S.input} type="number" step="0.01" placeholder="0.00"
                  value={rec.importe} onChange={e=>setNewRec(r=>({...r,importe:e.target.value}))}/>
              </div>

              <div style={{marginBottom:10}}>
                <label style={S.label}>Notas internas</label>
                <textarea style={{...S.input,resize:"vertical",minHeight:60,lineHeight:1.5}}
                  placeholder="Anotaciones internas, acuerdos, seguimiento..."
                  value={rec.notas}
                  onChange={e=>setNewRec(r=>({...r,notas:e.target.value}))}/>
              </div>

              <label style={S.label}>Fotos de la incidencia</label>
              <label style={{
                display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                padding:"12px",borderRadius:6,cursor:"pointer",marginBottom:8,
                border:`1px dashed ${C.border}`,background:C.bg,color:C.textMuted,
                fontSize:11,fontFamily:font,
              }}>
                <span style={{fontSize:16}}>📷</span>
                <span>+ Añadir foto</span>
                <input type="file" accept="image/*" multiple style={{display:"none"}}
                  onChange={e=>{
                    Array.from(e.target.files).forEach(file=>{
                      const reader = new FileReader();
                      reader.onload = ev => setNewRec(r=>({...r,fotos:[...r.fotos,{id:Date.now()+Math.random(),src:ev.target.result,name:file.name}]}));
                      reader.readAsDataURL(file);
                    });
                    e.target.value="";
                  }}/>
              </label>
              {rec.fotos.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                  {rec.fotos.map(f=>(
                    <div key={f.id} style={{position:"relative",borderRadius:6,overflow:"hidden",aspectRatio:"1",background:C.bg}}>
                      <img src={f.src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                      <button onClick={()=>setNewRec(r=>({...r,fotos:r.fotos.filter(x=>x.id!==f.id)}))}
                        style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.7)",border:"none",borderRadius:"50%",width:22,height:22,color:"#fff",cursor:"pointer",fontSize:12,lineHeight:"22px",textAlign:"center",padding:0}}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button style={{...S.primaryBtn,background:canSave?"#f87171":"#3a2a2a",border:"none",opacity:canSave?1:0.5}}
              disabled={!canSave}
              onClick={()=>{
                const updated = [rec, ...reclamaciones];
                setReclamaciones(updated);
                setNewRec(null);
                setScreen("reclamaciones");
                saveAppData("reclamaciones", updated).catch(()=>{});
              }}>
              Guardar reclamación
            </button>
          </div>
        </div>
      );
    }

    // List view
    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Reclamaciones</span>
          <span style={{fontSize:11,color:C.textMuted}}>{reclamaciones.length}</span>
        </div>
        <div style={S.page}>

          {reclamaciones.length===0 ? (
            <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"40px 0"}}>
              No hay reclamaciones registradas.<br/>
              <span style={{fontSize:11,marginTop:6,display:"block"}}>Ábrelas desde el detalle de un control en el historial.</span>
            </div>
          ) : reclamaciones.map(rec=>{
            const ctrl = history.find(c=>c.id===rec.ctrlId);
            const fmt  = ctrl ? formats.find(f=>f.id===ctrl.formatId) : null;
            const fmtCm = fmt ? `${fmt.ancho/10}×${fmt.largo/10}` : null;
            const isExpanded = expandedRecId === rec.id;
            return (
              <div key={rec.id} style={{marginBottom:8}}>
                {/* Cabecera — clickable */}
                <div style={{
                  background:"#0d0505", border:`1px solid ${isExpanded?"#f87171":"#f8717128"}`,
                  borderRadius: isExpanded ? "8px 8px 0 0" : 8, padding:"14px 15px",
                  cursor:"pointer",
                }} onClick={()=>setExpandedRecId(isExpanded ? null : rec.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>{rec.fecha}</div>
                      {rec.lote&&(
                        <div style={{
                          display:"inline-flex",alignItems:"center",gap:6,
                          background:"#1a0808",border:"1px solid #f8717130",
                          borderRadius:5,padding:"3px 8px",marginBottom:6,
                        }}>
                          <span style={{fontSize:10,color:"#f87171",fontWeight:700}}>⚠</span>
                          <span style={{fontSize:11,color:C.textDim,fontWeight:600}}>{rec.colorLabel}</span>
                          {fmtCm&&<span style={{fontSize:10,color:C.textMuted}}>· {fmtCm}</span>}
                          <span style={{fontSize:10,color:C.textMuted}}>· {rec.lote}</span>
                          {rec.proveedor&&<span style={{fontSize:10,color:C.textMuted}}>· {rec.proveedor}</span>}
                        </div>
                      )}
                      <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:3}}>{rec.cliente||"Sin cliente"}</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                        {rec.motivo&&<span style={{fontSize:9,fontWeight:700,color:"#f87171",background:"#1a0808",padding:"1px 6px",borderRadius:3}}>{rec.motivo}</span>}
                        {rec.cantidad&&<span style={{fontSize:9,color:C.textMuted,background:C.surface,padding:"1px 6px",borderRadius:3}}>{rec.cantidad} {rec.unidad}</span>}
                        {rec.solucion&&<span style={{fontSize:9,fontWeight:700,color:C.green,background:"#0d1a0d",padding:"1px 6px",borderRadius:3}}>{rec.solucion}</span>}
                        {rec.importe&&<span style={{fontSize:9,color:C.textMuted,background:C.surface,padding:"1px 6px",borderRadius:3}}>{rec.importe} €</span>}
                      </div>
                      <div style={{fontSize:11,color:C.textMuted,lineHeight:1.5}}>{rec.descripcion}</div>
                      {rec.notas&&<div style={{fontSize:10,color:"#3d4a5a",marginTop:4,fontStyle:"italic"}}>{rec.notas}</div>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0,paddingLeft:10}}>
                      <button style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:14,padding:0,lineHeight:1}}
                        onClick={e=>{e.stopPropagation(); const u=reclamaciones.filter(x=>x.id!==rec.id); setReclamaciones(u); saveAppData("reclamaciones",u).catch(()=>{})}}>✕</button>
                      <span style={{fontSize:11,color:isExpanded?"#f87171":C.textMuted}}>{isExpanded?"▲":"▼"}</span>
                    </div>
                  </div>
                  {rec.fotos.length>0&&(
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginTop:8}}>
                      {rec.fotos.map(f=>(
                        <div key={f.id} style={{borderRadius:5,overflow:"hidden",aspectRatio:"1",background:C.bg}}>
                          <img src={f.src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Desplegable — detalle del control */}
                {isExpanded && ctrl && (()=>{
                  const color = colors.find(c=>c.id===ctrl.colorId);
                  return (
                    <div style={{
                      background:"#0a0505",
                      border:"1px solid #f87171",
                      borderTop:"none",
                      borderRadius:"0 0 8px 8px",
                      padding:"14px",
                    }}>
                      <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:"#f87171",marginBottom:10}}>Control asociado</div>

                      {/* Veredicto */}
                      {ctrl.verdict && (
                        <div style={{
                          background:verdictBg(ctrl.verdict),border:`1px solid ${verdictColor(ctrl.verdict)}`,
                          borderRadius:6,padding:"10px 14px",textAlign:"center",marginBottom:10,
                        }}>
                          <div style={{fontSize:9,letterSpacing:"0.15em",color:C.textMuted,marginBottom:3}}>VEREDICTO</div>
                          <div style={{fontSize:20,fontWeight:700,letterSpacing:"0.2em",color:verdictColor(ctrl.verdict)}}>{ctrl.verdict}</div>
                        </div>
                      )}

                      {/* Info general */}
                      <div style={{...S.card,padding:"10px 12px",marginBottom:10}}>
                        {[
                          ["Fecha", formatDate(ctrl.date)],
                          color && ["Color", `${color.abbr} ${color.color} (${ctrl.colorUso||"—"})`],
                          fmt && ["Formato", fmt.label+" mm"],
                          ctrl.referencia && ["Referencia", ctrl.referencia],
                          ctrl.lote && ["Lote", ctrl.lote],
                          ["Baldosas", ctrl.tiles.length],
                        ].filter(Boolean).map(([k,v])=>(
                          <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                            <span style={{color:C.textMuted}}>{k}</span><span>{v}</span>
                          </div>
                        ))}
                      </div>

                      {/* Detalle por baldosa */}
                      {ctrl.tiles.map((tile,idx)=>{
                        const st = getTileStatuses(tile);
                        const tv = verdictFromStatuses(Object.values(st));
                        return (
                          <div key={tile.id} style={{
                            ...S.card,padding:"10px 12px",marginBottom:6,
                            borderColor: tv==="APROBADO"?"#4ade8028":tv==="RECHAZADO"?"#f8717128":(tv==="DOBLADO"||tv==="MAL TONO")?"#fbbf2428":C.border,
                          }}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                              <span style={{fontSize:11,fontWeight:600,color:C.gold}}>Baldosa {idx+1}</span>
                              {tv && <span style={{fontSize:9,color:verdictColor(tv),letterSpacing:"0.1em",fontWeight:700}}>{tv}</span>}
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,fontSize:11}}>
                              <div><span style={{color:C.textMuted}}>Tono: </span>{tile.tone||"—"}</div>
                              <div><span style={{color:C.textMuted}}>Plan.: </span>{(()=>{
                                const val = tile.planimetria==="otro"?(tile.planimetriaCustom||"—"):tile.planimetria?tile.planimetria+" mm":"—";
                                const dir = tile.planimetriaDir?(tile.planimetriaDir==="arriba"?" ⌒":" ⌣"):"";
                                return val+dir;
                              })()}</div>
                              <div><span style={{color:C.textMuted}}>Ancho: </span>{(()=>{
                                if(tile.anchoOpt==="otro") return tile.anchoCustom?tile.anchoCustom+" mm":"—";
                                if(!tile.anchoOpt) return "—";
                                const base=fmt?.ancho||0; const is375=fmt?.id==="375x750"; const is300=fmt?.id==="300x600";
                                return (tile.anchoOpt==="nominal"?base:tile.anchoOpt==="minus1"?((is375||is300)?base-2:base-1):((is375||is300)?base-3:base-2))+" mm";
                              })()}</div>
                              <div><span style={{color:C.textMuted}}>Largo: </span>{(()=>{
                                if(tile.largoOpt==="otro") return tile.largoCustom?tile.largoCustom+" mm":"—";
                                if(!tile.largoOpt) return "—";
                                const base=fmt?.largo||0;
                                return (tile.largoOpt==="nominal"?base:tile.largoOpt==="minus1"?base-1:base-2)+" mm";
                              })()}</div>
                            </div>
                            {tile.rd && (()=>{const info=getRdInfo(tile.rd,ctrl.colorUso); return (
                              <div style={{marginTop:6,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                                <span style={{color:C.textMuted}}>RD</span>
                                <span style={{fontWeight:700,color:info?info.color:C.textDim}}>{tile.rd}{info&&<span style={{fontSize:9,marginLeft:5,color:info.color,background:info.bg,padding:"1px 5px",borderRadius:3}}>{info.label}</span>}</span>
                              </div>
                            );})()}
                            {tile.nota&&<div style={{marginTop:6,fontSize:10,color:C.textMuted,fontStyle:"italic"}}>{tile.nota}</div>}
                          </div>
                        );
                      })}

                      {/* Lab */}
                      {ctrl.labDone && (ctrl.labEspesor || ctrl.labManchas !== undefined) && (
                        <div style={{...S.card,padding:"10px 12px",borderColor:"#a855f730"}}>
                          <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#a855f7",marginBottom:8}}>Laboratorio</div>
                          {ctrl.labEspesor&&<div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:C.textMuted}}>Espesor</span><span>{ctrl.labEspesor} mm</span></div>}
                          {ctrl.labManchas!==undefined&&ctrl.labManchas!==null&&(
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                              <span style={{color:C.textMuted}}>Manchas</span>
                              <span style={{fontWeight:700,color:ctrl.labManchas?"#f87171":C.green}}>{ctrl.labManchas?"Se mancha":"No se mancha"}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── DIRECCIÓN ─────────────────────────────────────────────────────
  if (screen === "direccion") {
    const now = new Date();

    // Period calculation
    let periodStart, periodEnd = now;
    if (dirCustom && dirCustomFrom) {
      periodStart = new Date(dirCustomFrom);
      periodEnd   = dirCustomTo ? new Date(dirCustomTo+"T23:59:59") : now;
    } else {
      periodStart = new Date(now - dirPeriod * 86400000);
    }

    // Previous period (same length) for comparison
    const periodLen = periodEnd - periodStart;
    const prevStart = new Date(periodStart - periodLen);
    const prevEnd   = new Date(periodStart - 1);

    const thisMon  = history.filter(c=>{const d=new Date(c.date);return d>=periodStart&&d<=periodEnd;});
    const lastMon  = history.filter(c=>{const d=new Date(c.date);return d>=prevStart&&d<=prevEnd;});
    const last3m   = history.filter(c=>new Date(c.date)>=new Date(now.getFullYear(),now.getMonth()-3,1));

    const pctAprobado = arr => arr.length ? Math.round(arr.filter(c=>c.verdict==="APROBADO").length/arr.length*100) : null;
    const pctThisMon = pctAprobado(thisMon);
    const pctLastMon = pctAprobado(lastMon);
    const pctDiff    = pctThisMon!==null&&pctLastMon!==null ? pctThisMon-pctLastMon : null;

    // Proveedor con más incidencias en el periodo
    const incidencias = thisMon.filter(c=>c.verdict!=="APROBADO");
    const provCount = {};
    incidencias.forEach(c=>{if(c.proveedor)provCount[c.proveedor]=(provCount[c.proveedor]||0)+1;});
    const worstProv = Object.entries(provCount).sort((a,b)=>b[1]-a[1])[0];

    // Reclamaciones en el periodo
    const recsThisMon = reclamaciones.filter(r=>{
      const ctrl = history.find(c=>c.id===r.ctrlId);
      return ctrl && new Date(ctrl.date)>=periodStart && new Date(ctrl.date)<=periodEnd;
    });

    // Proveedor ranking últimos 3 meses
    const provs = [...new Set(last3m.map(c=>c.proveedor).filter(Boolean))];
    const provRanking = provs.map(p=>{
      const items = last3m.filter(c=>c.proveedor===p);
      const ok = items.filter(c=>c.verdict==="APROBADO").length;
      const pct = Math.round(ok/items.length*100);
      const recs = reclamaciones.filter(r=>items.some(c=>c.id===r.ctrlId)).length;
      return {p, total:items.length, pct, recs};
    }).sort((a,b)=>b.pct-a.pct);

    const KpiCard = ({label, value, sub, color, border}) => (
      <div style={{background:C.surface,borderRadius:10,padding:"14px",border:`1px solid ${border||color+"30"}`}}>
        <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{label}</div>
        <div style={{fontSize:28,fontWeight:700,fontFamily:font,color,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:10,color:C.textMuted,marginTop:5}}>{sub}</div>}
      </div>
    );

    const periodLabel = dirCustom&&dirCustomFrom
      ? `${dirCustomFrom} → ${dirCustomTo||"hoy"}`
      : dirPeriod===0?"Todo el historial":`Últimos ${dirPeriod} días`;

    const exportDireccion = () => {
      const vc2 = v => v==="APROBADO"?"#16a34a":v==="RECHAZADO"?"#dc2626":v==="MAL TONO"?"#ca8a04":"#ea580c";
      const pctBar = (pct,color) => `<div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;margin-top:4px"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div></div>`;

      // Proveedor ranking rows
      const rankRows = provRanking.map((r,i)=>`
        <tr>
          <td>${i+1}</td><td>${r.p}</td><td>${r.total}</td>
          <td style="color:${r.pct>=70?"#16a34a":r.pct>=50?"#ca8a04":"#dc2626"};font-weight:700">${r.pct}%</td>
          <td>${r.recs>0?`⚠ ${r.recs}`:""}</td>
        </tr>`).join("");

      // Reclamaciones summary
      const recsSummary = reclamaciones.length ? `
        <h2>Reclamaciones</h2>
        <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Lote</th><th>Motivo</th><th>Solución</th><th>Importe</th></tr></thead>
        <tbody>${reclamaciones.map(r=>{
          const ctrl=history.find(c=>c.id===r.ctrlId);
          return `<tr><td>${r.fecha}</td><td>${r.cliente||"—"}</td><td>${ctrl?.lote||"—"}</td><td>${r.motivo||"—"}</td><td>${r.solucion||"Pendiente"}</td><td>${r.importe?r.importe+" €":"—"}</td></tr>`;
        }).join("")}</tbody></table>` : "";

      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>CeraCheck — Informe Dirección</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:32px;max-width:900px}
  h1{font-size:22px;margin-bottom:4px}
  h2{font-size:15px;margin:24px 0 8px;color:#333;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
  .sub{color:#666;font-size:11px;margin-bottom:24px}
  .kpis{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
  .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:14px}
  .kpi-val{font-size:28px;font-weight:700}
  .kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#666;margin-bottom:6px}
  .kpi-sub{font-size:11px;color:#666;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px}
  th{background:#111;color:#fff;padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase}
  td{padding:6px 10px;border-bottom:1px solid #e5e7eb}
  tr:nth-child(even) td{background:#f9fafb}
  .alert{background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:11px;color:#dc2626}
</style></head><body>
<h1>CeraCheck — Informe de Dirección</h1>
<div class="sub">Periodo: ${periodLabel} · Generado el ${formatDate(new Date())}</div>

<h2>Resumen ejecutivo</h2>
<div class="kpis">
  <div class="kpi">
    <div class="kpi-label">% Aprobado</div>
    <div class="kpi-val" style="color:${pctThisMon>=70?"#16a34a":pctThisMon>=50?"#ca8a04":"#dc2626"}">${pctThisMon!==null?pctThisMon+"%":"—"}</div>
    ${pctDiff!==null?`<div class="kpi-sub">${pctDiff>=0?"↑ +":"↓ "}${pctDiff}% vs periodo anterior</div>`:""}
    <div class="kpi-sub">${thisMon.length} controles</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Incidencias</div>
    <div class="kpi-val" style="color:${incidencias.length===0?"#16a34a":"#ea580c"}">${incidencias.length}</div>
    ${worstProv?`<div class="kpi-sub">⚠ ${worstProv[0]}: ${worstProv[1]} incidencias</div>`:"<div class='kpi-sub'>Sin incidencias</div>"}
  </div>
  <div class="kpi">
    <div class="kpi-label">Reclamaciones</div>
    <div class="kpi-val" style="color:${recsThisMon.length>0?"#dc2626":"#16a34a"}">${recsThisMon.length}</div>
    <div class="kpi-sub">en el periodo</div>
  </div>
</div>

<h2>Ranking de proveedores (últimos 3 meses)</h2>
<table><thead><tr><th>#</th><th>Proveedor</th><th>Controles</th><th>% Aprobado</th><th>Reclamaciones</th></tr></thead>
<tbody>${rankRows}</tbody></table>

${recsSummary}

</body></html>`;

      const blob = new Blob([html],{type:"text/html"});
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href=url; a.download=`ceracheck-direccion-${new Date().toISOString().slice(0,10)}.html`;
      a.click(); URL.revokeObjectURL(url);
    };

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Dirección</span>
          <button style={{...S.ghostBtn,fontSize:10,padding:"4px 10px",color:C.gold,borderColor:`${C.gold}60`}}
            onClick={exportDireccion}>↓ Exportar</button>
        </div>
        <div style={S.page}>

          {/* ── Alertas ── */}
          {(()=>{
            const alerts = [];

            // % aprobado este mes por debajo del mínimo
            if (pctThisMon!==null && pctThisMon < alertConfig.pctAprobadoMin) {
              alerts.push({
                icon:"📉",
                msg:`Aprobado este mes (${pctThisMon}%) por debajo del mínimo (${alertConfig.pctAprobadoMin}%)`,
                color:"#f87171", bg:"#1a0808",
              });
            }

            // Proveedor con demasiadas incidencias
            Object.entries(provCount).forEach(([p,n])=>{
              if (n >= alertConfig.incidenciasMax) {
                alerts.push({
                  icon:"⚠️",
                  msg:`${p} tiene ${n} incidencias este mes (límite: ${alertConfig.incidenciasMax})`,
                  color:"#f97316", bg:"#1a0d00",
                });
              }
            });

            // % rechazo por proveedor
            provs.forEach(p=>{
              const items = thisMon.filter(c=>c.proveedor===p);
              if (!items.length) return;
              const pctRec = Math.round(items.filter(c=>c.verdict==="RECHAZADO").length/items.length*100);
              if (pctRec >= alertConfig.pctRechazoMax) {
                alerts.push({
                  icon:"🚨",
                  msg:`${p}: ${pctRec}% de rechazos este mes (límite: ${alertConfig.pctRechazoMax}%)`,
                  color:"#f87171", bg:"#1a0808",
                });
              }
            });

            // Demasiadas reclamaciones
            if (recsThisMon.length >= alertConfig.recsMax) {
              alerts.push({
                icon:"📋",
                msg:`${recsThisMon.length} reclamaciones este mes (límite: ${alertConfig.recsMax})`,
                color:"#f87171", bg:"#1a0808",
              });
            }

            if (!alerts.length && !showAlertConfig) return (
              <div style={{
                background:"#0a1a0a",border:"1px solid #4ade8030",borderRadius:10,
                padding:"12px 14px",marginBottom:14,
                display:"flex",justifyContent:"space-between",alignItems:"center",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>✅</span>
                  <span style={{fontSize:12,fontWeight:600,color:C.green}}>Sin alertas activas</span>
                </div>
                <button style={{...S.ghostBtn,fontSize:10,padding:"3px 8px"}} onClick={()=>setShowAlertConfig(v=>!v)}>
                  Configurar
                </button>
              </div>
            );

            return (
              <div style={{marginBottom:14}}>
                {alerts.map((a,i)=>(
                  <div key={i} style={{
                    background:a.bg,border:`1px solid ${a.color}40`,borderRadius:8,
                    padding:"10px 14px",marginBottom:6,
                    display:"flex",alignItems:"flex-start",gap:10,
                  }}>
                    <span style={{fontSize:16,flexShrink:0}}>{a.icon}</span>
                    <span style={{fontSize:12,color:a.color,fontWeight:600,lineHeight:1.4}}>{a.msg}</span>
                  </div>
                ))}
                <button style={{...S.ghostBtn,fontSize:10,padding:"3px 10px",marginTop:4}}
                  onClick={()=>setShowAlertConfig(v=>!v)}>
                  {showAlertConfig?"▲ Ocultar configuración":"⚙ Configurar umbrales"}
                </button>
              </div>
            );
          })()}

          {/* ── Configuración de umbrales ── */}
          {showAlertConfig && (
            <div style={{background:"#0d0d0d",border:`1px solid ${C.border}`,borderRadius:10,padding:"14px",marginBottom:16}}>
              <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:12}}>Umbrales de alerta</div>
              {[
                {key:"pctAprobadoMin", label:"% aprobado mínimo global", unit:"%", min:1, max:100},
                {key:"pctRechazoMax",  label:"% rechazos máx. por proveedor", unit:"%", min:1, max:100},
                {key:"incidenciasMax", label:"Incidencias máx. por proveedor/mes", unit:"", min:1, max:50},
                {key:"recsMax",        label:"Reclamaciones máx. por mes", unit:"", min:1, max:50},
              ].map(({key,label,unit,min,max})=>(
                <div key={key} style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <label style={{fontSize:11,color:C.textMuted}}>{label}</label>
                    <span style={{fontSize:13,fontWeight:700,color:C.gold}}>{alertConfig[key]}{unit}</span>
                  </div>
                  <input type="range" min={min} max={max} value={alertConfig[key]}
                    onChange={e=>setAlertConfig(a=>({...a,[key]:parseInt(e.target.value)}))}
                    style={{width:"100%",accentColor:C.gold}}/>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:9,color:"#3a3a3a"}}>{min}{unit}</span>
                    <span style={{fontSize:9,color:"#3a3a3a"}}>{max}{unit}</span>
                  </div>
                </div>
              ))}
              <button style={{...S.ghostBtn,fontSize:10,width:"100%",marginTop:4}}
                onClick={()=>setShowAlertConfig(false)}>
                ✓ Cerrar configuración
              </button>
            </div>
          )}

          {/* Selector de periodo */}
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:dirCustom?8:0}}>
              {[[7,"7d"],[14,"14d"],[30,"1m"],[60,"2m"],[90,"3m"],[0,"Todo"]].map(([d,l])=>{
                const active = !dirCustom && dirPeriod===d;
                return (
                  <button key={l} onClick={()=>{setDirCustom(false);setDirPeriod(d);}} style={{
                    padding:"6px 11px",borderRadius:5,cursor:"pointer",fontFamily:font,
                    fontSize:11,fontWeight:600,
                    background:active?C.gold:C.bg,
                    color:active?C.bg:C.textMuted,
                    border:active?`1px solid ${C.gold}`:`1px solid ${C.border}`,
                  }}>{l}</button>
                );
              })}
              <button onClick={()=>setDirCustom(true)} style={{
                padding:"6px 11px",borderRadius:5,cursor:"pointer",fontFamily:font,
                fontSize:11,fontWeight:600,
                background:dirCustom?C.gold:C.bg,
                color:dirCustom?C.bg:C.textMuted,
                border:dirCustom?`1px solid ${C.gold}`:`1px solid ${C.border}`,
              }}>Rango</button>
            </div>
            {dirCustom&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"end",gap:6,marginTop:8}}>
                <div>
                  <div style={{fontSize:9,color:C.textMuted,marginBottom:4,letterSpacing:"0.06em"}}>DESDE</div>
                  <input type="date" value={dirCustomFrom} onChange={e=>setDirCustomFrom(e.target.value)}
                    style={{...S.input,fontSize:12,boxSizing:"border-box",width:"100%",borderColor:dirCustomFrom?C.gold:C.border}}/>
                </div>
                <div style={{color:C.textMuted,fontSize:14,paddingBottom:10}}>→</div>
                <div>
                  <div style={{fontSize:9,color:C.textMuted,marginBottom:4,letterSpacing:"0.06em"}}>HASTA</div>
                  <input type="date" value={dirCustomTo} onChange={e=>setDirCustomTo(e.target.value)}
                    style={{...S.input,fontSize:12,boxSizing:"border-box",width:"100%",borderColor:dirCustomTo?C.gold:C.border}}/>
                </div>
              </div>
            )}
          </div>

          {/* Resumen ejecutivo */}
          <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>
            Resumen ejecutivo · {dirCustom&&dirCustomFrom ? `${dirCustomFrom} → ${dirCustomTo||"hoy"}` : dirPeriod===0?"Todo el historial":`Últimos ${dirPeriod} días`}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div style={{background:C.surface,borderRadius:10,padding:"14px",border:`1px solid ${pctThisMon!==null&&pctThisMon>=70?"#4ade8030":"#f8717130"}`,gridColumn:"1 / -1"}}>
              <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>% Material aprobado</div>
              <div style={{display:"flex",alignItems:"flex-end",gap:12,flexWrap:"wrap"}}>
                <div style={{fontSize:48,fontWeight:700,fontFamily:font,lineHeight:1,color:pctThisMon===null?C.textMuted:pctThisMon>=70?C.green:pctThisMon>=50?C.yellow:C.red}}>
                  {pctThisMon!==null?`${pctThisMon}%`:"—"}
                </div>
                <div>
                  {pctDiff!==null&&<div style={{fontSize:13,fontWeight:700,color:pctDiff>=0?C.green:C.red}}>{pctDiff>=0?`↑ +${pctDiff}%`:`↓ ${pctDiff}%`} vs mes anterior</div>}
                  <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{thisMon.length} controles · mes anterior {pctLastMon!==null?`${pctLastMon}%`:"—"}</div>
                </div>
              </div>
              {/* Mini bar */}
              {pctThisMon!==null&&(
                <div style={{marginTop:10,height:6,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
                  <div style={{width:`${pctThisMon}%`,height:"100%",borderRadius:3,background:pctThisMon>=70?C.green:pctThisMon>=50?C.yellow:C.red}}/>
                </div>
              )}
            </div>

            <KpiCard label="Controles este mes" value={thisMon.length}
              color={"#38bdf8"} sub={`${lastMon.length} el mes anterior`}/>
            <KpiCard label="Incidencias este mes" value={incidencias.length}
              color={incidencias.length===0?C.green:"#f97316"}
              sub={incidencias.length===0?"Todo aprobado":`${Math.round(incidencias.length/Math.max(thisMon.length,1)*100)}% del total`}/>
          </div>

          {/* Proveedor con más incidencias */}
          <div style={{background:C.surface,borderRadius:10,padding:"14px",border:`1px solid ${worstProv?"#f9731630":C.border}`,marginBottom:8}}>
            <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Proveedor más problemático · este mes</div>
            {worstProv ? (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:18,fontWeight:700,color:"#f97316"}}>{worstProv[0]}</div>
                  <div style={{fontSize:11,color:C.textMuted}}>{worstProv[1]} incidencia{worstProv[1]>1?"s":" "} este mes</div>
                </div>
                <button style={{...S.ghostBtn,fontSize:10}} onClick={()=>setScreen("stats")}>Ver stats →</button>
              </div>
            ) : <div style={{fontSize:14,fontWeight:700,color:C.green}}>Sin incidencias este mes ✓</div>}
          </div>

          {/* Reclamaciones */}
          <div style={{background:C.surface,borderRadius:10,padding:"14px",border:`1px solid ${recsThisMon.length>0?"#f8717130":C.border}`,marginBottom:20}}>
            <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Reclamaciones · este mes</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:28,fontWeight:700,fontFamily:font,color:recsThisMon.length>0?"#f87171":C.green,lineHeight:1}}>{recsThisMon.length}</div>
                {recsThisMon.length>0&&<div style={{fontSize:11,color:C.textMuted,marginTop:4}}>
                  {[...new Set(recsThisMon.map(r=>r.cliente).filter(Boolean))].slice(0,2).join(", ")}
                </div>}
              </div>
              {recsThisMon.length>0&&<button style={{...S.ghostBtn,fontSize:10}} onClick={()=>setScreen("reclamaciones")}>Ver todas →</button>}
            </div>
          </div>

          {/* Ranking proveedores últimos 3 meses */}
          <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>Ranking proveedores · últimos 3 meses</div>
          <div style={S.card}>
            {provRanking.map((r,i)=>(
              <div key={r.p} style={{display:"flex",alignItems:"center",gap:12,paddingBottom:i<provRanking.length-1?10:0,marginBottom:i<provRanking.length-1?10:0,borderBottom:i<provRanking.length-1?`1px solid ${C.border}`:"none"}}>
                <div style={{
                  width:24,height:24,borderRadius:"50%",flexShrink:0,
                  background:i===0?"#2a1f0a":i===1?"#1a1a1a":"#1a1a1a",
                  border:`1px solid ${i===0?C.gold:C.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,color:i===0?C.gold:C.textMuted,
                }}>{i+1}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:C.text}}>{r.p}</span>
                    <span style={{fontSize:13,fontWeight:700,color:r.pct>=70?C.green:r.pct>=50?C.yellow:C.red}}>{r.pct}%</span>
                  </div>
                  <div style={{height:5,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
                    <div style={{width:`${r.pct}%`,height:"100%",borderRadius:3,background:r.pct>=70?C.green:r.pct>=50?C.yellow:C.red}}/>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4}}>
                    <span style={{fontSize:9,color:C.textMuted}}>{r.total} controles</span>
                    {r.recs>0&&<span style={{fontSize:9,color:"#f87171"}}>⚠ {r.recs} reclamaciones</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Cuadro de mando de reclamaciones ── */}
          {(()=>{
            if (!reclamaciones.length) return (
              <div style={{marginTop:20,marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>Reclamaciones</div>
                <div style={{background:C.surface,borderRadius:10,padding:"16px",border:`1px solid ${C.border}`,textAlign:"center",color:C.textMuted,fontSize:13}}>
                  No hay reclamaciones registradas
                </div>
              </div>
            );

            const resueltas  = reclamaciones.filter(r=>r.solucion&&r.solucion!=="Pendiente");
            const pendientes = reclamaciones.filter(r=>!r.solucion||r.solucion==="Pendiente");
            const importeTotal = reclamaciones.reduce((s,r)=>s+(parseFloat(r.importe)||0),0);
            const importePend  = pendientes.reduce((s,r)=>s+(parseFloat(r.importe)||0),0);

            // Por proveedor
            const provRecs = {};
            reclamaciones.forEach(r=>{
              const ctrl = history.find(c=>c.id===r.ctrlId);
              const p = ctrl?.proveedor||"Sin proveedor";
              if (!provRecs[p]) provRecs[p] = {total:0, importe:0, motivos:{}};
              provRecs[p].total++;
              provRecs[p].importe += parseFloat(r.importe)||0;
              if (r.motivo) provRecs[p].motivos[r.motivo]=(provRecs[p].motivos[r.motivo]||0)+1;
            });
            const provRecsList = Object.entries(provRecs).sort((a,b)=>b[1].total-a[1].total);

            // Por motivo
            const motivoMap = {};
            reclamaciones.forEach(r=>{if(r.motivo) motivoMap[r.motivo]=(motivoMap[r.motivo]||0)+1;});
            const motivos = Object.entries(motivoMap).sort((a,b)=>b[1]-a[1]);

            // Tasa reclamación por proveedor (recs / controles)
            const allProvsList = [...new Set(history.map(c=>c.proveedor).filter(Boolean))];
            const tasas = allProvsList.map(p=>{
              const ctrl = history.filter(c=>c.proveedor===p).length;
              const recs = reclamaciones.filter(r=>history.find(c=>c.id===r.ctrlId&&c.proveedor===p)).length;
              return {p, ctrl, recs, tasa: ctrl?Math.round(recs/ctrl*100):0};
            }).sort((a,b)=>b.tasa-a.tasa);

            return (
              <div style={{marginTop:20,marginBottom:20}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>Cuadro de mando · Reclamaciones</div>

                {/* KPIs */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid #f8717130`}}>
                    <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Pendientes</div>
                    <div style={{fontSize:26,fontWeight:700,color:"#f87171",fontFamily:font,lineHeight:1}}>{pendientes.length}</div>
                    {importePend>0&&<div style={{fontSize:10,color:"#f87171",marginTop:4}}>{importePend.toFixed(2)} € en juego</div>}
                  </div>
                  <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid #4ade8030`}}>
                    <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Resueltas</div>
                    <div style={{fontSize:26,fontWeight:700,color:C.green,fontFamily:font,lineHeight:1}}>{resueltas.length}</div>
                    <div style={{fontSize:10,color:C.textMuted,marginTop:4}}>{reclamaciones.length} total</div>
                  </div>
                  {importeTotal>0&&(
                    <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,gridColumn:"1 / -1"}}>
                      <div style={{fontSize:9,color:C.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Importe total reclamado</div>
                      <div style={{fontSize:24,fontWeight:700,color:C.text,fontFamily:font}}>{importeTotal.toFixed(2)} €</div>
                    </div>
                  )}
                </div>

                {/* Por motivo */}
                {motivos.length>0&&(
                  <div style={{...S.card,marginBottom:10}}>
                    <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textMuted,marginBottom:8}}>Por motivo</div>
                    {motivos.map(([m,n],i)=>(
                      <div key={m} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<motivos.length-1?6:0}}>
                        <span style={{fontSize:12,color:C.textDim,minWidth:90}}>{m}</span>
                        <div style={{flex:1,height:5,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
                          <div style={{width:`${Math.round(n/reclamaciones.length*100)}%`,height:"100%",background:"#f87171",borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,fontWeight:700,color:"#f87171",minWidth:16,textAlign:"right"}}>{n}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasa por proveedor */}
                <div style={S.card}>
                  <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textMuted,marginBottom:8}}>Tasa de reclamación por proveedor</div>
                  {tasas.map((r,i)=>(
                    <div key={r.p} style={{marginBottom:i<tasas.length-1?10:0,paddingBottom:i<tasas.length-1?10:0,borderBottom:i<tasas.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:12,fontWeight:600,color:C.textDim}}>{r.p}</span>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:10,color:C.textMuted}}>{r.recs} rec. / {r.ctrl} ctrl.</span>
                          <span style={{fontSize:11,fontWeight:700,color:r.tasa===0?C.green:r.tasa<=5?"#fbbf24":"#f87171"}}>{r.tasa}%</span>
                        </div>
                      </div>
                      <div style={{height:5,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
                        <div style={{width:`${Math.min(r.tasa*3,100)}%`,height:"100%",borderRadius:3,background:r.tasa===0?C.green:r.tasa<=5?"#fbbf24":"#f87171"}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Trazabilidad ── */}
          <div style={{marginTop:20,marginBottom:20}}>
            <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>Trazabilidad · lote, proveedor, color...</div>
            <div style={{position:"relative",marginBottom:10}}>
              <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,color:C.textMuted,pointerEvents:"none"}}>🔍</span>
              <input style={{...S.input,paddingLeft:32,fontSize:13}}
                placeholder="Buscar por lote, proveedor, color, serie..."
                value={trazQuery}
                onChange={e=>setTrazQuery(e.target.value)}/>
              {trazQuery&&<button onClick={()=>setTrazQuery("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,padding:0}}>✕</button>}
            </div>
            {trazQuery.trim() && (()=>{
              const q = trazQuery.trim().toLowerCase();
              const matches = history.filter(c=>{
                const color = colors.find(x=>x.id===c.colorId);
                const fmt   = formats.find(x=>x.id===c.formatId);
                const hay   = [
                  c.lote, c.proveedor, c.referencia,
                  color?.color, color?.abbr, color?.serie,
                  fmt?.label,
                ].filter(Boolean).join(" ").toLowerCase();
                return hay.includes(q);
              });
              if (!matches.length) return (
                <div style={{textAlign:"center",color:C.textMuted,fontSize:13,padding:"20px 0"}}>No se encontró ningún lote</div>
              );
              return matches.map(ctrl=>{
                const fmt   = formats.find(f=>f.id===ctrl.formatId);
                const color = colors.find(c=>c.id===ctrl.colorId);
                const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
                const recs  = reclamaciones.filter(r=>r.ctrlId===ctrl.id);
                const vc    = verdictColor(ctrl.verdict);
                return (
                  <div key={ctrl.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:10,overflow:"hidden"}}>
                    {/* Header */}
                    <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:C.text}}>{ctrl.lote}</div>
                        <div style={{fontSize:11,color:C.textMuted}}>{color?`${color.abbr} ${color.color}`:"—"} · {fmtCm} · {ctrl.colorUso}</div>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,color:vc,background:`${vc}18`,padding:"3px 9px",borderRadius:5}}>{ctrl.verdict||"—"}</span>
                    </div>
                    {/* Timeline */}
                    <div style={{padding:"12px 14px"}}>
                      {/* Paso 1: Lote creado */}
                      <div style={{display:"flex",gap:12,marginBottom:10}}>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:0}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:C.gold,flexShrink:0,marginTop:2}}/>
                          <div style={{width:1,flex:1,background:C.border,marginTop:2}}/>
                        </div>
                        <div style={{flex:1,paddingBottom:10}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.text}}>Lote creado</div>
                          <div style={{fontSize:10,color:C.textMuted}}>{formatDate(ctrl.date)} · {ctrl.proveedor||"Sin proveedor"}</div>
                          {ctrl.referencia&&<div style={{fontSize:10,color:C.textMuted}}>Ref: {ctrl.referencia}</div>}
                        </div>
                      </div>
                      {/* Paso 2: Inspección */}
                      <div style={{display:"flex",gap:12,marginBottom:10}}>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:ctrl.tiles?.some(t=>t.tone)?C.green:"#3a3a3a",flexShrink:0,marginTop:2}}/>
                          <div style={{width:1,flex:1,background:C.border,marginTop:2}}/>
                        </div>
                        <div style={{flex:1,paddingBottom:10}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.text}}>Inspección visual</div>
                          <div style={{fontSize:10,color:C.textMuted}}>{ctrl.tiles?.length||0} baldosa{ctrl.tiles?.length!==1?"s":""}</div>
                          <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                            {[...new Set(ctrl.tiles?.map(t=>t.tone).filter(Boolean))].map(t=>(
                              <span key={t} style={{fontSize:9,color:t==="T55"?C.green:C.yellow,background:t==="T55"?"rgba(74,222,128,0.12)":"rgba(251,191,36,0.12)",padding:"1px 5px",borderRadius:3}}>{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Paso 3: Laboratorio */}
                      <div style={{display:"flex",gap:12,marginBottom:recs.length?10:0}}>
                        <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:ctrl.labDone?C.green:"#3a3a3a",flexShrink:0,marginTop:2}}/>
                          {recs.length>0&&<div style={{width:1,flex:1,background:C.border,marginTop:2}}/>}
                        </div>
                        <div style={{flex:1,paddingBottom:recs.length?10:0}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.text}}>
                            Laboratorio {!ctrl.labDone&&<span style={{fontSize:9,color:"#a855f7",background:"#1a0a2a",padding:"1px 6px",borderRadius:3,marginLeft:4}}>Pendiente</span>}
                          </div>
                          {ctrl.labDone&&<>
                            <div style={{fontSize:10,color:C.textMuted}}>Espesor: {ctrl.labEspesor||"—"} mm</div>
                            <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                              {ctrl.tiles?.filter(t=>t.rd).map((t,i)=>{
                                const info = getRdInfo(t.rd, ctrl.colorUso);
                                return <span key={i} style={{fontSize:9,color:info?info.color:C.textMuted,background:info?info.bg:"transparent",padding:"1px 5px",borderRadius:3}}>B{i+1}: {t.rd}</span>;
                              })}
                            </div>
                          </>}
                        </div>
                      </div>
                      {/* Paso 4: Reclamaciones */}
                      {recs.map((rec,ri)=>(
                        <div key={rec.id} style={{display:"flex",gap:12}}>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                            <div style={{width:10,height:10,borderRadius:"50%",background:"#f87171",flexShrink:0,marginTop:2}}/>
                            {ri<recs.length-1&&<div style={{width:1,flex:1,background:C.border,marginTop:2}}/>}
                          </div>
                          <div style={{flex:1,paddingBottom:ri<recs.length-1?10:0}}>
                            <div style={{fontSize:11,fontWeight:700,color:"#f87171"}}>Reclamación</div>
                            <div style={{fontSize:10,color:C.textMuted}}>{rec.fecha} · {rec.cliente||"Sin cliente"}</div>
                            {rec.motivo&&<div style={{fontSize:10,color:C.textMuted}}>Motivo: {rec.motivo}</div>}
                            {rec.solucion&&<div style={{fontSize:10,color:C.green}}>Solución: {rec.solucion}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* ── Evolución proveedores ── */}
          {(()=>{
            // Last 4 months
            const months = [];
            for (let i=5; i>=0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
              const end = new Date(now.getFullYear(), now.getMonth()-i+1, 0, 23, 59, 59);
              const label = d.toLocaleString("es",{month:"short"});
              months.push({label, start:d, end});
            }

            const allProvs = [...new Set(history.map(c=>c.proveedor).filter(Boolean))].sort();

            // For each provider, compute % aprobado per month
            const provEvol = allProvs.map(p=>{
              const monthly = months.map(m=>{
                const items = history.filter(c=>c.proveedor===p&&new Date(c.date)>=m.start&&new Date(c.date)<=m.end);
                if (!items.length) return null;
                return Math.round(items.filter(c=>c.verdict==="APROBADO").length/items.length*100);
              });
              // Only include if has data in at least 2 months
              const hasData = monthly.filter(v=>v!==null).length >= 1;
              if (!hasData) return null;
              // Trend: compare last month vs first month with data
              const vals = monthly.filter(v=>v!==null);
              const trend = vals.length>=2 ? vals[vals.length-1]-vals[0] : null;
              return {p, monthly, trend};
            }).filter(Boolean);

            if (!provEvol.length) return null;
            const BAR_H = 48;

            return (
              <div style={{marginTop:20}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:C.textMuted,marginBottom:10}}>Evolución · últimos 6 meses</div>
                <div style={S.card}>
                  {provEvol.map((r,pi)=>(
                    <div key={r.p} style={{marginBottom:pi<provEvol.length-1?16:0,paddingBottom:pi<provEvol.length-1?16:0,borderBottom:pi<provEvol.length-1?`1px solid ${C.border}`:"none"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:13,fontWeight:700,color:C.text}}>{r.p}</span>
                        {r.trend!==null&&(
                          <span style={{fontSize:11,fontWeight:700,color:r.trend>=0?C.green:C.red}}>
                            {r.trend>=0?`↑ +${r.trend}%`:`↓ ${r.trend}%`}
                          </span>
                        )}
                      </div>
                      {/* Bar chart */}
                      <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
                        {months.map((m,mi)=>{
                          const val = r.monthly[mi];
                          const barH = val!==null ? Math.max(Math.round(val/100*BAR_H),3) : 0;
                          const color = val===null?"#1a1a1a":val>=70?C.green:val>=50?C.yellow:C.red;
                          return (
                            <div key={mi} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                              <span style={{fontSize:9,fontWeight:700,color:val===null?C.textMuted:color}}>
                                {val!==null?`${val}%`:"—"}
                              </span>
                              <div style={{width:"100%",height:BAR_H,display:"flex",alignItems:"flex-end",background:"#0d0d0d",borderRadius:4,overflow:"hidden"}}>
                                <div style={{width:"100%",height:barH,background:color,borderRadius:"2px 2px 0 0",transition:"height 0.3s"}}/>
                              </div>
                              <span style={{fontSize:9,color:C.textMuted}}>{m.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    );
  }

  // ── EXPORT ────────────────────────────────────────────────────────
  if (screen === "stats" && exportScreen) {
    // data is computed in stats — recompute here with same logic
    const now2 = new Date();
    let fromDate2, toDate2 = now2;
    if (statsCustom && statsFrom) {
      fromDate2 = new Date(statsFrom);
      toDate2   = statsTo ? new Date(statsTo+"T23:59:59") : now2;
    } else {
      const days = statsPeriod===0?36500:statsPeriod*30;
      fromDate2 = new Date(now2-days*86400000);
    }
    const exportData = history
      .filter(c=>{const d=new Date(c.date);return d>=fromDate2&&d<=toDate2;})
      .sort((a,b)=>new Date(b.date)-new Date(a.date));

    const generatePDF = () => {
      const selected = exportData.filter(c=>exportIds.has(c.id));
      if (!selected.length) return;

      const verdictColor2 = v => v==="APROBADO"?"#16a34a":v==="RECHAZADO"?"#dc2626":v==="MAL TONO"?"#ca8a04":"#ea580c";

      const rows = selected.map(ctrl=>{
        const fmt   = formats.find(f=>f.id===ctrl.formatId);
        const color = colors.find(c=>c.id===ctrl.colorId);
        const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
        const grosor = getGrosor(ctrl);
        const tones = ctrl.tiles.map(t=>t.tone).filter(Boolean).join(", ")||"—";
        const plans = ctrl.tiles.map(t=>t.planimetria==="otro"?t.planimetriaCustom:t.planimetria).filter(Boolean).join(", ")||"—";
        const rds   = ctrl.tiles.map(t=>t.rd).filter(Boolean).join(", ")||"—";
        const recs  = reclamaciones.filter(r=>r.ctrlId===ctrl.id);
        return `
          <tr>
            <td>${formatDate(ctrl.date)}</td>
            <td>${ctrl.proveedor||"—"}</td>
            <td>${ctrl.lote||"—"}</td>
            <td>${color?`${color.abbr} ${color.color}`:"—"}</td>
            <td>${fmtCm}${grosor===20?" 2cm":""}</td>
            <td>${ctrl.colorUso||"—"}</td>
            <td>${tones}</td>
            <td>${plans}</td>
            <td>${ctrl.labEspesor||"—"}</td>
            <td>${rds}</td>
            <td style="color:${verdictColor2(ctrl.verdict)};font-weight:700">${ctrl.verdict||"—"}</td>
            <td>${recs.length>0?`⚠ ${recs.length}`:""}</td>
          </tr>`;
      }).join("");

      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>CeraCheck — Exportación</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}
  h1{font-size:18px;margin-bottom:4px}
  .sub{color:#666;font-size:11px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#1a1a1a;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:0.05em}
  td{padding:6px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}
  tr:nth-child(even) td{background:#f9f9f9}
  .badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700}
</style>
</head><body>
<h1>CeraCheck — Control de Calidad</h1>
<div class="sub">Exportado el ${formatDate(new Date())} · ${selected.length} controles</div>
<table>
  <thead><tr>
    <th>Fecha</th><th>Proveedor</th><th>Lote</th><th>Color</th>
    <th>Formato</th><th>Uso</th><th>Tono</th><th>Planimetría</th>
    <th>Esp. Lab</th><th>RD</th><th>Veredicto</th><th>Rec.</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;

      const blob = new Blob([html],{type:"text/html"});
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href=url; a.download=`ceracheck-export-${new Date().toISOString().slice(0,10)}.html`;
      a.click(); URL.revokeObjectURL(url);
    };

    const allSelected = exportData.every(c=>exportIds.has(c.id));
    const exportFiltered = exportQ.trim()
      ? exportData.filter(c=>{
          const color = colors.find(x=>x.id===c.colorId);
          const fmt   = formats.find(x=>x.id===c.formatId);
          const hay   = [c.lote,c.proveedor,c.referencia,color?.color,color?.abbr,color?.serie,fmt?.label].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(exportQ.toLowerCase().trim());
        })
      : exportData;

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setExportScreen(false)}>← Cancelar</button>
          <span style={S.headerTitle}>Exportar</span>
          <span style={{fontSize:11,color:C.textMuted}}>{exportIds.size} sel.</span>
        </div>
        <div style={S.page}>

          {/* Search */}
          <div style={{position:"relative",marginBottom:10}}>
            <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,color:C.textMuted,pointerEvents:"none"}}>🔍</span>
            <input style={{...S.input,paddingLeft:32,fontSize:13}}
              placeholder="Buscar por lote, proveedor, color..."
              value={exportQ} onChange={e=>setExportQ(e.target.value)}/>
            {exportQ&&<button onClick={()=>setExportQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,padding:0}}>✕</button>}
          </div>

          {/* Select all + generate */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <button style={{...S.secondaryBtn,flex:1}} onClick={()=>
              setExportIds(allSelected?new Set():new Set(exportData.map(c=>c.id)))}>
              {allSelected?"Deseleccionar todos":"Seleccionar todos"}
            </button>
            <button style={{...S.primaryBtn,flex:1,opacity:exportIds.size?1:0.4}}
              disabled={!exportIds.size} onClick={generatePDF}>
              ↓ Generar ({exportIds.size})
            </button>
          </div>

          {/* List of controls to select */}
          {exportFiltered.map(ctrl=>{
            const fmt   = formats.find(f=>f.id===ctrl.formatId);
            const color = colors.find(c=>c.id===ctrl.colorId);
            const fmtCm = fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"—";
            const sel   = exportIds.has(ctrl.id);
            const vc    = verdictColor(ctrl.verdict);
            return (
              <div key={ctrl.id} onClick={()=>setExportIds(s=>{const n=new Set(s);sel?n.delete(ctrl.id):n.add(ctrl.id);return n;})}
                style={{
                  background:sel?`${C.gold}10`:C.surface,
                  border:`1px solid ${sel?C.gold:C.border}`,
                  borderRadius:8,padding:"11px 14px",marginBottom:7,
                  cursor:"pointer",display:"flex",alignItems:"center",gap:12,
                }}>
                <div style={{
                  width:20,height:20,borderRadius:4,flexShrink:0,
                  border:`2px solid ${sel?C.gold:C.border}`,
                  background:sel?C.gold:"transparent",
                  display:"flex",alignItems:"center",justifyContent:"center",
                }}>
                  {sel&&<span style={{color:C.bg,fontSize:12,fontWeight:700}}>✓</span>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:10,color:C.textMuted,marginBottom:2}}>{formatDate(ctrl.date)} · {ctrl.proveedor||"—"}</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {color?`${color.abbr} ${color.color}`:"—"} · {fmtCm} · {ctrl.lote||"—"}
                  </div>
                </div>
                <span style={{fontSize:9,fontWeight:700,color:vc,background:`${vc}18`,padding:"2px 7px",borderRadius:4,flexShrink:0}}>
                  {ctrl.verdict||"—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── STATS ─────────────────────────────────────────────────────────
  if (screen === "stats") {
    const now = new Date();

    // Compute filter range
    let fromDate, toDate = now;
    if (statsCustom && statsFrom) {
      fromDate = new Date(statsFrom);
      toDate   = statsTo ? new Date(statsTo + "T23:59:59") : now;
    } else {
      const days = statsPeriod === 0 ? 36500 : statsPeriod * 30;
      fromDate = new Date(now - days * 86400000);
    }

    const data = history.filter(c => {
      const d = new Date(c.date);
      return d >= fromDate && d <= toDate;
    });
    const total = data.length;

    const byVerdict = v => data.filter(c=>c.verdict===v).length;
    const pct = n => total ? Math.round(n/total*100) : 0;

    const proveedores = [...new Set(data.map(c=>c.proveedor).filter(Boolean))].sort();
    const provStats = proveedores.map(p=>{
      const items = data.filter(c=>c.proveedor===p);
      const ok = items.filter(c=>c.verdict==="APROBADO").length;
      const bad = items.filter(c=>c.verdict==="RECHAZADO").length;
      const tone = items.filter(c=>c.verdict==="MAL TONO").length;
      const dob = items.filter(c=>c.verdict==="DOBLADO").length;
      const rdFor = uso => {
        const vals = items.filter(c=>c.labDone&&c.colorUso===uso).flatMap(c=>
          c.tiles.map(t=>({rd:parseFloat(t.rd),uso})).filter(x=>!isNaN(x.rd))
        );
        const rdOk  = vals.filter(x=>getRdStatus(x.rd,uso)==="ok").length;
        const rdBad = vals.filter(x=>getRdStatus(x.rd,uso)==="reject").length;
        const rdAvg = vals.length?Math.round(vals.reduce((s,x)=>s+x.rd,0)/vals.length*10)/10:null;
        return {rdOk, rdBad, rdAvg, rdTotal:vals.length};
      };
      const recs = reclamaciones.filter(r=>items.some(c=>c.id===r.ctrlId)).length;
      return {p, total:items.length, ok, bad, tone, dob,
              pctOk:items.length?Math.round(ok/items.length*100):0,
              recs, rdOut:rdFor("OUT"), rdIn:rdFor("IN")};
    }).sort((a,b)=>b.total-a.total);

    const series = [...new Set(data.map(c=>colors.find(x=>x.id===c.colorId)?.serie).filter(Boolean))].sort();
    const serieStats = series.map(s=>{
      const items = data.filter(c=>colors.find(x=>x.id===c.colorId)?.serie===s);
      const ok = items.filter(c=>c.verdict==="APROBADO").length;
      const bad = items.filter(c=>c.verdict==="RECHAZADO").length;
      const tone = items.filter(c=>c.verdict==="MAL TONO").length;
      const dob = items.filter(c=>c.verdict==="DOBLADO").length;
      const recs = reclamaciones.filter(r=>items.some(c=>c.id===r.ctrlId)).length;
      return {s, total:items.length, ok, bad, tone, dob, recs, pctOk:items.length?Math.round(ok/items.length*100):0};
    }).sort((a,b)=>b.total-a.total);

    const fmtIds = [...new Set(data.map(c=>c.formatId).filter(Boolean))];
    const fmtStats = fmtIds.map(id=>{
      const fmt = formats.find(f=>f.id===id);
      const items = data.filter(c=>c.formatId===id);
      const ok = items.filter(c=>c.verdict==="APROBADO").length;
      const bad = items.filter(c=>c.verdict==="RECHAZADO").length;
      const tone = items.filter(c=>c.verdict==="MAL TONO").length;
      const dob = items.filter(c=>c.verdict==="DOBLADO").length;
      const recs = reclamaciones.filter(r=>items.some(c=>c.id===r.ctrlId)).length;
      return {label:fmt?`${fmt.ancho/10}×${fmt.largo/10}`:"?", total:items.length, ok, bad, tone, dob, recs, pctOk:items.length?Math.round(ok/items.length*100):0};
    }).sort((a,b)=>b.total-a.total);

    const weeklyMap = {};
    data.forEach(c=>{
      const d = new Date(c.date);
      const wk = `${d.getFullYear()}-W${String(Math.ceil((d.getDate()+(new Date(d.getFullYear(),d.getMonth(),1).getDay()))/7)).padStart(2,"0")}`;
      if(!weeklyMap[wk]) weeklyMap[wk]={wk,ok:0,total:0};
      weeklyMap[wk].total++;
      if(c.verdict==="APROBADO") weeklyMap[wk].ok++;
    });
    const weeks = Object.values(weeklyMap).sort((a,b)=>a.wk.localeCompare(b.wk)).slice(-12);
    const maxW = Math.max(...weeks.map(w=>w.total),1);

    const StatCard = ({label,value,color,sub}) => (
      <div style={{background:C.surface,border:`1px solid ${color}30`,borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
        <div style={{fontSize:26,fontWeight:700,color,fontFamily:font}}>{value}</div>
        <div style={{fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",color:C.textMuted,marginTop:2}}>{label}</div>
        {sub&&<div style={{fontSize:10,color,marginTop:3}}>{sub}</div>}
      </div>
    );

    const Bar = ({pctOk}) => (
      <div style={{display:"flex",alignItems:"center",gap:6,flex:1}}>
        <div style={{flex:1,height:6,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
          <div style={{width:`${pctOk}%`,height:"100%",background:C.green,borderRadius:3}}/>
        </div>
        <span style={{fontSize:10,color:C.textMuted,minWidth:28,textAlign:"right"}}>{pctOk}%</span>
      </div>
    );

    const TableSection = ({title,rows,labelFn}) => (
      <div style={{marginBottom:20}}>
        <div style={S.sectionTitle}>{title}</div>
        <div style={S.card}>
          {rows.map((r,i)=>(
            <div key={i} style={{paddingBottom:i<rows.length-1?10:0,marginBottom:i<rows.length-1?10:0,borderBottom:i<rows.length-1?`1px solid ${C.border}`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:C.textDim}}>{labelFn(r)}</span>
                <span style={{fontSize:10,color:C.textMuted}}>{r.total}</span>
              </div>
              <Bar pctOk={r.pctOk}/>
              <div style={{display:"flex",gap:6,marginTop:4}}>
                {[["✓",r.ok,C.green],["T",r.tone,C.yellow],["D",r.dob,"#f97316"],["✗",r.bad,C.red]].map(([l,n,c])=>
                  n>0&&<span key={l} style={{fontSize:9,color:c,background:`${c}18`,padding:"1px 5px",borderRadius:3}}>{l} {n}</span>
                )}
                {r.recs>0&&<span style={{fontSize:9,color:"#f87171",background:"rgba(248,113,113,0.12)",padding:"1px 5px",borderRadius:3}}>⚠ {r.recs}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );

    const PRESETS = [
      {label:"1 sem", days:7/30},
      {label:"1 mes", days:1},
      {label:"3 m",   days:3},
      {label:"6 m",   days:6},
      {label:"1 año", days:12},
      {label:"Todo",  days:0},
    ];

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>setScreen("home")}>← Volver</button>
          <span style={S.headerTitle}>Estadísticas</span>
          {total>0&&<button style={{...S.ghostBtn,fontSize:10,padding:"4px 10px",color:C.gold,borderColor:`${C.gold}60`}}
            onClick={()=>{setExportIds(new Set(data.map(c=>c.id)));setExportScreen(true);}}>
            ↓ Exportar
          </button>}
        </div>
        <div style={S.page}>

          {/* Predefined period chips */}
          <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
            {PRESETS.map(({label,days})=>{
              const active = !statsCustom && statsPeriod===(days||0);
              return (
                <button key={label} onClick={()=>{setStatsCustom(false);setStatsPeriod(days||0);}} style={{
                  padding:"6px 10px",borderRadius:5,cursor:"pointer",fontFamily:font,
                  fontSize:11,fontWeight:600,
                  background:active?C.gold:C.bg,
                  color:active?C.bg:C.textMuted,
                  border:active?`1px solid ${C.gold}`:`1px solid ${C.border}`,
                }}>{label}</button>
              );
            })}
            <button onClick={()=>setStatsCustom(true)} style={{
              padding:"6px 10px",borderRadius:5,cursor:"pointer",fontFamily:font,
              fontSize:11,fontWeight:600,
              background:statsCustom?C.gold:C.bg,
              color:statsCustom?C.bg:C.textMuted,
              border:statsCustom?`1px solid ${C.gold}`:`1px solid ${C.border}`,
            }}>Rango</button>
          </div>

          {/* Custom date range */}
          {statsCustom && (
            <div style={{marginBottom:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:8}}>
                <div style={{background:"#0d0d0d",border:`1px solid ${statsFrom?C.gold:C.border}`,borderRadius:10,padding:"12px 12px 10px"}}>
                  <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:statsFrom?C.gold:C.textMuted,marginBottom:6}}>Desde</div>
                  <input type="date" value={statsFrom} onChange={e=>setStatsFrom(e.target.value)}
                    style={{background:"none",border:"none",color:C.text,fontFamily:font,fontSize:13,fontWeight:600,width:"100%",outline:"none",padding:0}}/>
                </div>
                <div style={{color:C.textMuted,fontSize:16,textAlign:"center"}}>→</div>
                <div style={{background:"#0d0d0d",border:`1px solid ${statsTo?C.gold:C.border}`,borderRadius:10,padding:"12px 12px 10px"}}>
                  <div style={{fontSize:9,letterSpacing:"0.12em",textTransform:"uppercase",color:statsTo?C.gold:C.textMuted,marginBottom:6}}>Hasta</div>
                  <input type="date" value={statsTo} onChange={e=>setStatsTo(e.target.value)}
                    style={{background:"none",border:"none",color:C.text,fontFamily:font,fontSize:13,fontWeight:600,width:"100%",outline:"none",padding:0}}/>
                </div>
              </div>
              {(statsFrom||statsTo) && (
                <button onClick={()=>{setStatsFrom("");setStatsTo("");}}
                  style={{marginTop:8,background:"none",border:"none",color:C.textMuted,fontSize:10,cursor:"pointer",fontFamily:font,padding:0,letterSpacing:"0.06em"}}>
                  ✕ Limpiar fechas
                </button>
              )}
            </div>
          )}

          {total===0 ? (
            <div style={{textAlign:"center",color:C.textMuted,padding:"40px 0",fontSize:13}}>
              Sin datos en este periodo
            </div>
          ) : (<>

          {/* Summary cards */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
            <StatCard label="Aprobado"  value={byVerdict("APROBADO")}  color={C.green}  sub={`${pct(byVerdict("APROBADO"))}%`}/>
            <StatCard label="Mal tono"  value={byVerdict("MAL TONO")}  color={C.yellow} sub={`${pct(byVerdict("MAL TONO"))}%`}/>
            <StatCard label="Doblado"   value={byVerdict("DOBLADO")}   color="#f97316"  sub={`${pct(byVerdict("DOBLADO"))}%`}/>
            <StatCard label="Rechazado" value={byVerdict("RECHAZADO")} color={C.red}    sub={`${pct(byVerdict("RECHAZADO"))}%`}/>
          </div>
          {reclamaciones.length>0 && (
            <div style={{
              background:"#0d0505",border:"1px solid #f8717130",borderRadius:8,
              padding:"12px 14px",marginBottom:16,
              display:"flex",justifyContent:"space-between",alignItems:"center",
            }}>
              <div>
                <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:"#f87171",marginBottom:3}}>Reclamaciones</div>
                <div style={{fontSize:11,color:C.textMuted}}>en el periodo seleccionado</div>
              </div>
              <div style={{fontSize:28,fontWeight:700,color:"#f87171",fontFamily:font}}>
                {reclamaciones.filter(r=>data.some(c=>c.id===r.ctrlId)).length}
              </div>
            </div>
          )}

          {/* Por proveedor — con RD */}
          <div style={{marginBottom:20}}>
            <div style={S.sectionTitle}>Por proveedor</div>
            <div style={S.card}>
              {provStats.map((r,i)=>{
                const expanded = expandedProv===r.p;
                const hasRd = r.rdOut.rdTotal>0||r.rdIn.rdTotal>0;
                const RdBlock = ({rd, uso}) => rd.rdTotal===0 ? null : (
                  <div style={{marginBottom:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{
                        fontSize:9,fontWeight:700,letterSpacing:"0.08em",
                        color:uso==="OUT"?"#f59e0b":"#38bdf8",
                        background:uso==="OUT"?"#2a1f0a":"#0a1f2a",
                        padding:"1px 6px",borderRadius:3,
                      }}>{uso}</span>
                      <div style={{display:"flex",gap:6}}>
                        {rd.rdOk>0&&<span style={{fontSize:9,color:C.green,background:"rgba(74,222,128,0.12)",padding:"1px 5px",borderRadius:3}}>✓ {rd.rdOk}</span>}
                        {rd.rdBad>0&&<span style={{fontSize:9,color:C.red,background:"rgba(248,113,113,0.12)",padding:"1px 5px",borderRadius:3}}>✗ {rd.rdBad}</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{flex:1,height:5,borderRadius:3,background:"#1a1a1a",overflow:"hidden"}}>
                            <div style={{width:`${Math.round(rd.rdOk/rd.rdTotal*100)}%`,height:"100%",background:C.green,borderRadius:3}}/>
                          </div>
                          <span style={{fontSize:10,color:C.textMuted,minWidth:28,textAlign:"right"}}>{Math.round(rd.rdOk/rd.rdTotal*100)}%</span>
                        </div>
                      </div>
                      {rd.rdAvg!==null&&(()=>{
                        const avgInfo = getRdInfo(rd.rdAvg, uso);
                        return (
                          <div style={{textAlign:"center",flexShrink:0,minWidth:56,background:avgInfo?.bg||"transparent",borderRadius:5,padding:"5px 8px"}}>
                            <div style={{fontSize:20,fontWeight:700,color:avgInfo?avgInfo.color:(rd.rdBad>0?C.red:C.green),fontFamily:font}}>{rd.rdAvg}</div>
                            <div style={{fontSize:8,color:avgInfo?avgInfo.color:C.textMuted,fontWeight:600}}>{avgInfo?.label||"media"}</div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
                return (
                  <div key={i} style={{paddingBottom:i<provStats.length-1?12:0,marginBottom:i<provStats.length-1?12:0,borderBottom:i<provStats.length-1?`1px solid ${C.border}`:"none"}}>
                    {/* Header — clickable */}
                    <div onClick={()=>setExpandedProv(expanded?null:r.p)} style={{cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:13,fontWeight:700,color:C.text}}>{r.p}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:10,color:C.textMuted}}>{r.total}</span>
                          {hasRd&&<span style={{fontSize:10,color:C.textMuted}}>{expanded?"▲":"▼"}</span>}
                        </div>
                      </div>
                      <Bar pctOk={r.pctOk}/>
                      <div style={{display:"flex",gap:6,marginTop:4}}>
                        {[["✓",r.ok,C.green],["T",r.tone,C.yellow],["D",r.dob,"#f97316"],["✗",r.bad,C.red]].map(([l,n,c])=>
                          n>0&&<span key={l} style={{fontSize:9,color:c,background:`${c}18`,padding:"1px 5px",borderRadius:3}}>{l} {n}</span>
                        )}
                        {r.recs>0&&<span style={{fontSize:9,color:"#f87171",background:"rgba(248,113,113,0.12)",padding:"1px 5px",borderRadius:3}}>⚠ {r.recs}</span>}
                      </div>
                    </div>
                    {/* Expanded RD */}
                    {expanded && hasRd && (
                      <div style={{background:"#0d0d0d",border:`1px solid ${C.border}`,borderRadius:6,padding:"10px 12px",marginTop:8}}>
                        <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textMuted,marginBottom:8}}>Laboratorio · RD</div>
                        <RdBlock rd={r.rdOut} uso="OUT"/>
                        {r.rdOut.rdTotal>0&&r.rdIn.rdTotal>0&&<div style={{borderTop:`1px solid ${C.border}`,margin:"8px 0"}}/>}
                        <RdBlock rd={r.rdIn} uso="IN"/>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Por serie — expandible con colores */}
          <div style={{marginBottom:20}}>
            <div style={S.sectionTitle}>Por serie</div>
            <div style={S.card}>
              {serieStats.map((r,i)=>{
                const expanded = expandedSerie===r.s;
                // Colors within this serie
                const serieColors = colors.filter(x=>x.serie===r.s);
                const colorRows = serieColors.map(col=>{
                  const items = data.filter(c=>c.colorId===col.id);
                  if (!items.length) return null;
                  const ok   = items.filter(c=>c.verdict==="APROBADO").length;
                  const bad  = items.filter(c=>c.verdict==="RECHAZADO").length;
                  const tone = items.filter(c=>c.verdict==="MAL TONO").length;
                  const dob  = items.filter(c=>c.verdict==="DOBLADO").length;
                  const recs = reclamaciones.filter(rec=>items.some(c=>c.id===rec.ctrlId)).length;
                  const pctOk = Math.round(ok/items.length*100);
                  return {color:col.color, total:items.length, ok, bad, tone, dob, recs, pctOk};
                }).filter(Boolean).sort((a,b)=>b.total-a.total);

                return (
                  <div key={i} style={{paddingBottom:i<serieStats.length-1?12:0,marginBottom:i<serieStats.length-1?12:0,borderBottom:i<serieStats.length-1?`1px solid ${C.border}`:"none"}}>
                    {/* Header row — clickable */}
                    <div onClick={()=>setExpandedSerie(expanded?null:r.s)} style={{cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:13,fontWeight:700,color:C.text}}>{r.s}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:10,color:C.textMuted}}>{r.total}</span>
                          <span style={{fontSize:10,color:C.textMuted}}>{expanded?"▲":"▼"}</span>
                        </div>
                      </div>
                      <Bar pctOk={r.pctOk}/>
                      <div style={{display:"flex",gap:6,marginTop:4}}>
                        {[["✓",r.ok,C.green],["T",r.tone,C.yellow],["D",r.dob,"#f97316"],["✗",r.bad,C.red]].map(([l,n,c])=>
                          n>0&&<span key={l} style={{fontSize:9,color:c,background:`${c}18`,padding:"1px 5px",borderRadius:3}}>{l} {n}</span>
                        )}
                        {r.recs>0&&<span style={{fontSize:9,color:"#f87171",background:"rgba(248,113,113,0.12)",padding:"1px 5px",borderRadius:3}}>⚠ {r.recs}</span>}
                      </div>
                    </div>

                    {/* Expanded — color breakdown */}
                    {expanded && colorRows.length>0 && (
                      <div style={{background:"#0d0d0d",border:`1px solid ${C.border}`,borderRadius:6,padding:"10px 12px",marginTop:8}}>
                        <div style={{fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",color:C.textMuted,marginBottom:8}}>Por color</div>
                        {colorRows.map((cr,j)=>(
                          <div key={j} style={{marginBottom:j<colorRows.length-1?10:0,paddingBottom:j<colorRows.length-1?10:0,borderBottom:j<colorRows.length-1?`1px solid #1a1a1a`:"none"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                              <span style={{fontSize:12,fontWeight:600,color:C.textDim}}>{cr.color}</span>
                              <span style={{fontSize:10,color:C.textMuted}}>{cr.total}</span>
                            </div>
                            <Bar pctOk={cr.pctOk}/>
                            <div style={{display:"flex",gap:6,marginTop:3}}>
                              {[["✓",cr.ok,C.green],["T",cr.tone,C.yellow],["D",cr.dob,"#f97316"],["✗",cr.bad,C.red]].map(([l,n,c])=>
                                n>0&&<span key={l} style={{fontSize:9,color:c,background:`${c}18`,padding:"1px 5px",borderRadius:3}}>{l} {n}</span>
                              )}
                              {cr.recs>0&&<span style={{fontSize:9,color:"#f87171",background:"rgba(248,113,113,0.12)",padding:"1px 5px",borderRadius:3}}>⚠ {cr.recs}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <TableSection title="Por formato"   rows={fmtStats}  labelFn={r=>r.label}/>

          </>)}
        </div>
      </div>
    );
  }

  // ── COLORS ───────────────────────────────────────────────────────
  if (screen === "colors") {
    const seriesList = [...new Set(colors.map(c=>c.serie))];

    return (
      <div style={S.app}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={()=>{setColorError("");setScreen("home");}}>← Volver</button>
          <span style={S.headerTitle}>Gestión de Colores</span>
          <span style={{fontSize:11,color:C.textMuted}}>{colors.length} colores</span>
        </div>
        <div style={S.page}>
          <div style={S.sectionTitle}>Añadir color</div>
          <div style={S.card}>
            <div style={S.measureRow}>
              <div>
                <label style={S.label}>Serie</label>
                <input style={S.input} placeholder="Stromboli"
                  value={newColor.serie} onChange={e=>setNewColor(c=>({...c,serie:e.target.value}))} />
              </div>
              <div>
                <label style={S.label}>Abreviatura</label>
                <input style={S.input} placeholder="ST"
                  value={newColor.abbr} onChange={e=>setNewColor(c=>({...c,abbr:e.target.value}))} />
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <label style={S.label}>Color</label>
              <input style={S.input} placeholder="Light"
                value={newColor.color} onChange={e=>setNewColor(c=>({...c,color:e.target.value}))} />
            </div>
            {colorError && <div style={{fontSize:11,color:C.red,marginBottom:8}}>{colorError}</div>}
            <button style={S.primaryBtn} onClick={handleAddColor}>Añadir</button>
          </div>

          {seriesList.map(serie=>{
            const sColors = colors.filter(c=>c.serie===serie);
            const abbr    = sColors[0]?.abbr||"";
            return (
              <div key={serie} style={{marginBottom:14}}>
                <div style={{...S.sectionTitle, display:"flex", alignItems:"center", gap:8}}>
                  <span style={{
                    background:C.gold, color:C.bg, fontSize:9, fontWeight:700,
                    padding:"2px 6px", borderRadius:3, letterSpacing:"0.1em",
                  }}>{abbr}</span>
                  <span>{serie} — {sColors.length} colores</span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {sColors.map(c=>(
                    <div key={c.id} style={{
                      background:C.surface, border:`1px solid ${C.border}`,
                      borderRadius:6, padding:"8px 12px",
                      display:"flex", alignItems:"center", gap:8,
                    }}>
                      <span style={{fontSize:12}}>{c.color}</span>
                      <button style={{
                        background:"none", border:"none", color:"#4a5568",
                        cursor:"pointer", fontSize:13, padding:0, lineHeight:1,
                      }} onClick={()=>{if(colors.length>1){const u=colors.filter(x=>x.id!==c.id); setColors(u); saveColorsToSheet(u).catch(()=>{})}}}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
