// Generates PWA icons from an inline SVG 8-ball design using sharp.
import sharp from 'sharp'
import { mkdirSync } from 'fs'

const OUT = '/home/z/my-project/public/icons'
mkdirSync(OUT, { recursive: true })

const svg = (size) => {
  const s = size / 512
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="ball" cx="0.38" cy="0.32" r="0.9">
      <stop offset="0" stop-color="#4a4a4a"/>
      <stop offset="0.55" stop-color="#1d1d1d"/>
      <stop offset="1" stop-color="#050505"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14654a"/>
      <stop offset="1" stop-color="#0a2e21"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <g transform="translate(256 252)">
    <circle r="152" fill="url(#ball)"/>
    <ellipse cx="-52" cy="-66" rx="46" ry="26" fill="#ffffff" opacity="0.28" transform="rotate(-28)"/>
    <circle cy="-34" r="58" fill="#f6f3ea"/>
    <text y="-32" font-family="Arial, Helvetica, sans-serif" font-size="86" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="#141414">8</text>
  </g>
  <g transform="rotate(-35 400 430)">
    <rect x="380" y="120" width="16" height="380" rx="8" fill="#8a5a2b"/>
    <rect x="380" y="120" width="16" height="46" rx="8" fill="#2c1c0e"/>
  </g>
</svg>`
}

const svgMaskable = (size) => {
  // full-bleed background + smaller safe-zone ball for maskable purpose
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="ball" cx="0.38" cy="0.32" r="0.9">
      <stop offset="0" stop-color="#4a4a4a"/>
      <stop offset="0.55" stop-color="#1d1d1d"/>
      <stop offset="1" stop-color="#050505"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14654a"/>
      <stop offset="1" stop-color="#0a2e21"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 248)">
    <circle r="120" fill="url(#ball)"/>
    <circle cy="-27" r="46" fill="#f6f3ea"/>
    <text y="-26" font-family="Arial, Helvetica, sans-serif" font-size="68" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="#141414">8</text>
  </g>
</svg>`
}

async function run() {
  await sharp(Buffer.from(svg(512))).png().toFile(`${OUT}/icon-512.png`)
  await sharp(Buffer.from(svg(192))).png().toFile(`${OUT}/icon-192.png`)
  await sharp(Buffer.from(svg(180))).png().toFile(`${OUT}/apple-touch-icon.png`)
  await sharp(Buffer.from(svgMaskable(512))).png().toFile(`${OUT}/icon-512-maskable.png`)
  console.log('icons generated')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
