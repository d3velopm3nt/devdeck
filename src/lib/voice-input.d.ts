export {}
declare global {
  var DevVoiceInput: {
    create(options: {
      onState: (state: 'idle' | 'starting' | 'listening') => void
      onCaption: (text: string) => void
      onText: (text: string) => void | Promise<void>
      onError: (error: string) => void
      language?: string
    }): { start(): void; finish(): void; cancel(): void; dispose(): void; supported: boolean; state(): string; level(): number }
  }
}
