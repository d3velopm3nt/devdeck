export {}
declare global {
  var createOfflineVoice: (options: {
    button: HTMLButtonElement; status: HTMLElement
    onPreparing?: () => void; onSpeaking: () => void; onIdle: () => void; onChange: () => void
  }) => { unlock(): Promise<void>; speak(text: string): Promise<void>; stop(): void; dispose(): void; level(): number; isReady(): boolean; canSpeak(): boolean }
}
