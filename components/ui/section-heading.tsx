type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function SectionHeading({ eyebrow, title, description }: SectionHeadingProps) {
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm uppercase tracking-[0.32em] text-cyan/70">{eyebrow}</p>
      <h2 className="font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
        {title}
      </h2>
      <p className="text-base leading-7 text-ink/80">{description}</p>
    </div>
  );
}
