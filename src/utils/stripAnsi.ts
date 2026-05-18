export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-9;?]*[\x20-\x2F]*[\x40-\x7E]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()=><][\x20-\x7E]?/g, "")
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b/g, "")
    .replace(/\[[<>=?][0-9;]*[A-Za-z]/g, "");
}
