export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed";
export const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500";
export const panelClass =
  "rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5";
export function bytesLabel(value = 0) {
  return `${(value / 1024 / 1024).toFixed(2)} Mio`;
}
export function dateLabel(value) {
  return value
    ? new Date(
        /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
      ).toLocaleString("fr-FR")
    : "—";
}
