// Site-wide sticky bottom anchor ad (THR uses an adhesion ad). Reserved height,
// labeled, non-intrusive — real ad code drops into the inner box later.
export default function AnchorAd() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hair bg-white/95 backdrop-blur">
      <div className="relative mx-auto flex max-w-wide items-center justify-center px-4 py-1.5">
        <span className="absolute left-4 top-1/2 hidden -translate-y-1/2 text-[9px] font-bold uppercase tracking-[0.2em] text-slate/50 sm:block">
          Advertisement
        </span>
        <div className="flex h-[50px] w-[320px] items-center justify-center border border-dashed border-navy/20 bg-mist text-[11px] text-navy/30 md:h-[90px] md:w-[728px]">
          728×90 / 320×50
        </div>
      </div>
    </div>
  );
}
