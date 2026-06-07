export function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2.5">
      <span className="text-xs text-[#707070]">{label}</span>
      <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-right text-xs font-bold text-[#171717]">
        {value}
      </strong>
    </div>
  );
}
