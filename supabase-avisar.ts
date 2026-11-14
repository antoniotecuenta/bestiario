// Bestiario · función "avisar" (Supabase Edge Function)
// Cada hora la llama una tarea programada (pg_cron). Calcula cómo va tu héroe
// y te manda un aviso con nombres reales. Fuera de tus horas activas no manda nada.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, LLAVE, {
  auth: { persistSession: false },
});

/* ---------- claves VAPID: se crean solas la primera vez y nunca salen de la base ---------- */
async function claves() {
  const { data } = await db.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await db.from("push_config").insert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  const { data: d2 } = await db.from("push_config").select("*").eq("id", 1).single();
  return d2;
}

/* ---------- reloj local de cada persona ---------- */
const fmtHora: Record<string, Intl.DateTimeFormat> = {};
const fmtDia: Record<string, Intl.DateTimeFormat> = {};
function horaLocal(t: number, tz: string) {
  const f = (fmtHora[tz] ||= new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }));
  const p = f.formatToParts(new Date(t));
  return +p.find((x) => x.type === "hour")!.value + +p.find((x) => x.type === "minute")!.value / 60;
}
function diaLocal(t: number, tz: string) {
  const f = (fmtDia[tz] ||= new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }));
  return f.format(new Date(t));
}

/* ---------- misma cuenta de vida que la web ---------- */
// deno-lint-ignore no-explicit-any
type H = any;
function descansando(t: number, h: H, tz: string) {
  const x = horaLocal(t, tz), a = h.descansoIni, b = h.descansoFin;
  if (a === b) return false;
  return a > b ? x >= a || x < b : x >= a && x < b;
}
// La vida baja a cada hora en punto. Una hora en punto cuenta si la hora anterior no era de descanso.
const HORA = 36e5;
// Solo cuenta si en esa hora había algún demonio por derrotar.
const cuentaPunto = (t: number, S: H, tz: string) => !descansando(t - 60000, S.heroe, tz) && hayPendientesEn(S, t, tz);
function vidaHeroe(S: H, ahora: number, tz: string) {
  const h = S.heroe;
  let n = 0;
  for (let t = Math.floor(Math.max(h.ultimo, ahora - 14 * 864e5) / HORA) * HORA + HORA; t <= ahora; t += HORA)
    if (cuentaPunto(t, S, tz)) n++;
  return Math.max(0, h.vida - n * h.drenaje);
}
function nemesisHoy(S: H, hoy: string) {
  let e: H = null;
  for (const x of S.nemesis || []) if (x.desde <= hoy) e = x;
  return e && e.id ? (S.rivales || []).find((r: H) => r.id === e.id) || null : null;
}
/* ---------- jefes con guardia (misma cuenta que la web) ---------- */
const diaNum = (k: string) => { const [y, m, d] = k.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const r2 = (n: number) => Math.round(n * 100) / 100;
function cuota(r: H, k: string) {
  if (r.tipo !== "jefe" || r.caidoEn) return 0;
  let ini = r.vida - (r.dano || 0);
  for (const d in r.dias || {}) if (d >= k) ini += r.dias[d];
  if (ini <= 0) return 0;
  let q: number;
  if (r.fecha) { const dq = diaNum(r.fecha) - diaNum(k) + 1; q = ini / (dq > 0 ? dq : 7); }
  else if (r.cuotaFija > 0) q = r.cuotaFija;
  else return 0;
  q = Number.isInteger(r.vida) ? Math.ceil(q) : r2(q);
  return Math.min(q, ini);
}
// furia: si llevas días sin enfrentar a un rival diario, hoy tiene más vida (igual que en la web)
function vidaDiario(r: H, k: string, hoyK: string) {
  if (k !== hoyK) return r.vida;
  let ult = r.creado || hoyK;
  for (const d in r.dias || {}) if (d < hoyK && r.dias[d] > 0 && d > ult) ult = d;
  for (const x of r.hist || []) if (x.d && x.d < hoyK && x.d > ult) ult = x.d;
  const g = ult >= hoyK ? 0 : Math.max(0, diaNum(hoyK) - diaNum(ult) - 1);
  const b = g >= 4 ? 0.5 : g >= 2 ? 0.25 : 0;
  if (!b) return r.vida;
  const v = r.vida * (1 + b);
  return Number.isInteger(r.vida) ? Math.ceil(v) : r2(v);
}
function pendiente(r: H, hoy: string, hoyK = hoy) {
  if (r.archivado) return false;
  if (r.creado && hoy < r.creado) return false;
  if (r.tipo === "jefe") {
    if (r.caidoEn && r.caidoEn <= hoy) return false;
    const q = cuota(r, hoy);
    return q > 0 ? ((r.dias || {})[hoy] || 0) < q : true;
  }
  return ((r.dias || {})[hoy] || 0) < vidaDiario(r, hoy, hoyK);
}
function pendienteEn(r: H, t: number, tz: string) {
  if (r.creadoT && t < r.creadoT) return false;
  if (r.archivado && (!r.archivadoT || t >= r.archivadoT)) return false;
  const k = diaLocal(t - 60000, tz);
  return pendiente({ ...r, archivado: null }, k, diaLocal(Date.now(), tz));
}
const hayPendientesEn = (S: H, t: number, tz: string) => (S.rivales || []).some((r: H) => pendienteEn(r, t, tz));

/* ---------- el mensaje ---------- */
const elegir = <T>(a: T[], n: number) => a[Math.abs(n) % a.length];
export function mensaje(S: H, ahora: number, tz: string) {
  const h = S.heroe;
  const H = h.nombre || "Tu héroe";
  const v = Math.ceil(vidaHeroe(S, ahora, tz));
  const hoy = diaLocal(ahora, tz);
  const vivos = (S.rivales || []).filter((r: H) => pendiente(r, hoy));
  const nem = nemesisHoy(S, hoy);
  const nemVivo = nem && pendiente(nem, hoy) ? nem : null;
  const n = Math.floor(ahora / 36e5);
  const rival = nemVivo || (vivos.length ? elegir(vivos, n) : null);
  const R = rival ? rival.nombre : null;
  // "reciente" solo si de verdad golpeaste a alguien en la última hora (no por editar el héroe)
  let ultGolpe = 0;
  for (const r of S.rivales || []) for (const x of r.hist || []) if (x.t > ultGolpe) ultGolpe = x.t;
  const reciente = ahora - ultGolpe < 60 * 60000;
  const q = rival ? cuota(rival, hoy) : 0;
  const falta = rival && q > 0 ? r2(q - ((rival.dias || {})[hoy] || 0)) : 0;
  const u = rival ? rival.unidad || "" : "";

  if (v <= 0)
    return {
      title: `¡Ouch! ${H} cayó`,
      body: R ? `${R} te derrotó. Golpéalo para volver a ponerte de pie.` : "Golpea a cualquier rival para levantarte.",
    };
  if (!R)
    return { title: `${H} sigue al ${v} %`, body: "Hoy ya venciste a todos. Mañana vuelven con hambre." };
  if (reciente)
    return {
      title: `${H} aguanta al ${v} %`,
      body: q > 0
        ? `Le pegaste a la guardia de ${R}, pero sigue en pie: faltan ${falta} ${u}. Remátala.`
        : elegir([`Le pegaste a ${R}, pero sigue en pie. Remátalo.`, `${R} está tocado, no derrotado. Termina lo que empezaste.`], n),
    };
  if (v <= 25)
    return {
      title: `¡Ouch! ${H} está al ${v} %`,
      body: q > 0
        ? `La guardia de ${R} está por derrotarte. Te faltan ${falta} ${u} hoy.`
        : elegir([`${R} está a punto de derrotarte. Un golpe te devuelve 10 %.`, `Te queda poco. ¿No te vas a defender? ${R} te va a derrotar.`], n),
    };
  if (nemVivo)
    return {
      title: "¡Ouch! Recibiste un golpe",
      body: q > 0
        ? `¿No te vas a defender? La guardia de ${R}, tu némesis, sigue en pie: te faltan ${falta} ${u}.`
        : `¿No te vas a defender? ${R}, tu némesis, te está ganando. Hoy no cuenta hasta que caiga.`,
    };
  if (q > 0)
    return {
      title: "¡Ouch! Recibiste un golpe",
      body: elegir([`¿No te vas a defender? La guardia de ${R} sigue en pie: te faltan ${falta} ${u} hoy.`, `La guardia de ${R} te pegó. ${H} va al ${v} %. Te faltan ${falta} ${u}.`], n),
    };
  return {
    title: "¡Ouch! Recibiste un golpe",
    body: elegir(
      [
        `¿No te vas a defender? ${R} te está dando pelea. ${H} va al ${v} %.`,
        `¿No te vas a defender? ${R} te va a derrotar. ${H} va al ${v} %.`,
        `${R} te pegó otra vez. ${H} baja al ${v} %. Defiéndete.`,
      ],
      n,
    ),
  };
}

/* ---------- envío ---------- */
// deno-lint-ignore no-explicit-any
async function enviar(subs: any[], forzar: boolean) {
  const cfg = await claves();
  webpush.setVapidDetails("https://antoniotecuenta.github.io/bestiario/", cfg.public_key, cfg.private_key);
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const { data: filas } = await db.from("bestiario").select("user_id,data").in("user_id", ids);
  const datos = new Map((filas || []).map((f) => [f.user_id, f.data]));
  const ahora = Date.now();
  let enviados = 0;
  for (const s of subs) {
    const S = datos.get(s.user_id);
    if (!S || !S.heroe) continue;
    const tz = s.tz || "America/Guayaquil";
    // solo avisa en las horas en punto que le quitan vida: hora activa y con demonios en pie
    const punto = Math.round(ahora / HORA) * HORA;
    // sin demonios por derrotar no hay aviso
    if (!forzar && !cuentaPunto(punto, S, tz)) continue;
    const m = mensaje(S, ahora, tz);
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(m), { TTL: 3000, urgency: "normal" });
      enviados++;
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const c = (e as any)?.statusCode;
      if (c === 404 || c === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.has("clave")) {
      const cfg = await claves();
      return json({ publicKey: cfg.public_key });
    }
    const body = await req.json().catch(() => ({}));
    if (body.prueba && body.endpoint) {
      const { data } = await db.from("push_subs").select("*").eq("endpoint", body.endpoint);
      return json({ enviados: await enviar(data || [], true) });
    }
    // ronda de cada hora: como mucho una cada 50 minutos, la llame quien la llame
    const limite = new Date(Date.now() - 50 * 60000).toISOString();
    await claves();
    const { data: ok } = await db
      .from("push_config")
      .update({ last_run: new Date().toISOString() })
      .eq("id", 1)
      .or(`last_run.is.null,last_run.lt.${limite}`)
      .select("id");
    if (!ok || !ok.length) return json({ omitido: true });
    const { data: subs } = await db.from("push_subs").select("*");
    return json({ enviados: await enviar(subs || [], false) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
