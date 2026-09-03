import { logos } from "../../content/logos.js";

/**
 * Renders nothing until an organisation has given written permission, recorded on its entry.
 * Inventing customer logos is not a placeholder; it is a false statement about real companies.
 */
export function LogoWall() {
  if (logos.length === 0) return null;
  return (
    <section className="border-t border-tn-border py-12">
      <div className="mx-auto w-full max-w-[1536px] px-5 lg:px-[68px]">
        <h2 className="text-center text-[13px] font-medium uppercase tracking-[0.22em] text-tn-fg-subtle">
          Trusted by innovative teams
        </h2>
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {logos.map((logo) => (
            <li key={logo.name}>
              <img alt={logo.name} className="h-7 w-auto opacity-70" src={logo.mark} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
