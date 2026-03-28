declare module "@chenglou/pretext" {
  export type PreparedText = { readonly __brand: unique symbol };

  export type PrepareOptions = { whiteSpace?: "normal" | "pre-wrap" };

  export type LayoutResult = {
    lineCount: number;
    height: number;
  };

  export function prepare(text: string, font: string, options?: PrepareOptions): PreparedText;

  export function layout(
    prepared: PreparedText,
    maxWidth: number,
    lineHeight: number,
  ): LayoutResult;

  export function clearCache(): void;

  export function setLocale(locale?: string): void;
}
