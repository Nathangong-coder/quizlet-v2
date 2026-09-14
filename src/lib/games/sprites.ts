/**
 * Pixel sprites as text. Each character is one pixel; `.` is transparent.
 * Rendered by `PixelSprite` as an SVG of rects with crisp edges, so the art
 * is ~2 KB of markup that scales to any size and follows no raster asset.
 *
 * On-brand rather than a mascot borrowed from elsewhere: the palette is the
 * app's indigo and cream, and the hero carries the synapse constellation
 * on the shield. Overlays (costumes, faces) are the same grid with `.`
 * meaning "keep the pixel underneath".
 */

export const PALETTE: Record<string, string> = {
  k: '#1e1b4b', // outline / dark navy
  i: '#4255ff', // indigo
  l: '#8b93ff', // light indigo
  n: '#2e3a9e', // deep indigo (shadow)
  c: '#f4efe6', // cream
  s: '#f1d9c0', // skin
  w: '#ffffff',
  g: '#e0b25a', // gold
  r: '#c8323f', // red
  e: '#3fae7c', // green
  d: '#3b3f52', // dark grey
  p: '#7c3aed', // purple
  o: '#f0a35e', // orange
  b: '#111827', // near black
  y: '#ffe08a', // pale yellow
  t: '#0f766e', // teal
}

export type Sprite = readonly string[]

/** Overlay `top` onto `base`; `.` in the overlay keeps the base pixel. */
export function compose(base: Sprite, ...overlays: (Sprite | null | undefined)[]): string[] {
  const out = base.map((r) => r.split(''))
  for (const ov of overlays) {
    if (!ov) continue
    ov.forEach((row, y) => {
      if (!out[y]) return
      for (let x = 0; x < row.length && x < out[y].length; x++) if (row[x] !== '.') out[y][x] = row[x]
    })
  }
  return out.map((r) => r.join(''))
}

// ------------------------------------------------------------ the knight (you)
export const KNIGHT: Sprite = [
  '......kkkkkk......',
  '.....kiiiiiik.....',
  '....kiiilliiik....',
  '....kiiiiiiiik....',
  '....kicccccciik...',
  '....kicbccbciik...',
  '....kicccccciik...',
  '....kiiiiiiiik....',
  '.....kiiiiiik.....',
  '...kkkkkkkkkkkk...',
  '..kiiiiiiiiiiiik..',
  '.kiikiiiiiiiikiik.',
  'kiiikiiiiiiiikiiik',
  'kggkkiiiiiiiikkggk',
  '.kk.kiiiiiiiik.kk.',
  '....kiiikkiiik....',
  '....kiiik.kiiik...',
  '....kkkkk.kkkkk...',
]
/** Shield with the constellation, held on the left. */
export const KNIGHT_SHIELD: Sprite = [
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  'kkkk..............',
  'kcckk.............',
  'kcickk............',
  'kccikk............',
  'kcickk............',
  '.kcck.............',
  '..kk..............',
  '..................',
]

// ------------------------------------------------------------------ enemies
export const SLIME: Sprite = [
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '......kkkkkk......',
  '....kkeeeeeekk....',
  '...keeeeeeeeeek...',
  '..keeekeeeekeeek..',
  '..keeebeeeebeeek..',
  '.keeeeeeeeeeeeeek.',
  '.keeeeekkkkeeeeek.',
  '.keeeeeeeeeeeeeek.',
  '.keeeeeeeeeeeeeek.',
  '..keeeeeeeeeeeek..',
  '...kkeeeeeeeekk...',
  '.....kkkkkkkk.....',
  '..................',
]
export const IMP: Sprite = [
  '..................',
  '..k...........k...',
  '..kk.........kk...',
  '...kk.......kk....',
  '....kkkkkkkkk.....',
  '...kpppppppppk....',
  '...kppyppppyppk...',
  '...kppbppppbppk...',
  '...kpppppppppk....',
  '...kppkkkkkppk....',
  '....kppppppk......',
  '...kkkkkkkkkk.....',
  '..kppppppppppk....',
  '.kpkppppppppkpk...',
  '.kk.kppppppk.kk...',
  '....kppkkppk......',
  '....kppk.kppk.....',
  '....kkk..kkk......',
]
export const DARK_KNIGHT: Sprite = [
  '......kkkkkk......',
  '.....kddddddk.....',
  '....kddddddddk....',
  '....kddddddddk....',
  '....kdrrrrrrdk....',
  '....kdrbrrbrdk....',
  '....kdrrrrrrdk....',
  '....kddddddddk....',
  '.....kddddddk.....',
  '...kkkkkkkkkkkk...',
  '..kddddddddddddk..',
  '.kddkddddddddkddk.',
  'kdddkddddddddkdddk',
  'krrkkddddddddkkrrk',
  '.kk.kddddddddk.kk.',
  '....kdddkkdddk....',
  '....kdddk.kdddk...',
  '....kkkkk.kkkkk...',
]
/** The Examiner — the boss. Taller, robed, crowned. */
export const BOSS: Sprite = [
  '.....kgkgkgk......',
  '.....kgggggggk....',
  '....kkkkkkkkkk....',
  '...kppppppppppk...',
  '...kpccccccccpk...',
  '...kpcbccccbcpk...',
  '...kpccccccccpk...',
  '...kpcckkkkccpk...',
  '....kpppppppppk...',
  '..kkkkkkkkkkkkkk..',
  '.kppppppppppppppk.',
  'kpppkppppppppkpppk',
  'kpppkppppppppkpppk',
  'kggkkppppppppkkggk',
  '.kk.kppppppppk.kk.',
  '....kppppppppk....',
  '....kppppppppk....',
  '....kkkkkkkkkk....',
]
/** The magician helper: hat, stars, offers heal or weaken. */
export const MAGICIAN: Sprite = [
  '........kk........',
  '.......kppk.......',
  '......kppppk......',
  '.....kppppppk.....',
  '..kkkkppppppkkkk..',
  '.kppppppppppppppk.',
  '..kkkkkkkkkkkkkk..',
  '....kssssssssk....',
  '....ksbssssbsk....',
  '....kssssssssk....',
  '....ksskkkksskk...',
  '.....kssssssk.....',
  '...kkkkkkkkkkkky..',
  '..kppppppppppkyyy.',
  '.kpkppppppppkpkyk.',
  '.kk.kppppppk.kk...',
  '....kppkkppk......',
  '....kkk..kkk......',
]

// ------------------------------------------------------- the interviewer face
/**
 * The Hot Seat interviewer: a round head, shoulders, and a costume overlay
 * per subject group. Faces are overlays on rows 6–11 only.
 */
export const HOST_BASE: Sprite = [
  '......kkkkkk......',
  '....kkccccccckk...',
  '...kcccccccccccck.',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '..kcccccccccccccck',
  '...kcccccccccccck.',
  '....kkccccccckk...',
  '......kkkkkk......',
  '.....kkiiiikk.....',
  '...kkiiiiiiiikk...',
  '..kiiiiiiiiiiiik..',
  '..kiiiiiiiiiiiik..',
]
export const FACES: Record<'neutral' | 'pleased' | 'skeptical' | 'annoyed' | 'impressed', Sprite> = {
  neutral: [
    '', '', '', '', '', '',
    '.....bb....bb.....',
    '.....bb....bb.....',
    '..................',
    '.......kkkk.......',
    '..................',
  ],
  pleased: [
    '', '', '', '', '', '',
    '.....bb....bb.....',
    '....b..b..b..b....',
    '..................',
    '......k....k......',
    '.......kkkk.......',
  ],
  skeptical: [
    '', '', '', '', '',
    '.....bbb..........',
    '.....bb....bb.....',
    '..................',
    '..................',
    '.......kkk........',
    '..........k.......',
  ],
  annoyed: [
    '', '', '', '', '',
    '....bb......bb....',
    '.....bb....bb.....',
    '......b....b......',
    '..................',
    '......kkkkkk......',
    '..................',
  ],
  impressed: [
    '', '', '', '', '', '',
    '....bbb...bbb.....',
    '....b.b...b.b.....',
    '....bbb...bbb.....',
    '.......kkkk.......',
    '......k....k......',
  ],
}
/** Costumes by subject group. Rows 0–5 are hat/hair, 13–17 body. */
export const COSTUMES: Record<string, { name: string; overlay: Sprite }> = {
  'business-finance': {
    name: 'The panel',
    overlay: ['', '', '', '', '', '', '', '', '', '', '', '', '', '.....kkddddkk.....', '...kkddkrrkddkk...', '..kddddkrrkddddk..', '..kddddkrrkddddk..'],
  },
  science: {
    name: 'The scientist',
    overlay: ['', '', '...kddddddddddddk.', '...kddyyddddyyddk.', '', '', '', '', '', '', '', '', '', '.....kkwwwwkk.....', '...kkwwwwwwwwkk...', '..kwwwwwkkwwwwwk..', '..kwwwwwkkwwwwwk..'],
  },
  'arts-humanities': {
    name: 'The author',
    overlay: ['....kkkkkkkkk.....', '..kkpppppppppkk...', '.kpppppppppppppk..', '..kkkkkkkkkkkkkk..', '', '', '', '', '', '', '', '', '', '.....kkttttkk.....', '...kkttttttttkk...', '..kttttttttttttk..', '..kttttttttttttk..'],
  },
  maths: {
    name: 'The professor',
    overlay: ['', '', '', '', '', '', '', '', '', '', '', '', '', '.....kkddkkddk....', '...kkddkrrkddkk...', '..kddddkkkkddddk..', '..kddddddddddddk..'],
  },
  'medicine-health': {
    name: 'The attending',
    overlay: ['', '', '', '', '', '', '', '', '', '', '', '', '', '.....kkwwwwkk.....', '...kkwwtwwtwwkk...', '..kwwwwtkktwwwwk..', '..kwwwwwttwwwwwk..'],
  },
  technology: {
    name: 'The interviewer',
    overlay: ['', '', '', '', '', '', '', '', '', '', '', '', '', '.....kkddddkk.....', '...kkddddddddkk...', '..kddddkkkkddddk..', '..kddddddddddddk..'],
  },
  default: {
    name: 'The examiner',
    overlay: ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  },
}
