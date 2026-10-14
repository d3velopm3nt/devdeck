export type OrbMode = 'idle' | 'connecting' | 'listening' | 'thinking' | 'preparing' | 'speaking' | 'offline'
export interface OrbPreferences { style: 'flow' | 'ribbons' | 'particles'; primary: string; secondary: string; glow: number; size: number; movement: number }
declare global {
  var DevOrb: {
    defaults: OrbPreferences
    styles: readonly { id: OrbPreferences['style']; name: string; description: string }[]
    normalize(value: unknown): OrbPreferences
    mount(canvas: HTMLCanvasElement, visible: () => boolean, mode: () => OrbMode | string, audioLevel?: () => number, preferences?: () => OrbPreferences): () => void
  }
}
