// Site-wide sticky bottom anchor ad (THR uses an adhesion ad). Reserved height,
// labeled, non-intrusive — real ad code drops into the inner box later.
export default function AnchorAd() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hair bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-wide items-center justify-center px-4 py-1.5">
        <div className="flex h-[50px] w-[320px] items-center justify-center border border-hair md:h-[90px] md:w-[728px]">
          <span className="meta-mono text-gray">Advertisement</span>
        </div>
      </div>
    </div>
  );
}
