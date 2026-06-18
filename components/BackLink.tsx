import Link from "next/link";

// Back chevron with a 44×44 tap target (negative margin keeps it visually inline).
export function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="Back"
      className="-m-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none text-muted active:bg-subtle"
    >
      ‹
    </Link>
  );
}
