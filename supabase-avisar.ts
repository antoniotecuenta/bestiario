// Bestiario · función "avisar" (Supabase Edge Function)
// Cada hora la llama una tarea programada (pg_cron). Calcula cómo va tu héroe
// y te manda un aviso con nombres reales. En tus horas de descanso no manda nada.
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
function vidaHeroe(h: H, ahora: number, tz: string) {
  const PASO = 5 * 60000;
  let m = 0;
  for (let t = Math.max(h.ultimo, ahora - 14 * 864e5); t < ahora; t += PASO) {
    const c = Math.min(PASO, ahora - t);
    if (!descansando(t, h, tz)) m += c;
  }
  return Math.max(0, h.vida - (m / 36e5) * h.drenaje);
}
function nemesisHoy(S: H, hoy: string) {
  let e: H = null;
  for (const x of S.nemesis || []) if (x.desde <= hoy) e = x;
  return e && e.id ? (S.rivales || []).find((r: H) => r.id === e.id) || null : null;
}
function pendiente(r: H, hoy: string) {
  if (r.tipo === "jefe") return !r.caidoEn;
  return ((r.dias || {})[hoy] || 0) < r.vida;
}

/* ---------- el mensaje ---------- */
const elegir = <T>(a: T[], n: number) => a[Math.abs(n) % a.length];
export function mensaje(S: H, ahora: number, tz: string) {
  const h = S.heroe;
  const H = h.nombre || "Tu héroe";
  const v = Math.ceil(vidaHeroe(h, ahora, tz));
  const hoy = diaLocal(ahora, tz);
  const vivos = (S.rivales || []).filter((r: H) => pendiente(r, hoy));
  const nem = nemesisHoy(S, hoy);
  const nemVivo = nem && pendiente(nem, hoy) ? nem : null;
  const n = Math.floor(ahora / 36e5);
  const R = nemVivo ? nemVivo.nombre : vivos.length ? elegir(vivos, n).nombre : null;
  const reciente = ahora - h.ultimo < 60 * 60000;

  if (v <= 0)
    return {
      title: `${H} está en el suelo`,
      body: R ? `Golpea a ${R} y vuelve a ponerte de pie.` : "Golpea a cualquier rival para levantarte.",
    };
  if (!R)
    return {
      title: `${H} sigue al ${v} %`,
      body: elegir(["Hoy ya venciste a todos. Mañana vuelven con hambre.", "Nadie queda en pie hoy. Descansa sin culpa."], n),
    };
  if (reciente)
    return {
      title: `${H} resiste al ${v} %`,
      body: elegir([`Golpeaste hace poco. ${R} todavía respira.`, `Buen golpe. ${R} sigue en pie, no lo sueltes.`], n),
    };
  if (v <= 25)
    return {
      title: `${H} está al ${v} %`,
      body: elegir([`${R} está por derrotarte. Un golpe te devuelve 10 %.`, `Te queda poco. Golpea a ${R} antes de caer.`], n),
    };
  if (nemVivo)
    return {
      title: "Acabas de recibir un golpe",
      body: elegir([`${R}, tu némesis, sigue en pie. ${H} baja al ${v} %.`, `Hoy no cuenta hasta que caiga ${R}. Vas al ${v} %.`], n),
    };
  return {
    title: "Acabas de recibir un golpe",
    body: elegir(
      [
        `${H} baja al ${v} %. No dejes que ${R} te derrote.`,
        `${R} te quitó vida. ${H} va al ${v} %.`,
        `Otra hora sin pelear: ${H} al ${v} %. ${R} te espera.`,
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
    if (!forzar && descansando(ahora, S.heroe, tz)) continue;
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
