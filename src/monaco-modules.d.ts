// Monaco's language contributions are side-effect JavaScript with no types.
//
// They register a grammar and export nothing, so there is nothing to describe
// — but TypeScript still refuses an import it cannot resolve to a declaration.
// One wildcard each rather than `allowJs`, which would pull the whole of
// Monaco's source into the programme for no benefit.

declare module 'monaco-editor/basic-languages/*'
declare module 'monaco-editor/language/*'
