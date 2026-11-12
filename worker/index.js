import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Math.max(1000, Number(process.env.WORKER_POLL_MS || 3000));
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function updateJob(id, patch) {
  const { error } = await supabase.from("export_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

function runFfmpeg(args, job, duration) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBuffer = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", async chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key === "out_time_ms") {
          const seconds = Number(value) / 1_000_000;
          const progress = Math.max(1, Math.min(99, Math.floor(seconds / duration * 100)));
          try { await updateJob(job.id, { progress, message: "Renderizando MP4 en el servidor…" }); } catch (error) { console.error("Progress update:", error.message); }
        }
      }
    });
    proc.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12000); });
    proc.on("error", reject);
    proc.on("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg terminó con código " + code + ": " + stderr.slice(-3000))));
  });
}

async function processJob(job) {
  const params = job.params || {};
  const start = Number(params.start);
  const end = Number(params.end);
  const duration = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || duration < 1 || duration > 180) {
    throw new Error("Rango de clip no válido (duración permitida: 1–180 segundos).");
  }
  if (!job.source_path.startsWith(job.user_id + "/")) throw new Error("La ruta del video original no pertenece al usuario.");

  const dir = await mkdtemp(join(tmpdir(), "dc-export-"));
  const input = join(dir, "source");
  const output = join(dir, "clip.mp4");
  try {
    await updateJob(job.id, { progress: 2, message: "Descargando video original…" });
    const { data: source, error: downloadError } = await supabase.storage.from("sources").download(job.source_path);
    if (downloadError) throw downloadError;
    const bytes = new Uint8Array(await source.arrayBuffer());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(input, bytes);

    const width = Math.max(360, Math.min(1920, Number(params.width) || 1080));
    const height = Math.max(640, Math.min(1920, Number(params.height) || 1920));
    const aspect = String(params.aspect || "9:16");
    let filter;
    if (aspect === "original") {
      filter = "scale='min(1920,iw)':-2,setsar=1";
    } else {
      // Preserve every source pixel: a blurred, full-frame background fills 9:16.
      filter = `[0:v]split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=22:10[bg2];[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg2];[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1[outv]`;
    }
    const args = ["-hide_banner", "-y", "-ss", String(start), "-i", input, "-t", String(duration)];
    if (aspect === "original") args.push("-vf", filter);
    else args.push("-filter_complex", filter, "-map", "[outv]");
    args.push("-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", output);

    await updateJob(job.id, { progress: 5, message: "Preparando encuadre y audio…" });
    await runFfmpeg(args, job, duration);

    await updateJob(job.id, { progress: 96, message: "Guardando clip terminado…" });
    const clip = await readFile(output);
    const outputPath = job.user_id + "/" + job.id + ".mp4";
    const { error: uploadError } = await supabase.storage.from("clips").upload(outputPath, clip, {
      contentType: "video/mp4", upsert: true, cacheControl: "3600",
    });
    if (uploadError) throw uploadError;
    await updateJob(job.id, { status: "done", progress: 100, message: "Clip listo para reproducir y descargar.", output_path: outputPath, error: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
console.log("Dominican Clipper FFmpeg worker started");

while (!stopping) {
  try {
    const { data, error } = await supabase.rpc("claim_job");
    if (error) throw error;
    const job = Array.isArray(data) ? data[0] : data;
    if (!job?.id) { await sleep(POLL_MS); continue; }
    console.log("Processing export job", job.id);
    try {
      await processJob(job);
      console.log("Completed export job", job.id);
    } catch (error) {
      console.error("Export job failed", job.id, error);
      try {
        await updateJob(job.id, { status: "failed", progress: 0, message: "No se pudo crear el clip.", error: String(error.message || error).slice(0, 2000) });
      } catch (updateError) { console.error("Could not mark job failed:", updateError); }
    }
  } catch (error) {
    console.error("Worker loop error:", error);
    await sleep(POLL_MS * 2);
  }
}
console.log("Dominican Clipper worker stopped");
