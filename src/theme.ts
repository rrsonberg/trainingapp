/**
 * Design tokens.
 *
 * The product is about the swing between exertion and recovery, so the palette
 * encodes it: training reads warm, recovery reads cold, and a week's timeline
 * shows the balance at a glance without a legend. Colour carries information
 * here — it is not decoration, and nothing else in the app is allowed to be
 * ember or ice.
 */
export const color = {
  ground:      '#101418',  // near-black slate, cool not neutral
  surface:     '#181D23',
  surfaceHigh: '#222932',
  line:        '#2C333D',

  text:        '#F2F5F7',
  textMuted:   '#8A97A6',

  ember:       '#E8603C',  // training / exertion
  emberDim:    '#4A2318',
  ice:         '#4CC8E8',  // recovery
  iceDim:      '#12363F',

  positive:    '#5FD08A',
  warning:     '#E8B84C',
  danger:      '#E8603C',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

export const type = {
  // Numerals dominate a logging app, so the data face is tabular by default.
  data:    { fontFamily: 'RobotoMono_500Medium', fontVariant: ['tabular-nums'] as const },
  display: { fontFamily: 'Inter_700Bold' },
  body:    { fontFamily: 'Inter_400Regular' },
  label:   { fontFamily: 'Inter_500Medium', letterSpacing: 0.4 },
} as const;

export const familyColor = (family: 'training' | 'recovery' | 'passive') =>
  family === 'training' ? color.ember
  : family === 'recovery' ? color.ice
  : color.textMuted;
