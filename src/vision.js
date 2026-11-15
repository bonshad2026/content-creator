// Local face tracking (no AI tokens): face-api's tiny face detector on TensorFlow.js (WASM), frames straight from ffmpeg.
// Used for the smart 9:16 crop of landscape videos and to aim punch-in zooms at the face.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const SAMPLE_W = 480, FPS = 2; // 480 px: small faces in wide shots are still found
let ready = null;

async function load() {
  const tf = await import("@tensorflow/tfjs");
  const wasm = await import("@tensorflow/tfjs-backend-wasm");
  const faceapi = await import("@vladmandic/face-api/dist/face-api.node-wasm.js");
  wasm.setWasmPaths(path.resolve("node_modules/@tensorflow/tfjs-backend-wasm/dist") + "/", true);
  // Node's fetch can't read local files → hand the .wasm over from disk
  const platform = tf.env().platform, nodeFetch = platform.fetch.bind(platform);
  platform.fetch = async (u, init) =>
    /\.wasm$/.test(String(u)) ? new Response(fs.readFileSync(String(u)), { headers: { "Content-Type": "application/wasm" } }) : nodeFetch(u, init);
  await tf.setBackend("wasm");
  await tf.ready();
  await faceapi.nets.tinyFaceDetector.loadFromDisk(path.resolve("node_modules/@vladmandic/face-api/model"));
  return { tf, faceapi };
}

/**
 * Face position over time → { coverage (0-1), at(t) → {cx, cy, size} normalised to the video frame, or null if no face }.
 * Positions are smoothed (2.5 s window) so the crop moves calmly, like a camera operator, not jittery.
 */
export async function faceTrack(file, maxSec = 120) {
  ready ||= load();
  const { tf, faceapi } = await ready;
  const raw = await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-t", String(maxSec), "-i", file, "-an", "-vf", `fps=${FPS},scale=${SAMPLE_W}:-2`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { windowsHide: true });
    let err = "";
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", () => {
      const m = err.match(/rgb24.*?, (\d+)x(\d+)/);
      m ? resolve({ buf: Buffer.concat(chunks), h: +m[2] }) : reject(new Error("ffmpeg: no frames for face tracking"));
    });
  });
  const H = raw.h, size = SAMPLE_W * H * 3, n = Math.floor(raw.buf.length / size);
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
  const pts = [];
  for (let i = 0; i < n; i++) {
    const img = tf.tensor3d(new Uint8Array(raw.buf.buffer, raw.buf.byteOffset + i * size, size), [H, SAMPLE_W, 3], "int32");
    const faces = await faceapi.detectAllFaces(img, opts);
    img.dispose();
    if (!faces.length) continue;
    // the biggest face = the speaker; two similar-size faces (a dialogue) → frame the middle between them
    const sorted = faces.map((f) => f.box).sort((a, c) => c.area - a.area);
    const group = sorted.filter((b) => b.area >= sorted[0].area * 0.5).slice(0, 3);
    const avg = (fn) => group.reduce((a, b) => a + fn(b), 0) / group.length;
    pts.push({ t: i / FPS, cx: avg((b) => b.x + b.width / 2) / SAMPLE_W, cy: avg((b) => b.y + b.height / 2) / H, size: sorted[0].height / H, faces: group.length });
  }
  // smooth: average of the points within ±1.25 s
  const smooth = pts.map((p) => {
    const near = pts.filter((q) => Math.abs(q.t - p.t) <= 1.25);
    const avg = (k) => near.reduce((a, q) => a + q[k], 0) / near.length;
    return { t: p.t, cx: avg("cx"), cy: avg("cy"), size: avg("size") };
  });
  const at = (t) => {
    if (!smooth.length) return null;
    const i = smooth.findIndex((p) => p.t >= t);
    if (i === 0) return smooth[0];
    if (i < 0) return smooth[smooth.length - 1];
    const a = smooth[i - 1], b = smooth[i], k = (t - a.t) / (b.t - a.t || 1);
    return { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, size: a.size + (b.size - a.size) * k };
  };
  return { coverage: n ? pts.length / n : 0, at };
}
