export interface ToolOutput {
  data: Buffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}
