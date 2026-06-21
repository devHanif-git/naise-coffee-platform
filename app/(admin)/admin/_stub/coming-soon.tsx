export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20 text-center">
      <h1 className="font-heading text-xl font-bold tracking-tight">{title}</h1>
      <p className="max-w-[16rem] text-sm text-muted-foreground">
        This module is coming in a later phase.
      </p>
    </div>
  );
}
