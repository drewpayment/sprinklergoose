// Generates the PWA icons (water-drop glyph on a solid teal background) as
// PNGs with zero image dependencies: shapes are rasterized analytically and
// encoded with a minimal PNG writer (zlib deflate + hand-built chunks).
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

// ---------- minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- water drop rasterizer ----------
const BG = [14, 116, 144] // #0e7490
const FG = [255, 255, 255]

function makeIcon(size, glyphScale) {
  const H = size * glyphScale // drop height
  const top = (size - H) / 2
  const r = H * 0.34 // bowl radius
  const cx = size / 2
  const cy = top + H - r // bowl center (drop bottom = top + H)
  const ax = cx
  const ay = top // apex
  const d = cy - ay
  const gamma = Math.acos(r / d)
  // tangent points of the lines from the apex to the bowl circle
  const t1x = cx + r * Math.sin(gamma)
  const t2x = cx - r * Math.sin(gamma)
  const ty = cy - r * Math.cos(gamma)

  const inDrop = (x, y) => {
    const dx = x - cx
    const dy = y - cy
    if (dx * dx + dy * dy <= r * r) return true
    // triangle (apex, t1, t2)
    if (y < ay || y > ty) return false
    const s1 = (t1x - ax) * (y - ay) - (ty - ay) * (x - ax)
    const s2 = (t2x - t1x) * (y - ty) - 0 * (x - t1x)
    const s3 = (ax - t2x) * (y - ty) - (ay - ty) * (x - t2x)
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)
  }

  const SS = 4 // 4x4 supersampling for antialiasing
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inDrop(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++
        }
      }
      const a = hit / (SS * SS)
      const o = (y * size + x) * 4
      rgba[o] = Math.round(BG[0] + (FG[0] - BG[0]) * a)
      rgba[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a)
      rgba[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a)
      rgba[o + 3] = 255
    }
  }
  return encodePng(size, rgba)
}

mkdirSync(OUT_DIR, { recursive: true })
const targets = [
  ['icon-192.png', 192, 0.6],
  ['icon-512.png', 512, 0.6],
  // maskable: glyph stays well inside the 80% safe zone
  ['icon-maskable-192.png', 192, 0.44],
  ['icon-maskable-512.png', 512, 0.44],
  ['apple-touch-icon.png', 180, 0.56],
]
for (const [name, size, scale] of targets) {
  writeFileSync(join(OUT_DIR, name), makeIcon(size, scale))
  console.log(`wrote ${name} (${size}x${size})`)
}
